import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import "./Admin.css";
import "./Sales.css";

const PLANDAY_SETTINGS_DOC_ID = "plandayIntegration";

function formatDateTime(value) {
  const parsed = value?.toDate?.() || (value ? new Date(value) : null);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return "Ukjent";
  }

  return parsed.toLocaleString("nb-NO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(amount, currency) {
  const normalizedAmount = Number(amount || 0) / 100;
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  if (!normalizedCurrency) {
    return normalizedAmount.toLocaleString("nb-NO", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalizedAmount);
}

function formatLaborCurrency(amount, currencySymbol, currencyFormatString) {
  const formattedAmount = Number(amount || 0).toLocaleString("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const symbol = String(currencySymbol || "").trim();
  const format = String(currencyFormatString || "").trim();

  if (!symbol) {
    return formattedAmount;
  }
  if (format === "{1}{0}") {
    return `${formattedAmount}${symbol}`;
  }
  return `${symbol}${formattedAmount}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${value.toLocaleString("nb-NO", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

function formatDateInputValue(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultDateRange() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 6);

  return {
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
  };
}

function getRangeBoundaries(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  end.setDate(end.getDate() + 1);

  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  };
}

function getSalesErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return "Du har ikke tilgang til salgsdata fra Zettle.";
  }
  if (code === "functions/unauthenticated" || code === "unauthenticated") {
    return "Du må være logget inn som admin.";
  }
  if (
    code === "functions/failed-precondition" ||
    code === "failed-precondition"
  ) {
    return "Zettle er ikke koblet til ennå.";
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallbackMessage;
}

function getPlandayErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return "Du har ikke tilgang til lønnskost fra Planday.";
  }
  if (code === "functions/unauthenticated" || code === "unauthenticated") {
    return "Du må være logget inn som admin.";
  }
  if (
    code === "functions/failed-precondition" ||
    code === "failed-precondition"
  ) {
    return "Planday er ikke koblet til ennå.";
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallbackMessage;
}

function parseDepartmentIds(value) {
  return Array.from(
    new Set(
      Array.isArray(value)
        ? value
            .map((entry) => String(entry || "").trim())
            .filter((entry) => /^\d+$/.test(entry))
        : [],
    ),
  );
}

function buildDailyOverview(salesReport, laborReport) {
  const days = new Map();

  (Array.isArray(salesReport?.dailySales) ? salesReport.dailySales : []).forEach((day) => {
    const key = String(day?.date || "").trim();
    if (!key) {
      return;
    }
    days.set(key, {
      date: key,
      netSalesAmount: Number(day?.netSalesAmount || 0),
      grossSalesAmount: Number(day?.grossSalesAmount || 0),
      laborCost: 0,
      payrollPercentage: null,
    });
  });

  (Array.isArray(laborReport?.dailyLabor) ? laborReport.dailyLabor : []).forEach((day) => {
    const key = String(day?.date || "").trim();
    if (!key) {
      return;
    }
    const current = days.get(key) || {
      date: key,
      netSalesAmount: 0,
      grossSalesAmount: 0,
      laborCost: 0,
      payrollPercentage: null,
    };
    current.laborCost = Number(day?.laborCost || 0);
    days.set(key, current);
  });

  return Array.from(days.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => {
      const netSalesMajor = day.netSalesAmount / 100;
      return {
        ...day,
        payrollPercentage:
          netSalesMajor > 0 ? (day.laborCost / netSalesMajor) * 100 : null,
      };
    });
}

function Sales() {
  const { user, isAdmin, loading, error, signIn, signOutAdmin } =
    useAdminSession();
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [integration, setIntegration] = useState(null);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationError, setIntegrationError] = useState("");
  const [plandayIntegration, setPlandayIntegration] = useState(null);
  const [plandayIntegrationLoading, setPlandayIntegrationLoading] = useState(false);
  const [plandayIntegrationError, setPlandayIntegrationError] = useState("");
  const [plandayDepartmentIds, setPlandayDepartmentIds] = useState([]);
  const [plandaySettingsLoading, setPlandaySettingsLoading] = useState(false);
  const [plandaySettingsError, setPlandaySettingsError] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [report, setReport] = useState(null);
  const [laborReport, setLaborReport] = useState(null);
  const [laborError, setLaborError] = useState("");
  const autoVerifyStartedRef = useRef(false);
  const autoReportStartedRef = useRef(false);

  useEffect(() => {
    if (!isAdmin) {
      setIntegration(null);
      setIntegrationLoading(false);
      setIntegrationError("");
      return undefined;
    }

    setIntegrationLoading(true);
    setIntegrationError("");

    const unsubscribe = onSnapshot(
      doc(db, "integrations", "zettle"),
      (snapshot) => {
        setIntegration(snapshot.exists() ? snapshot.data() : null);
        setIntegrationLoading(false);
      },
      () => {
        setIntegrationError("Could not load Zettle connection status.");
        setIntegrationLoading(false);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setPlandayIntegration(null);
      setPlandayIntegrationLoading(false);
      setPlandayIntegrationError("");
      return undefined;
    }

    setPlandayIntegrationLoading(true);
    setPlandayIntegrationError("");

    const unsubscribe = onSnapshot(
      doc(db, "integrations", "planday"),
      (snapshot) => {
        setPlandayIntegration(snapshot.exists() ? snapshot.data() : null);
        setPlandayIntegrationLoading(false);
      },
      () => {
        setPlandayIntegrationError("Kunne ikke hente Planday-status.");
        setPlandayIntegrationLoading(false);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setPlandayDepartmentIds([]);
      setPlandaySettingsLoading(false);
      setPlandaySettingsError("");
      return;
    }

    async function loadPlandaySettings() {
      setPlandaySettingsLoading(true);
      setPlandaySettingsError("");

      try {
        const snapshot = await getDoc(doc(db, "siteSettings", PLANDAY_SETTINGS_DOC_ID));
        setPlandayDepartmentIds(parseDepartmentIds(snapshot.data()?.departmentIds));
      } catch {
        setPlandaySettingsError("Kunne ikke hente Planday-avdelinger.");
      } finally {
        setPlandaySettingsLoading(false);
      }
    }

    loadPlandaySettings();
  }, [isAdmin]);

  async function onVerifyConnection(options = {}) {
    const { silent = false } = options;

    setVerifyLoading(true);
    setVerifyError("");
    if (!silent) {
      setVerifyMessage("");
    }

    try {
    const verifyConnection = httpsCallable(functions, "verifyZettleConnection");
    const result = await verifyConnection();
    const organizationUuid = String(result.data?.organizationUuid || "").trim();

    if (!silent) {
      setVerifyMessage(
        organizationUuid
          ? `Koblet til organisasjon ${organizationUuid}.`
          : "Tilkoblingen er verifisert.",
      );
    }
  } catch (err) {
    setVerifyError(
        getSalesErrorMessage(err, "Kunne ikke verifisere Zettle-koblingen."),
      );
    } finally {
      setVerifyLoading(false);
    }
  }

  async function onLoadReport(options = {}) {
    const { silent = false } = options;
    if (!startDate || !endDate) {
      setReportError("Velg både startdato og sluttdato.");
      return;
    }

    setReportLoading(true);
    if (!silent) {
      setReportError("");
      setLaborError("");
    }

    try {
      const getSalesReport = httpsCallable(functions, "getZettleSalesReport");
      const { startAt, endAt } = getRangeBoundaries(startDate, endDate);
      const requests = [getSalesReport({ startAt, endAt })];
      const shouldLoadPlanday =
        String(plandayIntegration?.status || "").trim() === "connected" &&
        plandayDepartmentIds.length > 0;

      if (shouldLoadPlanday) {
        const getPlandayLaborReport = httpsCallable(
          functions,
          "getPlandayLaborReport",
        );
        requests.push(
          getPlandayLaborReport({
            startAt,
            endAt,
            departmentIds: plandayDepartmentIds,
          }),
        );
      }

      const [salesResult, plandayResult] = await Promise.all(requests);
      setReport(salesResult.data || null);
      setLaborReport(plandayResult?.data || null);
      if (!shouldLoadPlanday) {
        setLaborReport(null);
      }
    } catch (err) {
      const message = String(err?.message || "");
      if (message.toLowerCase().includes("planday")) {
        setLaborReport(null);
        setLaborError(
          getPlandayErrorMessage(err, "Kunne ikke hente lønnskost fra Planday."),
        );
      } else {
        setReport(null);
        setReportError(
          getSalesErrorMessage(err, "Kunne ikke hente salgsdata fra Zettle."),
        );
      }
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    const isConnected = String(integration?.status || "").trim() === "connected";
    const hasIdentity =
      Boolean(integration?.organizationUuid) && Boolean(integration?.zettleUserUuid);

    if (!isAdmin || !isConnected || hasIdentity || autoVerifyStartedRef.current) {
      return;
    }

    autoVerifyStartedRef.current = true;
    void onVerifyConnection({ silent: true });
  }, [integration?.organizationUuid, integration?.status, integration?.zettleUserUuid, isAdmin]);

  useEffect(() => {
    const isConnected = String(integration?.status || "").trim() === "connected";

    if (
      !isAdmin ||
      !isConnected ||
      plandaySettingsLoading ||
      autoReportStartedRef.current
    ) {
      return;
    }

    autoReportStartedRef.current = true;
    void onLoadReport({ silent: true });
  }, [
    integration?.status,
    isAdmin,
    startDate,
    endDate,
    plandayIntegration?.status,
    plandayDepartmentIds,
    plandaySettingsLoading,
  ]);

  const connectionStatus = String(integration?.status || "not_connected").trim();
  const plandayStatus = String(
    plandayIntegration?.status || "not_connected",
  ).trim();
  const dailyOverview = buildDailyOverview(report, laborReport);
  const payrollPercentage =
    report?.netSalesAmount > 0 && Number.isFinite(laborReport?.totalLaborCost)
      ? (laborReport.totalLaborCost / (report.netSalesAmount / 100)) * 100
      : null;

  return (
    <div className="admin-page sales-page">
      <header className="admin-hero">
        <p className="eyebrow">Admin</p>
        <h1>Salg</h1>
        <p className="sales-subtitle">
          Livedata for salg hentet fra Zettle via Firebase Functions.
        </p>
      </header>

      {!loading && !isAdmin ? (
        <button type="button" className="admin-login-link" onClick={signIn}>
          Admin-innlogging
        </button>
      ) : null}
      {!loading && !isAdmin && error ? <p className="forms-error">{error}</p> : null}

      {isAdmin ? (
        <section className="admin-panel">
          <p>Innlogget som {user?.email}</p>
          <div className="admin-actions">
            <Link className="admin-button" to="/admin">
              Tilbake til admin
            </Link>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={signOutAdmin}
            >
              Logg ut
            </button>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Zettle-kobling</h2>
          <p className={`admin-status-badge is-${connectionStatus}`}>
            {connectionStatus === "connected"
              ? "Koblet til"
              : connectionStatus === "error"
                ? "Feil"
                : connectionStatus === "pending"
                  ? "Venter"
                  : "Ikke koblet til"}
          </p>
          {integrationLoading ? <p>Laster koblingsstatus...</p> : null}
          {integrationError ? (
            <p className="forms-error">{integrationError}</p>
          ) : null}
          {verifyError ? <p className="forms-error">{verifyError}</p> : null}
          {verifyMessage ? <p className="forms-success">{verifyMessage}</p> : null}
          <div className="admin-detail-list">
            <p>
              <strong>Koblet til av:</strong> {integration?.connectedByEmail || "-"}
            </p>
            <p>
              <strong>Koblet til:</strong> {formatDateTime(integration?.connectedAt)}
            </p>
            <p>
              <strong>Organisasjons-UUID:</strong> {integration?.organizationUuid || "-"}
            </p>
            <p>
              <strong>Bruker-UUID:</strong> {integration?.zettleUserUuid || "-"}
            </p>
            <p>
              <strong>Verifisert:</strong> {formatDateTime(integration?.verifiedAt)}
            </p>
            <p>
              <strong>Scope:</strong> {integration?.scope || "-"}
            </p>
            <p>
              <strong>Siste feil:</strong> {integration?.lastError || "-"}
            </p>
          </div>
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={() => onVerifyConnection()}
              disabled={verifyLoading || connectionStatus !== "connected"}
            >
              {verifyLoading ? "Verifiserer..." : "Verifiser kobling"}
            </button>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Planday-kobling</h2>
          <p className={`admin-status-badge is-${plandayStatus}`}>
            {plandayStatus === "connected"
              ? "Koblet til"
              : plandayStatus === "error"
                ? "Feil"
                : plandayStatus === "pending"
                  ? "Venter"
                  : "Ikke koblet til"}
          </p>
          {plandayIntegrationLoading ? <p>Laster Planday-status...</p> : null}
          {plandayIntegrationError ? (
            <p className="forms-error">{plandayIntegrationError}</p>
          ) : null}
          {plandaySettingsError ? (
            <p className="forms-error">{plandaySettingsError}</p>
          ) : null}
          <div className="admin-detail-list">
            <p>
              <strong>Koblet til av:</strong>{" "}
              {plandayIntegration?.connectedByEmail || "-"}
            </p>
            <p>
              <strong>Koblet til:</strong>{" "}
              {formatDateTime(plandayIntegration?.connectedAt)}
            </p>
            <p>
              <strong>Avdelinger:</strong>{" "}
              {plandaySettingsLoading
                ? "Laster..."
                : plandayDepartmentIds.length > 0
                  ? plandayDepartmentIds.join(", ")
                  : "Ingen lagret"}
            </p>
            <p>
              <strong>Scope:</strong> {plandayIntegration?.scope || "-"}
            </p>
            <p>
              <strong>Siste feil:</strong> {plandayIntegration?.lastError || "-"}
            </p>
          </div>
          <p className="admin-muted">
            Lønnskost hentes fra Planday Payroll API for avdelingene som er lagret
            på /admin.
          </p>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Rapportperiode</h2>
          <div className="sales-filter-grid">
            <label className="sales-field">
              <span>Startdato</span>
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label className="sales-field">
              <span>Sluttdato</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </label>
          </div>
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-button"
              onClick={() => onLoadReport()}
              disabled={reportLoading || connectionStatus !== "connected"}
            >
              {reportLoading ? "Laster..." : "Hent salg"}
            </button>
          </div>
          {reportError ? <p className="forms-error">{reportError}</p> : null}
          {laborError ? <p className="forms-error">{laborError}</p> : null}
          {report?.truncated ? (
            <p className="admin-muted">
              Rapporten traff sidegrensen, så noen eldre kjøp kan være utelatt.
            </p>
          ) : null}
        </section>
      ) : null}

      {isAdmin && report ? (
        <>
          <section className="sales-summary-grid">
            <article className="sales-stat-card">
              <span>Netto salg</span>
              <strong>{formatCurrency(report.netSalesAmount, report.currency)}</strong>
            </article>
            <article className="sales-stat-card">
              <span>Brutto salg</span>
              <strong>{formatCurrency(report.grossSalesAmount, report.currency)}</strong>
            </article>
            <article className="sales-stat-card">
              <span>Refunderinger</span>
              <strong>{formatCurrency(report.refundAmount, report.currency)}</strong>
            </article>
            <article className="sales-stat-card">
              <span>Ordre</span>
              <strong>{report.salesCount}</strong>
            </article>
            <article className="sales-stat-card">
              <span>Refunderte poster</span>
              <strong>{report.refundCount}</strong>
            </article>
            <article className="sales-stat-card">
              <span>Totale poster</span>
              <strong>{report.recordCount}</strong>
            </article>
            <article className="sales-stat-card">
              <span>Lønnskost</span>
              <strong>
                {laborReport
                  ? formatLaborCurrency(
                      laborReport.totalLaborCost,
                      laborReport.currencySymbol,
                      laborReport.currencyFormatString,
                    )
                  : "-"}
              </strong>
            </article>
            <article className="sales-stat-card">
              <span>Lønnsprosent</span>
              <strong>{formatPercent(payrollPercentage)}</strong>
            </article>
          </section>

          {dailyOverview.length > 0 ? (
            <section className="admin-panel">
              <h2>Per dag</h2>
              <div className="sales-list">
                {dailyOverview.map((day) => (
                  <div key={day.date} className="sales-list-row sales-daily-row">
                    <div>
                      <strong>{day.date}</strong>
                      <p>
                        Netto salg:{" "}
                        {formatCurrency(day.netSalesAmount, report.currency)}
                      </p>
                    </div>
                    <div className="sales-daily-metrics">
                      <span>
                        Lønnskost:{" "}
                        {laborReport
                          ? formatLaborCurrency(
                              day.laborCost,
                              laborReport.currencySymbol,
                              laborReport.currencyFormatString,
                            )
                          : "-"}
                      </span>
                      <span>Lønnsprosent: {formatPercent(day.payrollPercentage)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="admin-panel">
            <h2>Betalingsfordeling</h2>
            {Array.isArray(report.paymentBreakdown) &&
            report.paymentBreakdown.length > 0 ? (
              <div className="sales-list">
                {report.paymentBreakdown.map((entry) => (
                  <div key={entry.type} className="sales-list-row">
                    <span>{entry.type}</span>
                    <strong>{formatCurrency(entry.amount, report.currency)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p>Ingen betalinger funnet i denne perioden.</p>
            )}
          </section>

          <section className="admin-panel">
            <h2>Topp-produkter</h2>
            {Array.isArray(report.topProducts) && report.topProducts.length > 0 ? (
              <div className="sales-list">
                {report.topProducts.map((product) => (
                  <div key={product.name} className="sales-list-row">
                    <div>
                      <strong>{product.name}</strong>
                      <p>{product.quantity} solgt</p>
                    </div>
                    <strong>{formatCurrency(product.amount, report.currency)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p>Ingen produkter funnet i denne perioden.</p>
            )}
          </section>

          <section className="admin-panel">
            <h2>Kjøp</h2>
            {Array.isArray(report.purchases) && report.purchases.length > 0 ? (
              <div className="sales-purchase-list">
                {report.purchases.map((purchase) => (
                  <article
                    key={purchase.purchaseUuid || `${purchase.timestamp}-${purchase.amount}`}
                    className="sales-purchase-card"
                  >
                    <div className="sales-purchase-topline">
                      <div>
                        <strong>
                          {formatCurrency(purchase.amount, purchase.currency)}
                        </strong>
                        <p>{formatDateTime(purchase.timestamp)}</p>
                      </div>
                      <span
                        className={`sales-purchase-badge ${
                          purchase.refund ? "is-refund" : "is-sale"
                        }`}
                      >
                        {purchase.refund ? "Refundering" : "Salg"}
                      </span>
                    </div>
                    <div className="sales-purchase-meta">
                      <p>
                        <strong>Kjøp #:</strong> {purchase.purchaseNumber ?? "-"}
                      </p>
                      <p>
                        <strong>Ansatt:</strong> {purchase.userDisplayName || "-"}
                      </p>
                      <p>
                        <strong>Betalinger:</strong>{" "}
                        {purchase.paymentTypes?.join(", ") || "-"}
                      </p>
                      <p>
                        <strong>Produkter:</strong>{" "}
                        {purchase.productNames?.join(", ") || "-"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>Ingen kjøp funnet i denne perioden.</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

export default Sales;
