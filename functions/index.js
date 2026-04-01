const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");

admin.initializeApp();

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 10,
});

const db = admin.firestore();
const fieldValue = admin.firestore.FieldValue;
const timestamp = admin.firestore.Timestamp;

const ZETTLE_CLIENT_ID = defineSecret("ZETTLE_CLIENT_ID");
const ZETTLE_CLIENT_SECRET = defineSecret("ZETTLE_CLIENT_SECRET");
const ZETTLE_APP_URL = defineSecret("ZETTLE_APP_URL");
const ZETTLE_REDIRECT_URI = defineSecret("ZETTLE_REDIRECT_URI");
const PLANDAY_CLIENT_ID = defineSecret("PLANDAY_CLIENT_ID");
const PLANDAY_APP_URL = defineSecret("PLANDAY_APP_URL");
const PLANDAY_REDIRECT_URI = defineSecret("PLANDAY_REDIRECT_URI");
const PLANDAY_SCOPES = defineSecret("PLANDAY_SCOPES");

const ZETTLE_OAUTH_BASE_URL = "https://oauth.zettle.com";
const ZETTLE_PURCHASE_BASE_URL = "https://purchase.izettle.com";
const ZETTLE_DEFAULT_SCOPE = "READ:FINANCE READ:PURCHASE";
const PLANDAY_AUTH_BASE_URL = "https://id.planday.com";
const PLANDAY_API_BASE_URL = "https://openapi.planday.com";
const PLANDAY_DEFAULT_SCOPE = "openid offline_access";
const INTEGRATIONS_COLLECTION = "integrations";
const ZETTLE_PUBLIC_DOC_ID = "zettle";
const ZETTLE_PRIVATE_COLLECTION = "zettlePrivate";
const ZETTLE_PRIVATE_DOC_ID = "default";
const ZETTLE_OAUTH_STATES_COLLECTION = "zettleOAuthStates";
const PLANDAY_PUBLIC_DOC_ID = "planday";
const PLANDAY_PRIVATE_COLLECTION = "plandayPrivate";
const PLANDAY_PRIVATE_DOC_ID = "default";
const PLANDAY_OAUTH_STATES_COLLECTION = "plandayOAuthStates";
const ZETTLE_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;
const PLANDAY_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;
const SALES_REPORT_MAX_DAYS = 31;
const SALES_REPORT_PAGE_LIMIT = 200;
const SALES_REPORT_MAX_PAGES = 20;

function isCrustEmail(value) {
  return typeof value === "string" && /@crust\.no$/i.test(value);
}

function getAuthEmail(auth) {
  return String(auth?.token?.email || auth?.token?.preferred_username || "").trim();
}

function requireAdminAuth(request) {
  const email = getAuthEmail(request.auth);
  if (!request.auth?.uid || !isCrustEmail(email)) {
    throw new HttpsError("permission-denied", "Admin login required.");
  }

  return {
    uid: request.auth.uid,
    email,
  };
}

function getProviderReturnUrl(appUrl, provider, status, errorCode = "") {
  const url = new URL("/admin", appUrl);
  url.searchParams.set(provider, status);
  if (errorCode) {
    url.searchParams.set(`${provider}_error`, errorCode);
  }
  return url.toString();
}

function getExpiryTimestamp(expiresInSeconds) {
  const parsedSeconds = Number(expiresInSeconds);
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return null;
  }
  return timestamp.fromDate(new Date(Date.now() + parsedSeconds * 1000));
}

function getDateFromTimestamp(value) {
  const date = value?.toDate?.();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatUtcDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function formatUtcDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoBoundary(value, fieldName) {
  const text = String(value || "").trim();
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) {
    throw new HttpsError("invalid-argument", `Invalid ${fieldName}.`);
  }
  return parsed;
}

function normalizeErrorMessage(error, fallbackMessage) {
  if (error instanceof HttpsError) {
    return error.message || fallbackMessage;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallbackMessage;
}

function getZettlePrivateRef() {
  return db.collection(ZETTLE_PRIVATE_COLLECTION).doc(ZETTLE_PRIVATE_DOC_ID);
}

function getPlandayPrivateRef() {
  return db.collection(PLANDAY_PRIVATE_COLLECTION).doc(PLANDAY_PRIVATE_DOC_ID);
}

function getPlandayScopesValue() {
  const configuredScopes = String(PLANDAY_SCOPES.value() || "").trim();
  const normalizedScopes = configuredScopes.split(/\s+/).filter(Boolean);
  const nextScopes = [...normalizedScopes];

  if (!nextScopes.includes("openid")) {
    nextScopes.push("openid");
  }
  if (!nextScopes.includes("offline_access")) {
    nextScopes.push("offline_access");
  }

  if (nextScopes.length > 0) {
    return nextScopes.join(" ");
  }

  logger.warn("Missing Planday scopes secret, falling back to default scopes.", {
    fallbackScopes: PLANDAY_DEFAULT_SCOPE,
  });
  return PLANDAY_DEFAULT_SCOPE;
}

async function setPublicStatus(payload) {
  await db.collection(INTEGRATIONS_COLLECTION).doc(ZETTLE_PUBLIC_DOC_ID).set(
    {
      provider: "zettle",
      updatedAt: fieldValue.serverTimestamp(),
      ...payload,
    },
    { merge: true },
  );
}

async function setPlandayPublicStatus(payload) {
  await db.collection(INTEGRATIONS_COLLECTION).doc(PLANDAY_PUBLIC_DOC_ID).set(
    {
      provider: "planday",
      updatedAt: fieldValue.serverTimestamp(),
      ...payload,
    },
    { merge: true },
  );
}

function parseIsoLocalDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatUtcDate(parsed);
}

