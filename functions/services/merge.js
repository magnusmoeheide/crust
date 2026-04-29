function normalizeLocationName(name) {
  return String(name || "").trim();
}

function normalizeIsoDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const directMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function toAmount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round(value) {
  return Number((value || 0).toFixed(2));
}

function getOrCreate(map, location, date) {
  const key = `${date}::${location}`;
  const current = map.get(key) || {
    location,
    date,
    income: 0,
    salaryCost: 0,
    subLocations: [],
  };
  map.set(key, current);
  return current;
}

function mergeByDateAndLocation(zettleData = [], plandayData = []) {
  const merged = new Map();

  for (const row of Array.isArray(zettleData) ? zettleData : []) {
    const location = normalizeLocationName(row?.location);
    const date = normalizeIsoDate(row?.date);
    if (!location || !date) continue;
    const entry = getOrCreate(merged, location, date);
    entry.income += toAmount(row?.income);
    // ✅ Carry sub-locations from Zettle
    if (Array.isArray(row?.subLocations) && row.subLocations.length > 0) {
      entry.subLocations = row.subLocations;
    }
  }

  for (const row of Array.isArray(plandayData) ? plandayData : []) {
    const location = normalizeLocationName(row?.location);
    const date = normalizeIsoDate(row?.date);
    if (!location || !date) continue;
    const entry = getOrCreate(merged, location, date);
    entry.salaryCost += toAmount(row?.salaryCost);
  }

  return Array.from(merged.values())
    .map((row) => ({
      location: row.location,
      date: row.date,
      income: round(row.income),
      salaryCost: round(row.salaryCost),
      profit: round(row.income - row.salaryCost),
      subLocations: row.subLocations || [],
    }))
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return left.location.localeCompare(right.location);
    });
}

function getSummary(data, startDate, endDate, locations = ["all"]) {
  const from = normalizeIsoDate(startDate);
  const to = normalizeIsoDate(endDate);
  if (!from || !to) throw new Error("Invalid startDate or endDate. Use ISO date format.");
  if (from > to) throw new Error("startDate must be before or equal to endDate.");

  const locationFilters = Array.isArray(locations)
    ? locations.map(normalizeLocationName).filter(Boolean)
    : [normalizeLocationName(locations)];
  const includeAllLocations =
    locationFilters.length === 0 || locationFilters.includes("all");

  let totalIncome = 0;
  let totalSalaryCost = 0;

  for (const row of Array.isArray(data) ? data : []) {
    const rowDate = normalizeIsoDate(row?.date);
    if (!rowDate || rowDate < from || rowDate > to) continue;
    const rowLocation = normalizeLocationName(row?.location);
    if (!includeAllLocations && !locationFilters.includes(rowLocation)) continue;
    totalIncome += toAmount(row?.income);
    totalSalaryCost += toAmount(row?.salaryCost);
  }

  return {
    totalIncome: round(totalIncome),
    totalSalaryCost: round(totalSalaryCost),
    profit: round(totalIncome - totalSalaryCost),
  };
}

module.exports = {
  normalizeLocationName,
  mergeByDateAndLocation,
  getSummary,
};