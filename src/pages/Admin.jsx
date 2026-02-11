import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useAdminSession } from "../hooks/useAdminSession";
import {
  JOB_APPLICATIONS_DOC_ID,
  SITE_SETTINGS_COLLECTION,
} from "../config/siteSettings";
import "./Admin.css";

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

function Admin() {
  const { user, isAdmin, loading, error, signIn, signOutAdmin } =
    useAdminSession();
  const [acceptingApplications, setAcceptingApplications] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    async function loadSettings() {
      setSettingsLoading(true);
      setSettingsError("");
      try {
        const snapshot = await getDoc(
          doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
        );
        const nextValue = snapshot.data()?.acceptingApplications;
        setAcceptingApplications(
          typeof nextValue === "boolean" ? nextValue : true,
        );
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

  async function onToggleApplications() {
    const nextValue = !acceptingApplications;
    setSaving(true);
    setSettingsError("");
    setStatusMessage("");

    try {
      await setDoc(
        doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
        {
          acceptingApplications: nextValue,
          updatedAt: serverTimestamp(),
          updatedBy: user?.email || "admin",
        },
        { merge: true },
      );
      setAcceptingApplications(nextValue);
      setStatusMessage(
        nextValue
          ? "Søknader er nå åpne på /jobb."
          : "Søknader er nå stengt på /jobb.",
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
      {!loading && !isAdmin && error ? <p className="forms-error">{error}</p> : null}

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
          {settingsError ? (
            <p className="forms-error">{settingsError}</p>
          ) : null}
          <p>
            Status:{" "}
            <strong>
              {acceptingApplications
                ? "Tar imot søknader"
                : "Tar ikke imot søknader"}
            </strong>
          </p>
          <button
            type="button"
            className={acceptingApplications ? "ghost danger-button" : "cta"}
            onClick={onToggleApplications}
            disabled={settingsLoading || saving}
          >
            {saving
              ? "Lagrer..."
              : acceptingApplications
                ? "Steng søknader"
                : "Åpne søknader"}
          </button>
          {statusMessage ? (
            <p className="forms-success">{statusMessage}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default Admin;
