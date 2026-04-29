/**
 * financialReportApi.js
 *
 * Rebuilt from FinancialReport.jsx field usage.
 *
 * loadFinancialReport({ startDate, endDate, location })
 *
 * Returns:
 * {
 *   totalIncome:        number,
 *   totalSalaryCost:    number,
 *   totalProfit:        number,   // negative = loss
 *   profitOrLoss:       "Profit" | "Loss",
 *   profitMargin:       number,   // e.g. 42.5
 *
 *   bestPerformingLocation: {
 *     location:     string,
 *     profit:       number,
 *     profitOrLoss: "Profit" | "Loss",
 *     profitMargin: number,
 *   } | null,
 *
 *   breakdown: [
 *     {
 *       location:     string,
 *       income:       number,
 *       salaryCost:   number,
 *       profit:       number,
 *       profitOrLoss: "Profit" | "Loss",
 *       profitMargin: number,
 *       subLocations: [
 *         { name: string, income: number }
 *       ],
 *     }
 *   ],
 * }
 */

import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "../firebase";

// ─── helpers ────────────────────────────────────────────────────────────────

function toStartOfDay(dateStr) {
  // dateStr: "YYYY-MM-DD"
  const [year, month, day] = dateStr.split("-").map(Number);
  return Timestamp.fromDate(new Date(year, month - 1, day, 0, 0, 0, 0));
}

function toEndOfDay(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Timestamp.fromDate(new Date(year, month - 1, day, 23, 59, 59, 999));
}

function calcMargin(profit, income) {
  if (!income || income === 0) return 0;
  return Math.round((profit / income) * 10000) / 100; // two decimal places
}

// ─── main export ────────────────────────────────────────────────────────────

/**
 * @param {{ startDate: string, endDate: string, location: string }} params
 *   location: comma-separated city names, or "all"
 */
export async function loadFinancialReport({ startDate, endDate, location }) {
  const start = toStartOfDay(startDate);
  const end = toEndOfDay(endDate);

  const locationFilter =
    location === "all" || !location
      ? null
      : location.split(",").map((l) => l.trim()).filter(Boolean);

  // ── 1. Fetch Zettle sales (income) ────────────────────────────────────────
  //    Collection: "sales"  |  fields: amount (number), city (string), location (string), createdAt (Timestamp)
  let salesQuery = query(
    collection(db, "sales"),
    where("createdAt", ">=", start),
    where("createdAt", "<=", end),
  );
  const salesSnap = await getDocs(salesQuery);

  // ── 2. Fetch Planday shifts (salary cost) ─────────────────────────────────
  //    Collection: "shifts"  |  fields: salaryCost (number), city (string), location (string), date (Timestamp or "YYYY-MM-DD")
  let shiftsQuery = query(
    collection(db, "shifts"),
    where("date", ">=", start),
    where("date", "<=", end),
  );
  const shiftsSnap = await getDocs(shiftsQuery);

  // ── 3. Load location metadata (city → sub-locations) ─────────────────────
  const locationsSnap = await getDocs(collection(db, "locations"));
  // Map: city → [{ id, name, city }]
  const cityToSubLocations = {};
  locationsSnap.docs.forEach((d) => {
    const data = d.data();
    const city = String(data.city || data.name || "").trim();
    if (!city) return;
    if (!cityToSubLocations[city]) cityToSubLocations[city] = [];
    cityToSubLocations[city].push({ id: d.id, name: String(data.name || city).trim() });
  });

  // ── 4. Aggregate by city ──────────────────────────────────────────────────
  // incomeByCity:   { city: { total, bySubLocation: { name: number } } }
  // salaryByCity:   { city: number }

  const incomeByCity = {};
  salesSnap.docs.forEach((d) => {
    const data = d.data();
    const city = String(data.city || data.location || "Unknown").trim();
    const subName = String(data.location || data.city || city).trim();
    const amount = Number(data.amount || 0);

    if (!incomeByCity[city]) incomeByCity[city] = { total: 0, bySubLocation: {} };
    incomeByCity[city].total += amount;
    incomeByCity[city].bySubLocation[subName] =
      (incomeByCity[city].bySubLocation[subName] || 0) + amount;
  });

  const salaryByCity = {};
  shiftsSnap.docs.forEach((d) => {
    const data = d.data();
    const city = String(data.city || data.location || "Unknown").trim();
    const cost = Number(data.salaryCost || data.salary_cost || data.cost || 0);
    salaryByCity[city] = (salaryByCity[city] || 0) + cost;
  });

  // ── 5. Determine which cities to include ─────────────────────────────────
  const allCities = Array.from(
    new Set([...Object.keys(incomeByCity), ...Object.keys(salaryByCity)]),
  ).sort((a, b) => a.localeCompare(b, "nb"));

  const cities =
    locationFilter
      ? allCities.filter((c) => locationFilter.includes(c))
      : allCities;

  // ── 6. Build breakdown rows ───────────────────────────────────────────────
  let totalIncome = 0;
  let totalSalaryCost = 0;

  const breakdown = cities.map((city) => {
    const income = incomeByCity[city]?.total || 0;
    const salaryCost = salaryByCity[city] || 0;
    const profit = income - salaryCost;
    const profitOrLoss = profit >= 0 ? "Profit" : "Loss";
    const profitMargin = calcMargin(profit, income);

    totalIncome += income;
    totalSalaryCost += salaryCost;

    // Sub-locations: use the income breakdown by sub-location name
    const subLocationMap = incomeByCity[city]?.bySubLocation || {};
    const subLocations = Object.entries(subLocationMap)
      .map(([name, subIncome]) => ({ name, income: subIncome }))
      .sort((a, b) => b.income - a.income);

    return {
      location: city,
      income,
      salaryCost,
      profit,
      profitOrLoss,
      profitMargin,
      subLocations,
    };
  });

  // ── 7. Totals & best performer ────────────────────────────────────────────
  const totalProfit = totalIncome - totalSalaryCost;
  const profitOrLoss = totalProfit >= 0 ? "Profit" : "Loss";
  const profitMargin = calcMargin(totalProfit, totalIncome);

  // Best = highest profit margin among locations that have income > 0
  const profitRows = breakdown.filter((r) => r.income > 0);
  let bestPerformingLocation = null;
  if (profitRows.length > 0) {
    const best = profitRows.reduce((a, b) =>
      b.profitMargin > a.profitMargin ? b : a,
    );
    bestPerformingLocation = {
      location: best.location,
      profit: best.profit,
      profitOrLoss: best.profitOrLoss,
      profitMargin: best.profitMargin,
    };
  }

  return {
    totalIncome,
    totalSalaryCost,
    totalProfit,
    profitOrLoss,
    profitMargin,
    bestPerformingLocation,
    breakdown,
  };
}