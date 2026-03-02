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
import { db } from "../firebase";
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
                <Link className="cta" to="/skjema">
                  Gå til /skjema
                </Link>
                <button type="button" className="ghost" onClick={signOutAdmin}>
                  Logg ut
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}

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
            className="cta"
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
                      className="ghost admin-delete-button"
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
