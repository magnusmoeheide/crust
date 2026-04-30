const { getIncomeByDateAndLocation } = require("./zettle");
const { getSalaryByDateAndLocation, syncEmployeesToFirestore } = require("./plandayService");

function round(value) {
  return Number((value || 0).toFixed(2));
}

function normalizeLocation(name = "") {
  return String(name).trim().toLowerCase();
}

function buildBreakdownByLocation(mergedData, zettleRows, startDate, endDate, locations) {
  const locationFilters = Array.isArray(locations)
    ? locations.map(normalizeLocation).filter(Boolean)
    : [normalizeLocation(locations)];

  const includeAll = locationFilters.includes("all") || locationFilters.length === 0;

  const grouped = new Map();

  // 1. Merge Zettle + Planday income/cost
  (mergedData || []).forEach((row) => {
    const date = row?.date;
    const location = normalizeLocation(row?.location);

    if (!date || date < startDate || date > endDate) return;
    if (!includeAll && !locationFilters.includes(location)) return;

    if (!grouped.has(location)) {
      grouped.set(location, {
        location,
        income: 0,
        salaryCost: 0,
        profit: 0,
        subLocations: new Map(),
      });
    }

    const entry = grouped.get(location);

    const income = Number(row?.income || 0);
    const cost = Number(row?.salaryCost || 0);

    entry.income += income;
    entry.salaryCost += cost;
    entry.profit += income - cost;
  });

  // 2. Sub-location breakdown (Zettle only)
  (zettleRows || []).forEach((row) => {
    const location = normalizeLocation(row?.location);
    if (!grouped.has(location)) return;

    const entry = grouped.get(location);

    (row.subLocations || []).forEach((sub) => {
      const name = sub?.name;
      const income = Number(sub?.income || 0);

      if (!entry.subLocations.has(name)) {
        entry.subLocations.set(name, { name, income: 0 });
      }

      entry.subLocations.get(name).income += income;
    });
  });

  return Array.from(grouped.values())
    .map((l) => {
      const profitMargin = l.income > 0 ? (l.profit / l.income) * 100 : 0;

      return {
        location: l.location,
        income: round(l.income),
        salaryCost: round(l.salaryCost),
        profit: round(l.profit),
        profitOrLoss: l.profit >= 0 ? "Profit" : "Loss",
        profitMargin: round(profitMargin),
        subLocations: Array.from(l.subLocations.values())
          .map((s) => ({ name: s.name, income: round(s.income) }))
          .sort((a, b) => b.income - a.income),
      };
    })
    .sort((a, b) => b.profit - a.profit);
}

async function getFinancialReport(startDate, endDate, locations = ["all"]) {
  await syncEmployeesToFirestore().catch(() => {});

  const [zettleRows, plandayRows] = await Promise.all([
    getIncomeByDateAndLocation(startDate, endDate),
    getSalaryByDateAndLocation(startDate, endDate),
  ]);

  const merged = mergeByDateAndLocation(zettleRows, plandayRows);
  const summary = getSummary(merged, startDate, endDate, locations);

  const breakdown = buildBreakdownByLocation(
    merged,
    zettleRows,
    startDate,
    endDate,
    locations
  );

  const best = breakdown[0] || null;

  const profit = summary.totalIncome - summary.totalSalaryCost;

  return {
    totalIncome: summary.totalIncome,
    totalSalaryCost: summary.totalSalaryCost,
    totalProfit: profit,
    profit,
    profitOrLoss: profit >= 0 ? "Profit" : "Loss",
    profitMargin:
      summary.totalIncome > 0
        ? round((profit / summary.totalIncome) * 100)
        : 0,
    bestPerformingLocation: best
      ? {
          location: best.location,
          profit: best.profit,
          profitOrLoss: best.profitOrLoss,
          profitMargin: best.profitMargin,
        }
      : null,
    breakdown,
  };
}

module.exports = { getFinancialReport };