function parseDurationToMinutes(value) {
  const parts = String(value || "").trim().split(":");
  if (parts.length !== 3) {
    return 0;
  }

  const days = Number(parts[0] || 0);
  const hours = Number(parts[1] || 0);
  const minutes = Number(parts[2] || 0);
  if (![days, hours, minutes].every(Number.isFinite)) {
    return 0;
  }

  return days * 24 * 60 + hours * 60 + minutes;
}

function parseDepartmentIds(value) {
  const input = Array.isArray(value) ? value : [];
  const uniqueIds = [];

  input.forEach((entry) => {
    const numericId = Number(String(entry || "").trim());
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return;
    }
    if (!uniqueIds.includes(numericId)) {
      uniqueIds.push(numericId);
    }
  });

  return uniqueIds;
}

async function getStoredZettleConnection() {
  const snapshot = await getZettlePrivateRef().get();
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", "Zettle is not connected.");
  }

  const data = snapshot.data() || {};
  const accessToken = String(data.accessToken || "").trim();
  const refreshToken = String(data.refreshToken || "").trim();
  if (!accessToken || !refreshToken) {
    throw new HttpsError("failed-precondition", "Zettle tokens are missing.");
  }

  return data;
}

async function storeZettleTokens(currentData, tokenData) {
  const expiresAt = getExpiryTimestamp(tokenData.expires_in);
  const nextRefreshToken = String(
    tokenData.refresh_token || currentData?.refreshToken || "",
  ).trim();
  const nextScope = String(tokenData.scope || currentData?.scope || "").trim();
  const nextTokenType = String(
    tokenData.token_type || currentData?.tokenType || "Bearer",
  ).trim();

  await getZettlePrivateRef().set(
    {
      accessToken: String(tokenData.access_token || "").trim(),
      refreshToken: nextRefreshToken,
      tokenType: nextTokenType || "Bearer",
      scope: nextScope,
      expiresAt,
      updatedAt: fieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await setPublicStatus({
    status: "connected",
    scope: nextScope,
    tokenType: nextTokenType || "Bearer",
    expiresAt,
    lastError: fieldValue.delete(),
  });

  return {
    ...currentData,
    accessToken: String(tokenData.access_token || "").trim(),
    refreshToken: nextRefreshToken,
    tokenType: nextTokenType || "Bearer",
    scope: nextScope,
    expiresAt,
  };
}

async function refreshZettleAccessToken(currentData) {
  const refreshToken = String(currentData?.refreshToken || "").trim();
  if (!refreshToken) {
    throw new HttpsError("failed-precondition", "Zettle refresh token is missing.");
  }

  const tokenResponse = await fetch(`${ZETTLE_OAUTH_BASE_URL}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ZETTLE_CLIENT_ID.value(),
      client_secret: ZETTLE_CLIENT_SECRET.value(),
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const failureBody = await tokenResponse.text();
    logger.error("Zettle refresh token exchange failed", {
      status: tokenResponse.status,
      body: failureBody,
    });
    await setPublicStatus({
      status: "error",
      lastError: `Token refresh failed (${tokenResponse.status}).`,
    });
    throw new HttpsError("internal", "Unable to refresh Zettle access token.");
  }

  const tokenData = await tokenResponse.json();
  return storeZettleTokens(currentData, tokenData);
}

async function getValidZettleConnection() {
  const currentData = await getStoredZettleConnection();
  const expiryDate = getDateFromTimestamp(currentData.expiresAt);
  const accessToken = String(currentData.accessToken || "").trim();

  if (!accessToken) {
    throw new HttpsError("failed-precondition", "Zettle access token is missing.");
  }

  if (
    expiryDate &&
    expiryDate.getTime() <= Date.now() + ZETTLE_TOKEN_REFRESH_BUFFER_MS
  ) {
    return refreshZettleAccessToken(currentData);
  }

  return currentData;
}

async function zettleApiFetchJson(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Zettle API request failed (${response.status}).`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return response.json();
}

async function zettleApiGet(url) {
  let connection = await getValidZettleConnection();
  try {
    return await zettleApiFetchJson(url, String(connection.accessToken || "").trim());
  } catch (error) {
    if (error?.status !== 401) {
      throw error;
    }

    connection = await refreshZettleAccessToken(connection);
    return zettleApiFetchJson(url, String(connection.accessToken || "").trim());
  }
}

async function fetchZettleIdentity() {
  return zettleApiGet(`${ZETTLE_OAUTH_BASE_URL}/users/self`);
}

function buildPurchaseSummary(purchases) {
  let currency = "";
  let grossSalesAmount = 0;
  let refundAmount = 0;
  let netSalesAmount = 0;
  let salesCount = 0;
  let refundCount = 0;
  const paymentTotals = new Map();
  const productTotals = new Map();
  const dailyTotals = new Map();

  const normalizedPurchases = purchases.map((purchase) => {
    const amount = Number(purchase?.amount || 0);
    const vatAmount = Number(purchase?.vatAmount || 0);
    const netAmount = amount - vatAmount;
    const isRefund = Boolean(purchase?.refund) || amount < 0;
    const purchaseCurrency = String(purchase?.currency || "").trim();
    if (!currency && purchaseCurrency) {
      currency = purchaseCurrency;
    }

    netSalesAmount += netAmount;
    if (isRefund) {
      refundCount += 1;
      refundAmount += Math.abs(amount);
    } else {
      salesCount += 1;
      grossSalesAmount += amount;
    }

    const purchaseDate = parseIsoLocalDate(
      purchase?.timestamp || purchase?.created || "",
    );
    if (purchaseDate) {
      const currentDay = dailyTotals.get(purchaseDate) || {
        date: purchaseDate,
        grossSalesAmount: 0,
        netSalesAmount: 0,
        vatAmount: 0,
        refundAmount: 0,
        salesCount: 0,
        refundCount: 0,
      };
      currentDay.grossSalesAmount += amount;
      currentDay.netSalesAmount += netAmount;
      currentDay.vatAmount += vatAmount;
      if (isRefund) {
        currentDay.refundAmount += Math.abs(amount);
        currentDay.refundCount += 1;
      } else {
        currentDay.salesCount += 1;
      }
      dailyTotals.set(purchaseDate, currentDay);
    }

    const paymentTypes = Array.isArray(purchase?.payments) ? purchase.payments : [];
    paymentTypes.forEach((payment) => {
      const type = String(payment?.type || "UNKNOWN").trim() || "UNKNOWN";
      const nextAmount =
        Number(paymentTotals.get(type) || 0) + Number(payment?.amount || 0);
      paymentTotals.set(type, nextAmount);
    });

    const products = Array.isArray(purchase?.products) ? purchase.products : [];
    products.forEach((product) => {
      const name = String(product?.name || "").trim();
      if (!name) {
        return;
      }

      const current = productTotals.get(name) || {
        name,
        quantity: 0,
        amount: 0,
      };
      const quantity = Number(product?.quantity || 0);
      const unitPrice = Number(product?.unitPrice || 0);
      current.quantity += quantity;
      current.amount += quantity * unitPrice;
      productTotals.set(name, current);
    });

    return {
      purchaseUuid: String(
        purchase?.purchaseUUID1 || purchase?.purchaseUUID || "",
      ).trim(),
      timestamp: String(purchase?.timestamp || purchase?.created || "").trim(),
      amount,
      netAmount,
      vatAmount,
      currency: purchaseCurrency,
      source: String(purchase?.source || "").trim(),
      purchaseNumber:
        purchase?.purchaseNumber == null ? null : Number(purchase.purchaseNumber),
      userDisplayName: String(purchase?.userDisplayName || "").trim(),
      refunded: Boolean(purchase?.refunded),
      refund: Boolean(purchase?.refund),
      paymentTypes: paymentTypes.map((payment) => String(payment?.type || "UNKNOWN")),
      productNames: products
        .map((product) => String(product?.name || "").trim())
        .filter(Boolean)
        .slice(0, 4),
    };
  });

  const paymentBreakdown = Array.from(paymentTotals.entries())
    .map(([type, amount]) => ({ type, amount }))
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));

  const topProducts = Array.from(productTotals.values())
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
    .slice(0, 8);
  const dailySales = Array.from(dailyTotals.values()).sort((left, right) =>
    left.date.localeCompare(right.date),
  );

  return {
    currency,
    recordCount: normalizedPurchases.length,
    salesCount,
    refundCount,
    grossSalesAmount,
    refundAmount,
    netSalesAmount,
    paymentBreakdown,
    topProducts,
    dailySales,
    purchases: normalizedPurchases,
  };
}

async function fetchZettlePurchases(startAt, endAt) {
  const purchases = [];
  let lastPurchaseHash = "";
  let truncated = false;

  for (let pageIndex = 0; pageIndex < SALES_REPORT_MAX_PAGES; pageIndex += 1) {
    const params = new URLSearchParams({
      limit: String(SALES_REPORT_PAGE_LIMIT),
      descending: "true",
      startDate: formatUtcDateTime(startAt),
      endDate: formatUtcDateTime(endAt),
    });

    if (lastPurchaseHash) {
      params.set("lastPurchaseHash", lastPurchaseHash);
    }

    const data = await zettleApiGet(
      `${ZETTLE_PURCHASE_BASE_URL}/purchases/v2?${params.toString()}`,
    );
    const pagePurchases = Array.isArray(data?.purchases) ? data.purchases : [];
    if (pagePurchases.length === 0) {
      break;
    }

    purchases.push(...pagePurchases);
    lastPurchaseHash = String(data?.lastPurchaseHash || "").trim();

    if (!lastPurchaseHash || !Array.isArray(data?.linkUrls) || data.linkUrls.length === 0) {
      break;
    }

    if (pageIndex === SALES_REPORT_MAX_PAGES - 1) {
      truncated = true;
    }
  }

  return {
    purchases,
    truncated,
  };
}

async function getStoredPlandayConnection() {
  const snapshot = await getPlandayPrivateRef().get();
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", "Planday is not connected.");
  }

  const data = snapshot.data() || {};
  const accessToken = String(data.accessToken || "").trim();
  const refreshToken = String(data.refreshToken || "").trim();
  if (!accessToken || !refreshToken) {
    throw new HttpsError("failed-precondition", "Planday tokens are missing.");
  }

  return data;
}

