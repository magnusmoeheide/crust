import { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, query } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAdminSession } from "../hooks/useAdminSession";
import { loadFinancialReport } from "../services/financialReportApi";
import { db } from "../firebase";
import "./Admin.css";
import "./FinancialReport.css";

function getDefaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  const toInputDate = (value) => {
    const year = String(value.getFullYear());
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return { startDate: toInputDate(start), endDate: toInputDate(end) };
}

function formatCurrency(value) {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function downloadPDF(report, startDate, endDate) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Financial Report", pageWidth / 2, 18, { align: "center" });

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Period: ${startDate} to ${endDate}`, pageWidth / 2, 26, { align: "center" });

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Summary", 14, 38);

  autoTable(doc, {
    startY: 42,
    head: [["", "Amount"]],
    body: [
      ["Total Income", formatCurrency(report.totalIncome)],
      ["Total Salary Cost", formatCurrency(report.totalSalaryCost)],
      [
        report.profitOrLoss === "Profit" ? "Net Profit" : "Net Loss",
        formatCurrency(Math.abs(report.totalProfit)),
      ],
      ["Profit Margin", `${report.profitMargin}%`],
    ],
    styles: { fontSize: 11 },
    headStyles: { fillColor: [22, 48, 66] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    didParseCell: (data) => {
      if (data.row.index === 2 && data.section === "body") {
        data.cell.styles.textColor =
          report.profitOrLoss === "Profit" ? [0, 128, 0] : [200, 0, 0];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  if (report.bestPerformingLocation) {
    const afterSummary = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Best Performing Location", 14, afterSummary);

    autoTable(doc, {
      startY: afterSummary + 4,
      head: [["Location", "Result", "Amount", "Margin"]],
      body: [[
        report.bestPerformingLocation.location,
        report.bestPerformingLocation.profitOrLoss,
        formatCurrency(Math.abs(report.bestPerformingLocation.profit)),
        `${report.bestPerformingLocation.profitMargin}%`,
      ]],
      styles: { fontSize: 10 },
      headStyles: { fillColor: [22, 48, 66] },
    });
  }

  const afterHighlights = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Breakdown by Location", 14, afterHighlights);

  const pdfRows = [];
  (report.breakdown || []).forEach((row) => {
    pdfRows.push([
      row.location,
      formatCurrency(row.income),
      formatCurrency(row.salaryCost),
      row.profitOrLoss,
      formatCurrency(Math.abs(row.profit)),
      `${row.profitMargin}%`,
    ]);
    // ✅ Only show sub-locations in PDF when there are 2 or more
    if (Array.isArray(row.subLocations) && row.subLocations.length > 1) {
      row.subLocations.forEach((sub) => {
        pdfRows.push([
          `  ${sub.name}`,
          formatCurrency(sub.income),
          "-",
          "-",
          "-",
          "-",
        ]);
      });
    }
  });

  autoTable(doc, {
    startY: afterHighlights + 4,
    head: [["Location", "Income", "Salary Cost", "Result", "Amount", "Margin"]],
    body: pdfRows,
    styles: { fontSize: 10 },
    headStyles: { fillColor: [22, 48, 66] },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    didParseCell: (data) => {
      if (data.column.index === 3 && data.section === "body") {
        if (data.cell.raw === "Profit") {
          data.cell.styles.textColor = [0, 128, 0];
          data.cell.styles.fontStyle = "bold";
        } else if (data.cell.raw === "Loss") {
          data.cell.styles.textColor = [200, 0, 0];
          data.cell.styles.fontStyle = "bold";
        }
      }
      if (
        data.section === "body" &&
        typeof data.cell.raw === "string" &&
        data.cell.raw.startsWith("  ")
      ) {
        data.cell.styles.textColor = [80, 80, 80];
        data.cell.styles.fontSize = 9;
      }
    },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150);
    doc.text(
      `Generated ${new Date().toLocaleDateString("nb-NO")} | Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: "center" }
    );
  }

  doc.save(`financial-report-${startDate}-to-${endDate}.pdf`);
}

