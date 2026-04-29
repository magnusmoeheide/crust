const axios = require("axios");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const PLANDAY_OAUTH_BASE_URL = "https://id.planday.com";
const PLANDAY_API_BASE_URL = "https://openapi.planday.com";
const SHIFT_ENDPOINT = "/scheduling/v1.0/shifts";

const EMPLOYEE_ENDPOINT_CANDIDATES = [
  "/hr/v1.0/employees",
  "/employees/v1.0/employees",
];

const REQUEST_TIMEOUT_MS = 20000;
const PAGE_SIZE = 200;

// ✅ Maps Planday department IDs to location names
const DEPARTMENT_ID_TO_NAME = {
  19766: "Oslo",
  19767: "Bergen",
  19768: "Gjøvik",
};

/* --------------------------- AUTH ---------------------------- */

function getPlandayConfig() {
  const clientId = String(process.env.PLANDAY_CLIENT_ID || "").trim();
  const refreshToken = String(process.env.PLANDAY_TOKEN || "").trim();

  if (!clientId) throw new Error("Missing PLANDAY_CLIENT_ID");
  if (!refreshToken) throw new Error("Missing PLANDAY_TOKEN");

  return { clientId, refreshToken };
}

async function getPlandayAccessToken() {
  const { clientId, refreshToken } = getPlandayConfig();

  const res = await axios.post(
    `${PLANDAY_OAUTH_BASE_URL}/connect/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      timeout: REQUEST_TIMEOUT_MS,
    }
  );

  const token = res.data?.access_token;
  if (!token) throw new Error("No access token from Planday");

  return token;
}

function createClient(token) {
  return axios.create({
    baseURL: PLANDAY_API_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-ClientId": process.env.PLANDAY_CLIENT_ID,
      Accept: "application/json",
    },
  });
}

/* --------------------------- HELPERS ---------------------------- */

function extractItems(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.items || data?.employees || data?.shifts || [];
}

function toIsoDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().split("T")[0];
}

function round(value) {
  return Number((value || 0).toFixed(2));
}

/* --------------------------- EMPLOYEES FROM PLANDAY ---------------------------- */

async function getEmployees({ token } = {}) {
  const accessToken = token || (await getPlandayAccessToken());
  const client = createClient(accessToken);

  for (const endpoint of EMPLOYEE_ENDPOINT_CANDIDATES) {
    try {
      const res = await client.get(endpoint, {
        params: { limit: PAGE_SIZE },
      });

      const employees = extractItems(res.data);

      return employees.map((e) => ({
        id: String(e?.id || e?.employeeId || "").trim(),
        name: `${e?.firstName || ""} ${e?.lastName || ""}`.trim() || e?.name || "Unknown",
        departmentId: e?.departmentId || e?.department?.id || null,
        departmentName:
          DEPARTMENT_ID_TO_NAME[e?.departmentId || e?.department?.id] ||
          e?.department?.name ||
          "Unknown",
      }));
    } catch (err) {
      if (err?.response?.status === 404) continue;
      throw err;
    }
  }

  throw new Error("No employee endpoint found");
}

/* --------------------------- SYNC EMPLOYEES → FIRESTORE ---------------------------- */

async function syncEmployeesToFirestore() {
  const employees = await getEmployees();

  let newCount = 0;
  let updatedCount = 0;

  for (const emp of employees) {
    if (!emp.id) continue;

    const ref = db.collection("employees").doc(emp.id);
    const snap = await ref.get();

    if (!snap.exists) {
      newCount++;
      console.log(`🆕 New employee: ${emp.name} (${emp.departmentName})`);

      await ref.set({
        id: emp.id,
        name: emp.name,
        departmentId: emp.departmentId,
        location: emp.departmentName,
        rate: null,
        active: true,
        createdAt: new Date(),
      });
    } else {
      const data = snap.data();

      if (!data.location || data.location === "Unknown") {
        updatedCount++;

        await ref.update({
          departmentId: emp.departmentId,
          location: emp.departmentName,
        });

        console.log(`🔄 Updated location for: ${emp.name} → ${emp.departmentName}`);
      }
    }
  }

  console.log(`✅ Sync complete. New: ${newCount}, Updated: ${updatedCount}`);
  return { newEmployees: newCount, updatedEmployees: updatedCount };
}

/* --------------------------- GET RATE FROM FIRESTORE ---------------------------- */

async function getEmployeeRate(employeeId) {
  const snap = await db.collection("employees").doc(String(employeeId)).get();

  if (!snap.exists) {
    console.warn(`⚠️ Employee not in Firestore: ${employeeId}`);
    return 0;
  }

  const data = snap.data();
  const rate = Number(data?.rate);

  if (!rate || isNaN(rate)) {
    console.warn(`⚠️ No rate set for: ${data?.name || employeeId}`);
    return 0;
  }

  return rate;
}

/* --------------------------- GET EMPLOYEE LOCATION FROM FIRESTORE ---------------------------- */

async function getEmployeeLocation(employeeId) {
  const snap = await db.collection("employees").doc(String(employeeId)).get();

  if (!snap.exists) return null;

  const data = snap.data();
  return data?.location || null;
}

/* --------------------------- SHIFTS ---------------------------- */

async function getShifts({ token, from, to } = {}) {
  const accessToken = token || (await getPlandayAccessToken());
  const client = createClient(accessToken);

  const res = await client.get(SHIFT_ENDPOINT, {
    params: { from, to, limit: PAGE_SIZE },
  });

  const shifts = extractItems(res.data);

  console.log(`📊 Total shifts fetched: ${shifts.length}`);

  if (shifts.length > 0) {
    console.log("📦 Raw shift sample:", JSON.stringify(shifts[0], null, 2));
  }

  return shifts.map((s) => ({
    id: s?.id,
    employeeId: String(s?.employee?.id || s?.employeeId || "").trim(),
    departmentId: s?.departmentId || s?.department?.id || null,
    date: toIsoDate(s?.startDateTime || s?.date),

    hours: (() => {
      if (s?.hoursWorked) return Number(s.hoursWorked);
      if (s?.hours) return Number(s.hours);
      if (s?.startDateTime && s?.endDateTime) {
        const start = new Date(s.startDateTime);
        const end = new Date(s.endDateTime);
        return (end - start) / (1000 * 60 * 60);
      }
      return 0;
    })(),
  }));
}

/* --------------------------- SALARY CALCULATION BY DATE AND LOCATION ---------------------------- */

async function getSalaryByDateAndLocation(startDate, endDate) {
  const shifts = await getShifts({ from: startDate, to: endDate });

  const employeeCache = new Map();
  const uniqueEmployeeIds = [...new Set(shifts.map((s) => s.employeeId).filter(Boolean))];

  await Promise.all(
    uniqueEmployeeIds.map(async (empId) => {
      const snap = await db.collection("employees").doc(String(empId)).get();

      if (snap.exists) {
        const data = snap.data();

        employeeCache.set(empId, {
          rate: Number(data?.rate) || 0,
          location: data?.location || DEPARTMENT_ID_TO_NAME[data?.departmentId] || "Unknown",
        });
      } else {
        console.warn(`⚠️ Employee not found in Firestore: ${empId}`);

        employeeCache.set(empId, {
          rate: 0,
          location: "Unknown",
        });
      }
    })
  );

  const grouped = new Map();

  for (const shift of shifts) {
    if (!shift.date) continue;

    const empData = employeeCache.get(shift.employeeId) || {
      rate: 0,
      location: "Unknown",
    };

    const location =
      DEPARTMENT_ID_TO_NAME[shift.departmentId] ||
      empData.location ||
      "Unknown";

    const rate = empData.rate;
    const cost = round(shift.hours * rate);

    const key = `${shift.date}::${location}`;

    const current = grouped.get(key) || {
      date: shift.date,
      location,
      totalHours: 0,
      salaryCost: 0,
    };

    current.totalHours = round(current.totalHours + shift.hours);
    current.salaryCost = round(current.salaryCost + cost);

    grouped.set(key, current);
  }

  const result = Array.from(grouped.values());

  console.log("💰 Salary grouped sample:", JSON.stringify(result.slice(0, 3), null, 2));

  return result;
}

/* --------------------------- MISSING RATE REPORT ---------------------------- */

async function getMissingRateReport() {
  const snapshot = await db.collection("employees").get();

  const missing = [];

  snapshot.forEach((doc) => {
    const data = doc.data();

    if (!data.rate || data.rate === null) {
      missing.push({
        id: doc.id,
        name: data.name,
        location: data.location || "Unknown",
      });
    }
  });

  return {
    count: missing.length,
    employees: missing,
  };
}

/* --------------------------- VERIFY TOKEN ---------------------------- */

async function verifyPlandayToken() {
  const accessToken = await getPlandayAccessToken();
  const employees = await getEmployees({ token: accessToken });

  return {
    ok: true,
    employeeCount: employees.length,
    employees,
  };
}

/* --------------------------- LABOR REPORT ---------------------------- */

async function getPlandayLaborReportData({
  token,
  from,
  to,
  departmentIds = [],
  hourlyRate = 0,
} = {}) {
  const shifts = await getShifts({ token, from, to });

  let totalLaborCost = 0;
  let totalLaborHours = 0;

  shifts.forEach((shift) => {
    const hours = Number(shift?.hours || 0);
    const rate = Number(hourlyRate || 0);

    totalLaborCost += hours * rate;
    totalLaborHours += hours;
  });

  return {
    currencySymbol: "kr",
    currencyFormatString: "{0} {1}",
    shifts,
    totalLaborCost: round(totalLaborCost),
    totalLaborHours: round(totalLaborHours),
  };
}

/* --------------------------- EXPORTS ---------------------------- */

module.exports = {
  getPlandayAccessToken,
  getEmployees,
  getShifts,
  syncEmployeesToFirestore,
  getMissingRateReport,
  getSalaryByDateAndLocation,
  getPlandayLaborReportData,
  verifyPlandayToken,
};