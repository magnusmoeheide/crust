const { getIncomeByDateAndLocation } = require("./zettle");
const { getSalaryByDateAndLocation, syncEmployeesToFirestore } = require("./plandayService");
const {
  mergeByDateAndLocation,
  getSummary,
  normalizeLocationName,
} = require("./merge");

function round(value) {
  return Number((value || 0).toFixed(2));
}

function buildBreakdownByLocation(mergedData, zettleRows, startDate, endDate, locations) {
  const locationFilters = Array.isArray(locations)
    ? locations.map(normalizeLocationName).filter(Boolean)
    : [normalizeLocationName(locations)];
  const includeAllLocations =
    locationFilters.length === 0 || locationFilters.includes("all");

  const grouped = new Map();

  // ✅ First pass — build grouped data from merged rows
  (Array.isArray(mergedData) ? mergedData : []).forEach((row) => {
    const rowDate = String(row?.date || "").trim();
    const rowLocation = normalizeLocationName(row?.location || "");

    if (!rowDate || rowDate < startDate || rowDate > endDate) return;
    if (!includeAllLocations && !locationFilters.includes(rowLocation)) return;

    const current = grouped.get(rowLocation) || {
      location: rowLocation,
      income: 0,
      salaryCost: 0,
      profit: 0,
      subLocations: new Map(),
    };

    const income = Number(row?.income || 0);
    const salaryCost = Number(row?.salaryCost || 0);

    current.income += income;
    current.salaryCost += salaryCost;
    current.profit += income - salaryCost;

    grouped.set(rowLocation, current);
  });

  // ✅ Second pass — aggregate sub-locations from Zettle rows
  (Array.isArray(zettleRows) ? zettleRows : []).forEach((row) => {
    const rowDate = String(row?.date || "").trim();
    const rowLocation = normalizeLocationName(row?.location || "");

    if (!rowDate || rowDate < startDate || rowDate > endDate) return;
    if (!includeAllLocations && !locationFilters.includes(rowLocation)) return;
    if (!Array.isArray(row.subLocations) || row.subLocations.length === 0) return;

    const current = grouped.get(rowLocation);
    if (!current) return;

    row.subLocations.forEach((sub) => {
      const subName = String(sub?.name || "").trim();
      if (!subName) return;
      const subCurrent = current.subLocations.get(subName) || {
        name: subName,
        income: 0,
      };
      subCurrent.income += Number(sub?.income || 0);
      current.subLocations.set(subName, subCurrent);
    });

    grouped.set(rowLocation, current);
  });

  return Array.from(grouped.values())
    .map((entry) => ({
      location: entry.location,
      income: round(entry.income),
      salaryCost: round(entry.salaryCost),
      profit: round(entry.profit),
      profitOrLoss: round(entry.profit) >= 0 ? "Profit" : "Loss",
      profitMargin:
        entry.income > 0
          ? round((entry.profit / entry.income) * 100)
          : 0,
      subLocations: Array.from(entry.subLocations.values())
        .map((s) => ({ name: s.name, income: round(s.income) }))
        .sort((a, b) => b.income - a.income),
    }))
    .sort((a, b) => b.profit - a.profit);
}

async function getFinancialReport(startDate, endDate, locations = ["all"]) {
  const locationArray = Array.isArray(locations) ? locations : [locations];

  try {
    await syncEmployeesToFirestore();
  } catch (err) {
    console.warn("⚠️ Employee sync failed (non-fatal):", err.message);
  }

  const [zettleRows, plandayRows] = await Promise.all([
    getIncomeByDateAndLocation(startDate, endDate),
    getSalaryByDateAndLocation(startDate, endDate),
  ]);

  const merged = mergeByDateAndLocation(zettleRows, plandayRows);
  const summary = getSummary(merged, startDate, endDate, locationArray);

  // ✅ Pass zettleRows so sub-locations are available
  const breakdown = buildBreakdownByLocation(
    merged,
    zettleRows,
    startDate,
    endDate,
    locationArray
  );

  const bestLocation = breakdown[0] || null;
  const totalProfit = summary.profit;

  return {
    totalIncome: summary.totalIncome,
    totalSalaryCost: summary.totalSalaryCost,
    totalProfit,
    profit: totalProfit,
    profitOrLoss: totalProfit >= 0 ? "Profit" : "Loss",
    profitMargin:
      summary.totalIncome > 0
        ? round((totalProfit / summary.totalIncome) * 100)
        : 0,
    bestPerformingLocation: bestLocation
      ? {
          location: bestLocation.location,
          profit: bestLocation.profit,
          profitOrLoss: bestLocation.profitOrLoss,
          profitMargin: bestLocation.profitMargin,
        }
      : null,
    breakdown,
  };
}

module.exports = {
  getFinancialReport,
};