function LocationDropdown({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const allValues = options.filter((o) => o.value !== "all").map((o) => o.value);
  const allSelected = allValues.every((v) => selected.includes(v));

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function toggleAll() {
    onChange(allSelected ? [allValues[0]] : [...allValues]);
  }

  function toggle(value) {
    if (selected.includes(value)) {
      if (selected.length === 1) return;
      onChange(selected.filter((l) => l !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const label = allSelected
    ? "All locations"
    : selected.length === 1
    ? selected[0]
    : `${selected.length} locations selected`;

  return (
    <div className="location-dropdown" ref={ref}>
      <button
        type="button"
        className="location-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <span className={`location-dropdown-arrow${open ? " open" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="location-dropdown-menu">
          <label className="location-dropdown-item">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            <span>All locations</span>
          </label>
          <div className="location-dropdown-divider" />
          {allValues.map((val) => (
            <label key={val} className="location-dropdown-item">
              <input
                type="checkbox"
                checked={selected.includes(val)}
                onChange={() => toggle(val)}
              />
              <span>{val}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function FinancialReport() {
  const { user, isAdmin, loading, error, signIn, signOutAdmin } = useAdminSession();
  const defaults = useMemo(() => getDefaultRange(), []);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [locationOptions, setLocationOptions] = useState([{ value: "all", label: "All" }]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportError, setReportError] = useState("");
  const [report, setReport] = useState(null);
  const [expandedLocations, setExpandedLocations] = useState(new Set());

  useEffect(() => {
    if (!isAdmin) {
      setLocationOptions([{ value: "all", label: "All" }]);
      return undefined;
    }

    const unsubscribe = onSnapshot(
      query(collection(db, "locations")),
      (snapshot) => {
        const names = Array.from(
          new Set(
            snapshot.docs
              .map((d) => String(d.data()?.city || d.data()?.name || "").trim())
              .filter(Boolean),
          ),
        ).sort((a, b) => a.localeCompare(b, "nb"));

        const opts = [
          { value: "all", label: "All" },
          ...names.map((name) => ({ value: name, label: name })),
        ];
        setLocationOptions(opts);
        if (selectedLocations.length === 0 && names.length > 0) {
          setSelectedLocations(names);
        }
      },
      (err) => {
        console.error("Could not load locations:", err);
        setLocationOptions([{ value: "all", label: "All" }]);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  function toggleExpanded(location) {
    setExpandedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(location)) {
        next.delete(location);
      } else {
        next.add(location);
      }
      return next;
    });
  }

  async function onGenerateReport() {
    if (!startDate || !endDate) {
      setReportError("Please choose both start and end date.");
      return;
    }
    if (startDate > endDate) {
      setReportError("Start date must be before or equal to end date.");
      return;
    }
    setLoadingReport(true);
    setReportError("");
    try {
      const locations =
        selectedLocations.length === 0 ? "all" : selectedLocations.join(",");
      const data = await loadFinancialReport({ startDate, endDate, location: locations });
      setReport(data);
      // ✅ Auto-expand locations that have 2 or more sub-locations
      const expanded = new Set();
      (data.breakdown || []).forEach((row) => {
        if (Array.isArray(row.subLocations) && row.subLocations.length > 1) {
          expanded.add(row.location);
        }
      });
      setExpandedLocations(expanded);
    } catch (err) {
      setReportError(
        err instanceof Error && err.message
          ? err.message
          : "Could not load financial report.",
      );
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }

  return (
    <div className="admin-page financial-report-page">
      <header className="admin-hero">
        <p className="eyebrow">Admin</p>
        <h1>Financial Report</h1>
        <p className="financial-report-subtitle">
          Compare Zettle income against Planday salary cost by date and location.
        </p>
      </header>

      {!loading && !isAdmin ? (
        <button type="button" className="admin-login-link" onClick={signIn}>
          Admin login
        </button>
      ) : null}
      {!loading && !isAdmin && error ? <p className="forms-error">{error}</p> : null}

      {isAdmin ? (
        <section className="admin-panel">
          <p>Logged in as {user?.email}</p>
          <div className="admin-actions">
            <Link className="admin-button" to="/admin">Back to admin</Link>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={signOutAdmin}
            >
              Sign out
            </button>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Filters</h2>
          <div className="financial-filter-grid">
            <label className="financial-filter-field" htmlFor="financial-start-date">
              <span>Start date</span>
              <input
                id="financial-start-date"
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="financial-filter-field" htmlFor="financial-end-date">
              <span>End date</span>
              <input
                id="financial-end-date"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <div className="financial-filter-field">
              <span>Location</span>
              <LocationDropdown
                options={locationOptions}
                selected={selectedLocations}
                onChange={setSelectedLocations}
              />
            </div>
          </div>

          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-button"
              onClick={onGenerateReport}
              disabled={loadingReport}
            >
              {loadingReport ? "Loading..." : "Generate Report"}
            </button>
          </div>

          {reportError ? <p className="forms-error">{reportError}</p> : null}
        </section>
      ) : null}

      {isAdmin && report ? (
        <>
          {/* Summary cards */}
          <section className="financial-summary-grid">
            <article className="financial-stat-card">
              <span>Total Income</span>
              <strong>{formatCurrency(report.totalIncome)}</strong>
            </article>
            <article className="financial-stat-card">
              <span>Total Salary Cost</span>
              <strong>{formatCurrency(report.totalSalaryCost)}</strong>
            </article>
            <article className={`financial-stat-card ${report.profitOrLoss === "Profit" ? "card-profit" : "card-loss"}`}>
              <span>{report.profitOrLoss}</span>
              <strong>{formatCurrency(Math.abs(report.totalProfit))}</strong>
              <small>{report.profitMargin}% margin</small>
            </article>
          </section>

          {/* Best performing */}
          {report.bestPerformingLocation ? (
            <section className="financial-best-card card-profit">
              <div className="financial-best-label">Best Performing Location</div>
              <div className="financial-best-location">
                {report.bestPerformingLocation.location}
              </div>
              <div className="financial-best-detail">
                {report.bestPerformingLocation.profitOrLoss}{" "}
                {formatCurrency(Math.abs(report.bestPerformingLocation.profit))}{" "}
                &mdash; {report.bestPerformingLocation.profitMargin}% margin
              </div>
            </section>
          ) : null}

          {/* Breakdown table */}
          <section className="admin-panel">
            <div className="financial-table-header">
              <h2>Breakdown by Location</h2>
              <button
                type="button"
                className="admin-button admin-button-secondary"
                onClick={() => downloadPDF(report, startDate, endDate)}
              >
                Download PDF
              </button>
            </div>

            {Array.isArray(report.breakdown) && report.breakdown.length > 0 ? (
              <div className="financial-table-wrap">
                <table className="financial-table">
                  <thead>
                    <tr>
                      <th scope="col">Location</th>
                      <th scope="col">Income</th>
                      <th scope="col">Salary Cost</th>
                      <th scope="col">Result</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.breakdown.map((row) => (
                      <>
                        {/* Main location row */}
                        <tr
                          key={row.location}
                          className={
                            // ✅ Only expandable when 2 or more sub-locations
                            Array.isArray(row.subLocations) && row.subLocations.length > 1
                              ? "location-row-expandable"
                              : ""
                          }
                          onClick={() => {
                            // ✅ Only toggle when 2 or more sub-locations
                            if (Array.isArray(row.subLocations) && row.subLocations.length > 1) {
                              toggleExpanded(row.location);
                            }
                          }}
                        >
                          <td>
                            <span className="location-row-name">
                              {/* ✅ Only show expand icon when 2 or more sub-locations */}
                              {Array.isArray(row.subLocations) && row.subLocations.length > 1 ? (
                                <span className="location-expand-icon">
                                  {expandedLocations.has(row.location) ? "▾" : "▸"}
                                </span>
                              ) : null}
                              {row.location}
                            </span>
                          </td>
                          <td>{formatCurrency(row.income)}</td>
                          <td>{formatCurrency(row.salaryCost)}</td>
                          <td className={row.profitOrLoss === "Profit" ? "text-profit" : "text-loss"}>
                            {row.profitOrLoss}
                          </td>
                          <td>{formatCurrency(Math.abs(row.profit))}</td>
                          <td>{row.profitMargin}%</td>
                        </tr>

                        {/* ✅ Sub-location rows — only when expanded AND 2 or more sub-locations */}
                        {expandedLocations.has(row.location) &&
                          Array.isArray(row.subLocations) &&
                          row.subLocations.length > 1 &&
                          row.subLocations.map((sub) => (
                            <tr key={`${row.location}-${sub.name}`} className="sub-location-row">
                              <td>
                                <span className="sub-location-name">↳ {sub.name}</span>
                              </td>
                              <td>{formatCurrency(sub.income)}</td>
                              <td>—</td>
                              <td>—</td>
                              <td>—</td>
                              <td>—</td>
                            </tr>
                          ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No rows available for the selected filters.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

export default FinancialReport;