async function storePlandayTokens(currentData, tokenData) {
  const expiresAt = getExpiryTimestamp(tokenData.expires_in);
  const nextRefreshToken = String(
    tokenData.refresh_token || currentData?.refreshToken || "",
  ).trim();
  const nextScope = String(tokenData.scope || currentData?.scope || "").trim();
  const nextTokenType = String(
    tokenData.token_type || currentData?.tokenType || "Bearer",
  ).trim();

  await getPlandayPrivateRef().set(
    {
      provider: "planday",
      accessToken: String(tokenData.access_token || "").trim(),
      refreshToken: nextRefreshToken,
      tokenType: nextTokenType,
      scope: nextScope,
      expiresAt,
      updatedAt: fieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await setPlandayPublicStatus({
    status: "connected",
    scope: nextScope,
    tokenType: nextTokenType,
    expiresAt,
    lastError: fieldValue.delete(),
  });

  return {
    ...currentData,
    accessToken: String(tokenData.access_token || "").trim(),
    refreshToken: nextRefreshToken,
    tokenType: nextTokenType,
    scope: nextScope,
    expiresAt,
  };
}

async function refreshPlandayAccessToken(currentData) {
  const refreshToken = String(currentData?.refreshToken || "").trim();
  if (!refreshToken) {
    throw new HttpsError("failed-precondition", "Planday refresh token is missing.");
  }

  const tokenResponse = await fetch(`${PLANDAY_AUTH_BASE_URL}/connect/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: PLANDAY_CLIENT_ID.value(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!tokenResponse.ok) {
    const failureBody = await tokenResponse.text();
    logger.error("Planday refresh token exchange failed", {
      status: tokenResponse.status,
      body: failureBody,
    });
    await setPlandayPublicStatus({
      status: "error",
      lastError: `Token refresh failed (${tokenResponse.status}).`,
    });
    throw new HttpsError("internal", "Unable to refresh Planday access token.");
  }

  const tokenData = await tokenResponse.json();
  return storePlandayTokens(currentData, tokenData);
}

async function getValidPlandayConnection() {
  const currentData = await getStoredPlandayConnection();
  const expiryDate = getDateFromTimestamp(currentData.expiresAt);
  const accessToken = String(currentData.accessToken || "").trim();

  if (!accessToken) {
    throw new HttpsError("failed-precondition", "Planday access token is missing.");
  }

  if (
    expiryDate &&
    expiryDate.getTime() <= Date.now() + PLANDAY_TOKEN_REFRESH_BUFFER_MS
  ) {
    return refreshPlandayAccessToken(currentData);
  }

  return currentData;
}

async function plandayApiFetchJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(options.headers || {}),
    },
    body: options.body,
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Planday API request failed (${response.status}).`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return response.json();
}

async function plandayApiGet(path) {
  let connection = await getValidPlandayConnection();
  const accessToken = () => String(connection.accessToken || "").trim();

  try {
    return await plandayApiFetchJson(`${PLANDAY_API_BASE_URL}${path}`, accessToken());
  } catch (error) {
    if (error?.status !== 401) {
      throw error;
    }

    connection = await refreshPlandayAccessToken(connection);
    return plandayApiFetchJson(`${PLANDAY_API_BASE_URL}${path}`, accessToken());
  }
}

async function fetchPlandayPayroll(departmentIds, fromDate, toDate) {
  const commaSeparatedIds = departmentIds.join(",");
  const repeatedIds = departmentIds
    .map((departmentId) => `departmentIds=${departmentId}`)
    .join("&");
  const pathCandidates = [
    `/payroll/v1.0/payroll?departmentIds=${commaSeparatedIds}&from=${fromDate}&to=${toDate}&shiftStatus=Approved`,
    `/payroll/v1.0/payroll?${repeatedIds}&from=${fromDate}&to=${toDate}&shiftStatus=Approved`,
    `/payroll/v1.0/payroll?departmentIds=${commaSeparatedIds}&from=${fromDate}&to=${toDate}`,
    `/payroll/v1.0/payroll?${repeatedIds}&from=${fromDate}&to=${toDate}`,
  ];

  let lastError = null;
  for (const path of pathCandidates) {
    try {
      return await plandayApiGet(path);
    } catch (error) {
      lastError = error;
      if (![400, 404].includes(Number(error?.status || 0))) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Planday Payroll endpoint not found.");
}

function getPlandayPayrollEntryAmount(entry) {
  const directCandidates = [
    entry?.amount,
    entry?.cost,
    entry?.totalCost,
    entry?.totalSalary,
    entry?.salary,
    entry?.pay,
    entry?.value,
  ];

  for (const candidate of directCandidates) {
    const amount = Number(candidate);
    if (Number.isFinite(amount)) {
      return amount;
    }
  }

  const unitCandidates = [
    entry?.units,
    entry?.hours,
    entry?.quantity,
    entry?.numberOfHours,
  ];
  const rateCandidates = [
    entry?.wage,
    entry?.rate,
    entry?.hourlyRate,
    entry?.unitRate,
  ];

  const units = unitCandidates
    .map((candidate) => Number(candidate))
    .find((candidate) => Number.isFinite(candidate));
  const rate = rateCandidates
    .map((candidate) => Number(candidate))
    .find((candidate) => Number.isFinite(candidate));

  if (Number.isFinite(units) && Number.isFinite(rate)) {
    return units * rate;
  }

  return 0;
}

function getPlandayPayrollEntryMinutes(entry) {
  const durationMinutes = parseDurationToMinutes(entry?.duration);
  if (durationMinutes > 0) {
    return durationMinutes;
  }

  const hours = [entry?.units, entry?.hours, entry?.numberOfHours]
    .map((candidate) => Number(candidate))
    .find((candidate) => Number.isFinite(candidate));

  if (Number.isFinite(hours)) {
    return hours * 60;
  }

  return 0;
}

function getPlandayPayrollEntryDate(entry) {
  const dateCandidates = [
    entry?.date,
    entry?.shiftDate,
    entry?.workDate,
    entry?.startDate,
    entry?.startDateTime,
    entry?.from,
  ];

  for (const candidate of dateCandidates) {
    const parsed = parseIsoLocalDate(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return "";
}

function buildPlandayLaborSummary(departmentIds, payrollResponse) {
  const dailyTotals = new Map();
  let totalLaborCost = 0;
  let totalLaborMinutes = 0;
  let currencySymbol = "";
  let currencyFormatString = "";
  const payload = payrollResponse?.data || payrollResponse || {};
  const payrollCollections = [
    payload?.shiftsPayroll,
    payload?.supplementsPayroll,
    payload?.salariedPayroll,
  ];

  if (payload.currencySymbol) {
    currencySymbol = String(payload.currencySymbol);
  }
  if (payload.currencyFormatString) {
    currencyFormatString = String(payload.currencyFormatString);
  }

  payrollCollections.forEach((entries) => {
    const items = Array.isArray(entries) ? entries : [];

    items.forEach((entry) => {
      const amount = getPlandayPayrollEntryAmount(entry);
      const minutes = getPlandayPayrollEntryMinutes(entry);
      const date = getPlandayPayrollEntryDate(entry);

      totalLaborCost += amount;
      totalLaborMinutes += minutes;

      if (!date) {
        return;
      }

      const currentDay = dailyTotals.get(date) || {
        date,
        laborCost: 0,
        laborMinutes: 0,
        shiftCount: 0,
        departmentIds: [...departmentIds],
      };
      currentDay.laborCost += amount;
      currentDay.laborMinutes += minutes;
      currentDay.shiftCount += 1;
      dailyTotals.set(date, currentDay);
    });
  });

  const dailyLabor = Array.from(dailyTotals.values()).sort((left, right) =>
    left.date.localeCompare(right.date),
  );

  return {
    currencySymbol,
    currencyFormatString,
    totalLaborCost,
    totalLaborMinutes,
    dailyLabor,
  };
}

exports.createZettleAuthSession = onCall(
  {
    secrets: [ZETTLE_CLIENT_ID, ZETTLE_REDIRECT_URI],
    cors: true,
  },
  async (request) => {
    const adminUser = requireAdminAuth(request);
    const state = crypto.randomUUID();

    await db.collection(ZETTLE_OAUTH_STATES_COLLECTION).doc(state).set({
      initiatedByUid: adminUser.uid,
      initiatedByEmail: adminUser.email,
      createdAt: fieldValue.serverTimestamp(),
    });

    const authUrl = new URL("/authorize", ZETTLE_OAUTH_BASE_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", ZETTLE_CLIENT_ID.value());
    authUrl.searchParams.set("scope", ZETTLE_DEFAULT_SCOPE);
    authUrl.searchParams.set("redirect_uri", ZETTLE_REDIRECT_URI.value());
    authUrl.searchParams.set("state", state);

    await setPublicStatus({
      status: "pending",
      pendingAt: fieldValue.serverTimestamp(),
      pendingByEmail: adminUser.email,
      lastError: fieldValue.delete(),
    });

    return {
      authUrl: authUrl.toString(),
    };
  },
);

exports.zettleAuthCallback = onRequest(
  {
    secrets: [
      ZETTLE_CLIENT_ID,
      ZETTLE_CLIENT_SECRET,
      ZETTLE_APP_URL,
      ZETTLE_REDIRECT_URI,
    ],
  },
  async (request, response) => {
    if (request.method !== "GET") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    const code = String(request.query.code || "").trim();
    const state = String(request.query.state || "").trim();
    const oauthError = String(request.query.error || "").trim();
    const oauthErrorDescription = String(request.query.error_description || "").trim();
    const stateRef = db.collection(ZETTLE_OAUTH_STATES_COLLECTION).doc(state);

    if (!state || (!code && !oauthError)) {
      response.redirect(
        302,
        getProviderReturnUrl(
          ZETTLE_APP_URL.value(),
          "zettle",
          "error",
          "missing_state",
        ),
      );
      return;
    }

    const stateSnapshot = await stateRef.get();
    if (!stateSnapshot.exists) {
      response.redirect(
        302,
        getProviderReturnUrl(
          ZETTLE_APP_URL.value(),
          "zettle",
          "error",
          "invalid_state",
        ),
      );
      return;
    }

    const stateData = stateSnapshot.data() || {};

    if (oauthError) {
      await setPublicStatus({
        status: "error",
        lastError: oauthErrorDescription || oauthError,
      });
      await stateRef.delete().catch(() => {});
      response.redirect(
        302,
        getProviderReturnUrl(
          ZETTLE_APP_URL.value(),
          "zettle",
          "error",
          oauthError,
        ),
      );
      return;
    }

    try {
      const tokenResponse = await fetch(`${ZETTLE_OAUTH_BASE_URL}/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ZETTLE_CLIENT_ID.value(),
          client_secret: ZETTLE_CLIENT_SECRET.value(),
          redirect_uri: ZETTLE_REDIRECT_URI.value(),
          code,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const failureBody = await tokenResponse.text();
        logger.error("Zettle token exchange failed", {
          status: tokenResponse.status,
          body: failureBody,
        });
        await setPublicStatus({
          status: "error",
          lastError: `Token exchange failed (${tokenResponse.status}).`,
        });
        await stateRef.delete().catch(() => {});
        response.redirect(
          302,
          getProviderReturnUrl(
            ZETTLE_APP_URL.value(),
            "zettle",
            "error",
            "token_exchange_failed",
          ),
        );
        return;
      }

      const tokenData = await tokenResponse.json();
      const expiresAt = getExpiryTimestamp(tokenData.expires_in);

      await db.collection(ZETTLE_PRIVATE_COLLECTION).doc(ZETTLE_PRIVATE_DOC_ID).set(
        {
          provider: "zettle",
          accessToken: String(tokenData.access_token || ""),
          refreshToken: String(tokenData.refresh_token || ""),
          tokenType: String(tokenData.token_type || "Bearer"),
          scope: String(tokenData.scope || ""),
          expiresAt,
          updatedAt: fieldValue.serverTimestamp(),
          connectedByUid: String(stateData.initiatedByUid || ""),
          connectedByEmail: String(stateData.initiatedByEmail || ""),
        },
        { merge: true },
      );

      await setPublicStatus({
        status: "connected",
        connectedAt: fieldValue.serverTimestamp(),
        connectedByUid: String(stateData.initiatedByUid || ""),
        connectedByEmail: String(stateData.initiatedByEmail || ""),
        scope: String(tokenData.scope || ""),
        tokenType: String(tokenData.token_type || "Bearer"),
        expiresAt,
        lastError: fieldValue.delete(),
      });

      await stateRef.delete().catch(() => {});
      response.redirect(
        302,
        getProviderReturnUrl(ZETTLE_APP_URL.value(), "zettle", "connected"),
      );
    } catch (error) {
      logger.error("Zettle callback failed", error);
      await setPublicStatus({
        status: "error",
        lastError: error instanceof Error ? error.message : "Unknown callback error.",
      });
      await stateRef.delete().catch(() => {});
      response.redirect(
        302,
        getProviderReturnUrl(
          ZETTLE_APP_URL.value(),
          "zettle",
          "error",
          "callback_failed",
        ),
      );
    }
  },
);

exports.disconnectZettle = onCall(
  {
    cors: true,
  },
  async (request) => {
    const adminUser = requireAdminAuth(request);

    await db.collection(ZETTLE_PRIVATE_COLLECTION).doc(ZETTLE_PRIVATE_DOC_ID).delete();
    await setPublicStatus({
      status: "not_connected",
      disconnectedAt: fieldValue.serverTimestamp(),
      disconnectedByEmail: adminUser.email,
      lastError: fieldValue.delete(),
    });

    return {
      ok: true,
    };
  },
);

exports.verifyZettleConnection = onCall(
  {
    secrets: [ZETTLE_CLIENT_ID, ZETTLE_CLIENT_SECRET, ZETTLE_REDIRECT_URI],
    cors: true,
  },
  async (request) => {
    requireAdminAuth(request);

    try {
      const identity = await fetchZettleIdentity();
      const userUuid = String(identity?.uuid || "").trim();
      const organizationUuid = String(identity?.organizationUuid || "").trim();

      await setPublicStatus({
        status: "connected",
        zettleUserUuid: userUuid || fieldValue.delete(),
        organizationUuid: organizationUuid || fieldValue.delete(),
        verifiedAt: fieldValue.serverTimestamp(),
        lastError: fieldValue.delete(),
      });

      return {
        connected: true,
        userUuid,
        organizationUuid,
      };
    } catch (error) {
      logger.error("Zettle verification failed", error);
      const message = normalizeErrorMessage(
        error,
        "Unable to verify Zettle connection.",
      );
      await setPublicStatus({
        status: "error",
        lastError: message,
      });
      throw new HttpsError("internal", message);
    }
  },
);

exports.getZettleSalesReport = onCall(
  {
    secrets: [ZETTLE_CLIENT_ID, ZETTLE_CLIENT_SECRET, ZETTLE_REDIRECT_URI],
    cors: true,
  },
  async (request) => {
    requireAdminAuth(request);

    const startAt = parseIsoBoundary(request.data?.startAt, "startAt");
    const endAt = parseIsoBoundary(request.data?.endAt, "endAt");

    if (endAt <= startAt) {
      throw new HttpsError("invalid-argument", "endAt must be after startAt.");
    }

    const daySpan = (endAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daySpan > SALES_REPORT_MAX_DAYS) {
      throw new HttpsError(
        "invalid-argument",
        `Sales report range cannot exceed ${SALES_REPORT_MAX_DAYS} days.`,
      );
    }

    try {
      const identity = await fetchZettleIdentity();
      const userUuid = String(identity?.uuid || "").trim();
      const organizationUuid = String(identity?.organizationUuid || "").trim();
      const purchaseResult = await fetchZettlePurchases(startAt, endAt);
      const summary = buildPurchaseSummary(purchaseResult.purchases);

      await setPublicStatus({
        status: "connected",
        zettleUserUuid: userUuid || fieldValue.delete(),
        organizationUuid: organizationUuid || fieldValue.delete(),
        verifiedAt: fieldValue.serverTimestamp(),
        lastSalesFetchAt: fieldValue.serverTimestamp(),
        lastError: fieldValue.delete(),
      });

      return {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        connectedAccount: {
          userUuid,
          organizationUuid,
        },
        truncated: purchaseResult.truncated,
        ...summary,
      };
    } catch (error) {
      logger.error("Zettle sales report failed", error);
      const message = normalizeErrorMessage(
        error,
        "Unable to load Zettle sales report.",
      );
      await setPublicStatus({
        status: "error",
        lastError: message,
      });
      throw new HttpsError("internal", message);
    }
  },
);

exports.createPlandayAuthSession = onCall(
  {
    secrets: [PLANDAY_CLIENT_ID, PLANDAY_REDIRECT_URI, PLANDAY_SCOPES],
    cors: true,
  },
  async (request) => {
    const adminUser = requireAdminAuth(request);
    const state = crypto.randomUUID();

    await db.collection(PLANDAY_OAUTH_STATES_COLLECTION).doc(state).set({
      initiatedByUid: adminUser.uid,
      initiatedByEmail: adminUser.email,
      createdAt: fieldValue.serverTimestamp(),
    });

    const authUrl = new URL("/connect/authorize", PLANDAY_AUTH_BASE_URL);
    authUrl.searchParams.set("client_id", PLANDAY_CLIENT_ID.value());
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", PLANDAY_REDIRECT_URI.value());
    authUrl.searchParams.set("scope", getPlandayScopesValue());
    authUrl.searchParams.set("state", state);

    await setPlandayPublicStatus({
      status: "pending",
      pendingAt: fieldValue.serverTimestamp(),
      pendingByEmail: adminUser.email,
      lastError: fieldValue.delete(),
    });

    return {
      authUrl: authUrl.toString(),
    };
  },
);

exports.plandayAuthCallback = onRequest(
  {
    secrets: [
      PLANDAY_CLIENT_ID,
      PLANDAY_APP_URL,
      PLANDAY_REDIRECT_URI,
      PLANDAY_SCOPES,
    ],
  },
  async (request, response) => {
    if (request.method !== "GET") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    const code = String(request.query.code || "").trim();
    const state = String(request.query.state || "").trim();
    const oauthError = String(request.query.error || "").trim();
    const oauthErrorDescription = String(request.query.error_description || "").trim();
    const stateRef = db.collection(PLANDAY_OAUTH_STATES_COLLECTION).doc(state);

    if (!state || (!code && !oauthError)) {
      response.redirect(
        302,
        getProviderReturnUrl(
          PLANDAY_APP_URL.value(),
          "planday",
          "error",
          "missing_state",
        ),
      );
      return;
    }

    const stateSnapshot = await stateRef.get();
    if (!stateSnapshot.exists) {
      response.redirect(
        302,
        getProviderReturnUrl(
          PLANDAY_APP_URL.value(),
          "planday",
          "error",
          "invalid_state",
        ),
      );
      return;
    }

    const stateData = stateSnapshot.data() || {};

    if (oauthError) {
      await setPlandayPublicStatus({
        status: "error",
        lastError: oauthErrorDescription || oauthError,
      });
      await stateRef.delete().catch(() => {});
      response.redirect(
        302,
        getProviderReturnUrl(
          PLANDAY_APP_URL.value(),
          "planday",
          "error",
          oauthError,
        ),
      );
      return;
    }

    try {
      const tokenResponse = await fetch(`${PLANDAY_AUTH_BASE_URL}/connect/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: PLANDAY_CLIENT_ID.value(),
          grant_type: "authorization_code",
          code,
          redirect_uri: PLANDAY_REDIRECT_URI.value(),
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const failureBody = await tokenResponse.text();
        logger.error("Planday token exchange failed", {
          status: tokenResponse.status,
          body: failureBody,
        });
        await setPlandayPublicStatus({
          status: "error",
          lastError: `Token exchange failed (${tokenResponse.status}).`,
        });
        await stateRef.delete().catch(() => {});
        response.redirect(
          302,
          getProviderReturnUrl(
            PLANDAY_APP_URL.value(),
            "planday",
            "error",
            "token_exchange_failed",
          ),
        );
        return;
      }

      const tokenData = await tokenResponse.json();
      const expiresAt = getExpiryTimestamp(tokenData.expires_in);

      await getPlandayPrivateRef().set(
        {
          provider: "planday",
          accessToken: String(tokenData.access_token || ""),
          refreshToken: String(tokenData.refresh_token || ""),
          tokenType: String(tokenData.token_type || "Bearer"),
          scope: String(tokenData.scope || ""),
          expiresAt,
          updatedAt: fieldValue.serverTimestamp(),
          connectedByUid: String(stateData.initiatedByUid || ""),
          connectedByEmail: String(stateData.initiatedByEmail || ""),
        },
        { merge: true },
      );

      await setPlandayPublicStatus({
        status: "connected",
        connectedAt: fieldValue.serverTimestamp(),
        connectedByUid: String(stateData.initiatedByUid || ""),
        connectedByEmail: String(stateData.initiatedByEmail || ""),
        scope: String(tokenData.scope || ""),
        tokenType: String(tokenData.token_type || "Bearer"),
        expiresAt,
        lastError: fieldValue.delete(),
      });

      await stateRef.delete().catch(() => {});
      response.redirect(
        302,
        getProviderReturnUrl(PLANDAY_APP_URL.value(), "planday", "connected"),
      );
    } catch (error) {
      logger.error("Planday callback failed", error);
      await setPlandayPublicStatus({
        status: "error",
        lastError: error instanceof Error ? error.message : "Unknown callback error.",
      });
      await stateRef.delete().catch(() => {});
      response.redirect(
        302,
        getProviderReturnUrl(
          PLANDAY_APP_URL.value(),
          "planday",
          "error",
          "callback_failed",
        ),
      );
    }
  },
);

exports.disconnectPlanday = onCall(
  {
    secrets: [PLANDAY_CLIENT_ID],
    cors: true,
  },
  async (request) => {
    const adminUser = requireAdminAuth(request);

    try {
      const currentData = await getStoredPlandayConnection();
      const refreshToken = String(currentData.refreshToken || "").trim();
      if (refreshToken) {
        await fetch(`${PLANDAY_AUTH_BASE_URL}/connect/revocation`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: PLANDAY_CLIENT_ID.value(),
            token: refreshToken,
          }).toString(),
        }).catch(() => {});
      }
    } catch {
      // Continue with local disconnect even if remote revoke fails.
    }

    await getPlandayPrivateRef().delete().catch(() => {});
    await setPlandayPublicStatus({
      status: "not_connected",
      disconnectedAt: fieldValue.serverTimestamp(),
      disconnectedByEmail: adminUser.email,
      lastError: fieldValue.delete(),
    });

    return {
      ok: true,
    };
  },
);

exports.getPlandayLaborReport = onCall(
  {
    secrets: [PLANDAY_CLIENT_ID, PLANDAY_SCOPES, PLANDAY_REDIRECT_URI],
    cors: true,
  },
  async (request) => {
    requireAdminAuth(request);

    const startAt = parseIsoBoundary(request.data?.startAt, "startAt");
    const endAt = parseIsoBoundary(request.data?.endAt, "endAt");
    const departmentIds = parseDepartmentIds(request.data?.departmentIds);

    if (endAt <= startAt) {
      throw new HttpsError("invalid-argument", "endAt must be after startAt.");
    }
    if (departmentIds.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "At least one Planday department ID is required.",
      );
    }

    const daySpan = (endAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daySpan > SALES_REPORT_MAX_DAYS) {
      throw new HttpsError(
        "invalid-argument",
        `Labor report range cannot exceed ${SALES_REPORT_MAX_DAYS} days.`,
      );
    }

    try {
      const fromDate = formatUtcDate(startAt);
      const toDate = formatUtcDate(new Date(endAt.getTime() - 1));
      const payrollResponse = await fetchPlandayPayroll(
        departmentIds,
        fromDate,
        toDate,
      );
      const summary = buildPlandayLaborSummary(departmentIds, payrollResponse);

      await setPlandayPublicStatus({
        status: "connected",
        lastLaborFetchAt: fieldValue.serverTimestamp(),
        lastError: fieldValue.delete(),
      });

      return {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        departmentIds,
        ...summary,
      };
    } catch (error) {
      logger.error("Planday labor report failed", error);
      const message = normalizeErrorMessage(
        error,
        "Unable to load Planday labor report.",
      );
      await setPlandayPublicStatus({
        status: "error",
        lastError: message,
      });
      throw new HttpsError("internal", message);
    }
  },
);
