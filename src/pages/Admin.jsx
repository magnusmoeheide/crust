import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import {
  JOB_APPLICATIONS_DOC_ID,
  JOB_PORTAL_STATUS_CLOSED,
  JOB_PORTAL_STATUS_OPEN,
  JOB_PORTAL_STATUS_WAITLIST,
  JOB_PORTAL_WAITLIST_COLLECTION,
  SITE_SETTINGS_COLLECTION,
} from "../config/siteSettings";
import "./Admin.css";

const JOB_PORTAL_STATUS_LABELS = {
  [JOB_PORTAL_STATUS_OPEN]: "Apply (open)",
  [JOB_PORTAL_STATUS_CLOSED]: "Closed",
  [JOB_PORTAL_STATUS_WAITLIST]: "Register email",
};
const PLANDAY_SETTINGS_DOC_ID = "plandayIntegration";

function getPortalStatus(data) {
  const status = data?.jobPortalStatus;
  if (
    status === JOB_PORTAL_STATUS_OPEN ||
    status === JOB_PORTAL_STATUS_CLOSED ||
    status === JOB_PORTAL_STATUS_WAITLIST
  ) {
    return status;
  }

  if (typeof data?.acceptingApplications === "boolean") {
    return data.acceptingApplications
      ? JOB_PORTAL_STATUS_OPEN
      : JOB_PORTAL_STATUS_CLOSED;
  }

  return JOB_PORTAL_STATUS_OPEN;
}

function getSettingsErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "permission-denied") {
    return "Ingen tilgang til å endre innstillinger. Sjekk at du er logget inn med @crust.no og at Firestore-regler er deployet.";
  }
  if (code === "unauthenticated") {
    return "Du må være logget inn for å endre innstillinger.";
  }
  return fallbackMessage;
}

function formatDateTime(timestamp) {
  const date = timestamp?.toDate?.();
  if (!date) {
    return "Ukjent tidspunkt";
  }
  return date.toLocaleString("nb-NO");
}

function getIntegrationErrorMessage(error, fallbackMessage) {
  const code = error?.code || "";
  if (code === "functions/permission-denied" || code === "permission-denied") {
    return "Ingen tilgang til integrasjonen. Sjekk admin-innloggingen.";
  }
  if (code === "functions/unauthenticated" || code === "unauthenticated") {
    return "Du må være logget inn som admin for å koble til.";
  }
  return fallbackMessage;
}

function getZettleStatusLabel(status) {
  if (status === "connected") {
    return "Connected";
  }
  if (status === "error") {
    return "Error";
  }
  if (status === "pending") {
    return "Pending";
  }
  return "Not connected";
}

function getPlandayStatusLabel(status) {
  if (status === "connected") {
    return "Connected";
  }
  if (status === "error") {
    return "Error";
  }
  if (status === "pending") {
    return "Pending";
  }
  return "Not connected";
}

function parseDepartmentIdsInput(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .filter((entry) => /^\d+$/.test(entry)),
    ),
  );
}

function Admin() {
  const { user, isAdmin, loading, error, signIn, signOutAdmin } =
    useAdminSession();
  const [portalStatus, setPortalStatus] = useState(JOB_PORTAL_STATUS_OPEN);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [waitlistEntries, setWaitlistEntries] = useState([]);
  const [waitlistLoading, setWaitlistLoading] = useState(true);
  const [waitlistError, setWaitlistError] = useState("");
  const [deletingEntryId, setDeletingEntryId] = useState("");
  const [zettleConnection, setZettleConnection] = useState(null);
  const [zettleLoading, setZettleLoading] = useState(false);
  const [zettleError, setZettleError] = useState("");
  const [zettleAction, setZettleAction] = useState("");
  const [zettleMessage, setZettleMessage] = useState("");
  const [plandayConnection, setPlandayConnection] = useState(null);
  const [plandayLoading, setPlandayLoading] = useState(false);
  const [plandayError, setPlandayError] = useState("");
  const [plandayAction, setPlandayAction] = useState("");
  const [plandayMessage, setPlandayMessage] = useState("");
  const [plandaySettingsLoading, setPlandaySettingsLoading] = useState(false);
  const [plandaySettingsSaving, setPlandaySettingsSaving] = useState(false);
  const [plandaySettingsError, setPlandaySettingsError] = useState("");
  const [plandaySettingsMessage, setPlandaySettingsMessage] = useState("");
  const [plandayDepartmentIdsInput, setPlandayDepartmentIdsInput] = useState("");

  useEffect(() => {
    async function loadSettings() {
      setSettingsLoading(true);
      setSettingsError("");
      try {
        const snapshot = await getDoc(
          doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
        );
        setPortalStatus(getPortalStatus(snapshot.data()));
      } catch (err) {
        setSettingsError(
          getSettingsErrorMessage(
            err,
            "Kunne ikke hente innstillinger akkurat nå.",
          ),
        );
      } finally {
        setSettingsLoading(false);
      }
    }

    loadSettings();
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setWaitlistEntries([]);
      setWaitlistLoading(false);
      setWaitlistError("");
      return;
    }

    setWaitlistLoading(true);
    setWaitlistError("");

    const waitlistQuery = query(
      collection(db, JOB_PORTAL_WAITLIST_COLLECTION),
      orderBy("createdAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      waitlistQuery,
      (snapshot) => {
        setWaitlistEntries(
          snapshot.docs.map((entry) => ({
            id: entry.id,
            ...entry.data(),
          })),
        );
        setWaitlistLoading(false);
      },
      () => {
        setWaitlistError("Kunne ikke hente e-postregistreringer.");
        setWaitlistLoading(false);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setZettleConnection(null);
      setZettleLoading(false);
      setZettleError("");
      setZettleMessage("");
      return undefined;
    }

    setZettleLoading(true);
    setZettleError("");

    const unsubscribe = onSnapshot(
      doc(db, "integrations", "zettle"),
      (snapshot) => {
        setZettleConnection(snapshot.exists() ? snapshot.data() : null);
        setZettleLoading(false);
      },
      () => {
        setZettleError("Kunne ikke hente Zettle-status.");
        setZettleLoading(false);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setPlandayConnection(null);
      setPlandayLoading(false);
      setPlandayError("");
      setPlandayMessage("");
      return undefined;
    }

    setPlandayLoading(true);
    setPlandayError("");

    const unsubscribe = onSnapshot(
      doc(db, "integrations", "planday"),
      (snapshot) => {
        setPlandayConnection(snapshot.exists() ? snapshot.data() : null);
        setPlandayLoading(false);
      },
      () => {
        setPlandayError("Kunne ikke hente Planday-status.");
        setPlandayLoading(false);
      },
    );

    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setPlandayDepartmentIdsInput("");
      setPlandaySettingsLoading(false);
      setPlandaySettingsError("");
      setPlandaySettingsMessage("");
      return;
    }

    async function loadPlandaySettings() {
      setPlandaySettingsLoading(true);
      setPlandaySettingsError("");

      try {
        const snapshot = await getDoc(
          doc(db, SITE_SETTINGS_COLLECTION, PLANDAY_SETTINGS_DOC_ID),
        );
        const departmentIds = Array.isArray(snapshot.data()?.departmentIds)
          ? snapshot.data().departmentIds
          : [];
        setPlandayDepartmentIdsInput(departmentIds.join(", "));
      } catch (err) {
        setPlandaySettingsError(
          getSettingsErrorMessage(
            err,
            "Kunne ikke hente Planday-innstillingene akkurat nå.",
          ),
        );
      } finally {
        setPlandaySettingsLoading(false);
      }
    }

    loadPlandaySettings();
  }, [isAdmin]);

  async function onSavePortalStatus() {
    setSaving(true);
    setSettingsError("");
    setStatusMessage("");

    try {
      await setDoc(
        doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
        {
          jobPortalStatus: portalStatus,
          acceptingApplications: portalStatus === JOB_PORTAL_STATUS_OPEN,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "admin",
        },
        { merge: true },
      );
      setStatusMessage(
        `Status for /jobb er oppdatert til: ${JOB_PORTAL_STATUS_LABELS[portalStatus]}.`,
      );
    } catch (err) {
      setSettingsError(
        getSettingsErrorMessage(
          err,
          "Kunne ikke lagre innstillingen. Prøv igjen.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteWaitlistEntry(entryId) {
    setWaitlistError("");
    setDeletingEntryId(entryId);
    try {
      await deleteDoc(doc(db, JOB_PORTAL_WAITLIST_COLLECTION, entryId));
    } catch {
      setWaitlistError("Kunne ikke slette registreringen. Prøv igjen.");
    } finally {
      setDeletingEntryId("");
    }
  }

  function onRequestDeleteWaitlistEntry(entry) {
    const confirmed = window.confirm("Sikker på at du vil slette registreringen?");
    if (!confirmed) {
      return;
    }
    onDeleteWaitlistEntry(entry.id);
  }

  async function onConnectZettle() {
    setZettleAction("connect");
    setZettleError("");
    setZettleMessage("");

    try {
      const createSession = httpsCallable(functions, "createZettleAuthSession");
      const result = await createSession();
      const authUrl = String(result.data?.authUrl || "");

      if (!authUrl) {
        throw new Error("No auth URL returned.");
      }

      window.location.assign(authUrl);
    } catch (err) {
      setZettleError(
        getIntegrationErrorMessage(
          err,
          "Kunne ikke starte Zettle-innloggingen. Sjekk at functions og secrets er satt opp.",
        ),
      );
      setZettleAction("");
    }
  }

  async function onDisconnectZettle() {
    const confirmed = window.confirm("Koble fra Zettle og slette lagrede tokens?");
    if (!confirmed) {
      return;
    }

    setZettleAction("disconnect");
    setZettleError("");
    setZettleMessage("");

    try {
      const disconnect = httpsCallable(functions, "disconnectZettle");
      await disconnect();
      setZettleMessage("Zettle er koblet fra.");
    } catch (err) {
      setZettleError(
        getIntegrationErrorMessage(err, "Kunne ikke koble fra Zettle akkurat nå."),
      );
    } finally {
      setZettleAction("");
    }
  }

  async function onConnectPlanday() {
    setPlandayAction("connect");
    setPlandayError("");
    setPlandayMessage("");

    try {
      const createSession = httpsCallable(functions, "createPlandayAuthSession");
      const result = await createSession();
      const authUrl = String(result.data?.authUrl || "");

      if (!authUrl) {
        throw new Error("No auth URL returned.");
      }

      window.location.assign(authUrl);
    } catch (err) {
      setPlandayError(
        getIntegrationErrorMessage(
          err,
          "Kunne ikke starte Planday-innloggingen. Sjekk at functions og secrets er satt opp.",
        ),
      );
      setPlandayAction("");
    }
  }

  async function onDisconnectPlanday() {
    const confirmed = window.confirm("Koble fra Planday og slette lagrede tokens?");
    if (!confirmed) {
      return;
    }

    setPlandayAction("disconnect");
    setPlandayError("");
    setPlandayMessage("");

    try {
      const disconnect = httpsCallable(functions, "disconnectPlanday");
      await disconnect();
      setPlandayMessage("Planday er koblet fra.");
    } catch (err) {
      setPlandayError(
        getIntegrationErrorMessage(
          err,
          "Kunne ikke koble fra Planday akkurat nå.",
        ),
      );
    } finally {
      setPlandayAction("");
    }
  }

  async function onSavePlandaySettings() {
    setPlandaySettingsSaving(true);
    setPlandaySettingsError("");
    setPlandaySettingsMessage("");

    try {
      const departmentIds = parseDepartmentIdsInput(plandayDepartmentIdsInput);
      await setDoc(
        doc(db, SITE_SETTINGS_COLLECTION, PLANDAY_SETTINGS_DOC_ID),
        {
          departmentIds,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "admin",
        },
        { merge: true },
      );
      setPlandayDepartmentIdsInput(departmentIds.join(", "));
      setPlandaySettingsMessage("Planday-avdelinger er lagret.");
    } catch (err) {
      setPlandaySettingsError(
        getSettingsErrorMessage(
          err,
          "Kunne ikke lagre Planday-innstillingene. Prøv igjen.",
        ),
      );
    } finally {
      setPlandaySettingsSaving(false);
    }
  }

  const zettleStatus = String(zettleConnection?.status || "not_connected").trim();
  const plandayStatus = String(
    plandayConnection?.status || "not_connected",
  ).trim();

  return (
    <div className="admin-page">
      <header className="admin-hero">
        <p className="eyebrow">Admin</p>
        <h1>Administrasjon</h1>
      </header>

      {!loading && !isAdmin ? (
        <button type="button" className="admin-login-link" onClick={signIn}>
          Admin login
        </button>
      ) : null}
      {!loading && !isAdmin && error ? (
        <p className="forms-error">{error}</p>
      ) : null}

      {isAdmin && (
        <section className="admin-panel">
          {loading ? <p>Kontrollerer innlogging...</p> : null}

          {isAdmin ? (
            <>
              <p>Innlogget som {user?.email}</p>
              <div className="admin-actions">
                <Link className="admin-button" to="/skjema">
                  Gå til /skjema
                </Link>
                <Link className="admin-button admin-button-secondary" to="/admin/leverandører">
                  Leverandører
                </Link>
                <Link className="admin-button admin-button-secondary" to="/sales">
                  Open sales
                </Link>
                <button
                  type="button"
                  className="admin-button admin-button-secondary"
                  onClick={signOutAdmin}
                >
                  Logg ut
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Zettle</h2>
          <p className={`admin-status-badge is-${zettleStatus}`}>
            {getZettleStatusLabel(zettleStatus)}
          </p>
          {zettleLoading ? <p>Laster Zettle-status...</p> : null}
          {zettleError ? <p className="forms-error">{zettleError}</p> : null}
          {zettleMessage ? <p className="forms-success">{zettleMessage}</p> : null}
          <p className="admin-muted">
            OAuth er satt opp via Firebase Functions. Tokens lagres serverside og vises
            ikke i klienten.
          </p>
          <div className="admin-detail-list">
            <p>
              <strong>Connected by:</strong>{" "}
              {zettleConnection?.connectedByEmail || "-"}
            </p>
            <p>
              <strong>Connected at:</strong>{" "}
              {formatDateTime(zettleConnection?.connectedAt)}
            </p>
            <p>
              <strong>Organization UUID:</strong>{" "}
              {zettleConnection?.organizationUuid || "-"}
            </p>
            <p>
              <strong>User UUID:</strong> {zettleConnection?.zettleUserUuid || "-"}
            </p>
            <p>
              <strong>Scope:</strong> {zettleConnection?.scope || "-"}
            </p>
            <p>
              <strong>Last error:</strong> {zettleConnection?.lastError || "-"}
            </p>
          </div>
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-button"
              onClick={onConnectZettle}
              disabled={zettleAction === "connect"}
            >
              {zettleAction === "connect" ? "Starter..." : "Connect Zettle"}
            </button>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={onDisconnectZettle}
              disabled={zettleAction === "disconnect" || zettleStatus === "not_connected"}
            >
              {zettleAction === "disconnect" ? "Kobler fra..." : "Disconnect"}
            </button>
            <a
              className="admin-button admin-button-secondary"
              href="https://developer.zettle.com/"
              target="_blank"
              rel="noreferrer"
            >
              Open Zettle Developer Portal
            </a>
            <Link className="admin-button admin-button-secondary" to="/sales">
              Open sales
            </Link>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Planday</h2>
          <p className={`admin-status-badge is-${plandayStatus}`}>
            {getPlandayStatusLabel(plandayStatus)}
          </p>
          {plandayLoading ? <p>Laster Planday-status...</p> : null}
          {plandayError ? <p className="forms-error">{plandayError}</p> : null}
          {plandayMessage ? <p className="forms-success">{plandayMessage}</p> : null}
          <p className="admin-muted">
            Brukes for å hente lønnskost fra Time and Cost API. Tokens lagres
            serverside i Firebase Functions.
          </p>
          <div className="admin-detail-list">
            <p>
              <strong>Koblet til av:</strong>{" "}
              {plandayConnection?.connectedByEmail || "-"}
            </p>
            <p>
              <strong>Koblet til:</strong>{" "}
              {formatDateTime(plandayConnection?.connectedAt)}
            </p>
            <p>
              <strong>Scope:</strong> {plandayConnection?.scope || "-"}
            </p>
            <p>
              <strong>Siste feil:</strong> {plandayConnection?.lastError || "-"}
            </p>
          </div>
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-button"
              onClick={onConnectPlanday}
              disabled={plandayAction === "connect"}
            >
              {plandayAction === "connect" ? "Starter..." : "Koble til Planday"}
            </button>
            <button
              type="button"
              className="admin-button admin-button-secondary"
              onClick={onDisconnectPlanday}
              disabled={
                plandayAction === "disconnect" || plandayStatus === "not_connected"
              }
            >
              {plandayAction === "disconnect" ? "Kobler fra..." : "Koble fra"}
            </button>
          </div>
          <hr className="admin-divider" />
          <label htmlFor="planday-department-ids">
            Department IDs for lønnskost
          </label>
          <textarea
            id="planday-department-ids"
            className="admin-text-input"
            rows={3}
            value={plandayDepartmentIdsInput}
            onChange={(event) => setPlandayDepartmentIdsInput(event.target.value)}
            disabled={plandaySettingsLoading || plandaySettingsSaving}
            placeholder="Eksempel: 101, 102, 205"
          />
          <p className="admin-muted">
            Legg inn én eller flere Planday department IDs, separert med komma
            eller linjeskift. Disse brukes i /sales for å hente lønnskost per dag.
          </p>
          {plandaySettingsError ? (
            <p className="forms-error">{plandaySettingsError}</p>
          ) : null}
          {plandaySettingsMessage ? (
            <p className="forms-success">{plandaySettingsMessage}</p>
          ) : null}
          <div className="admin-inline-actions">
            <button
              type="button"
              className="admin-button"
              onClick={onSavePlandaySettings}
              disabled={plandaySettingsLoading || plandaySettingsSaving}
            >
              {plandaySettingsSaving ? "Lagrer..." : "Lagre avdelinger"}
            </button>
            <Link className="admin-button admin-button-secondary" to="/sales">
              Åpne salg
            </Link>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>Søknader på /jobb</h2>
          {settingsLoading ? <p>Laster innstillinger...</p> : null}
          {settingsError ? <p className="forms-error">{settingsError}</p> : null}
          <p>
            Status: <strong>{JOB_PORTAL_STATUS_LABELS[portalStatus]}</strong>
          </p>
          <label htmlFor="job-portal-status">Velg status</label>
          <select
            id="job-portal-status"
            className="admin-status-select"
            value={portalStatus}
            onChange={(event) => setPortalStatus(event.target.value)}
            disabled={settingsLoading || saving}
          >
            <option value={JOB_PORTAL_STATUS_OPEN}>Apply (open)</option>
            <option value={JOB_PORTAL_STATUS_CLOSED}>Closed</option>
            <option value={JOB_PORTAL_STATUS_WAITLIST}>Register email</option>
          </select>
          <button
            type="button"
            className="admin-button"
            onClick={onSavePortalStatus}
            disabled={settingsLoading || saving}
          >
            {saving ? "Lagrer..." : "Lagre status"}
          </button>
          {statusMessage ? <p className="forms-success">{statusMessage}</p> : null}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="admin-panel">
          <h2>E-poster for varsling om /jobb</h2>
          {waitlistLoading ? <p>Laster e-poster...</p> : null}
          {waitlistError ? <p className="forms-error">{waitlistError}</p> : null}
          {!waitlistLoading && !waitlistError && waitlistEntries.length === 0 ? (
            <p>Ingen registrerte e-poster ennå.</p>
          ) : null}
          {!waitlistLoading && waitlistEntries.length > 0 ? (
            <div className="admin-email-list" role="list">
              {waitlistEntries.map((entry) => (
                <div key={entry.id} className="admin-email-item" role="listitem">
                  <p className="admin-email-contact">
                    <span className="admin-email-name">
                      {entry.name || "(mangler navn)"}
                    </span>
                    {entry.email || "(mangler e-post)"}
                  </p>
                  <div className="admin-email-actions">
                    <span>{formatDateTime(entry.createdAt)}</span>
                    <button
                      type="button"
                      className="admin-button admin-button-danger admin-delete-button"
                      onClick={() => onRequestDeleteWaitlistEntry(entry)}
                      disabled={deletingEntryId === entry.id}
                    >
                      {deletingEntryId === entry.id ? "Sletter..." : "Slett"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default Admin;
