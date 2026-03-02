import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faPersonWalking,
} from "@fortawesome/free-solid-svg-icons";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import {
  JOB_APPLICATIONS_DOC_ID,
  JOB_PORTAL_STATUS_CLOSED,
  JOB_PORTAL_STATUS_OPEN,
  JOB_PORTAL_STATUS_WAITLIST,
  JOB_PORTAL_WAITLIST_COLLECTION,
  SITE_SETTINGS_COLLECTION,
} from "../config/siteSettings";
import "./Apply.css";

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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidName(name) {
  return name.trim().length >= 2;
}

function Apply() {
  const [portalStatus, setPortalStatus] = useState(JOB_PORTAL_STATUS_OPEN);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState({ type: "", message: "" });
  const hasSubmittedWaitlist = emailStatus.type === "success";

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
      (snapshot) => {
        setPortalStatus(getPortalStatus(snapshot.data()));
        setSettingsLoading(false);
      },
      () => {
        setPortalStatus(JOB_PORTAL_STATUS_OPEN);
        setSettingsLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  async function onSubmitEmail(event) {
    event.preventDefault();
    const nextName = fullName.trim();
    const nextEmail = email.trim().toLowerCase();

    if (!isValidName(nextName)) {
      setEmailStatus({
        type: "error",
        message: "Skriv inn fullt navn.",
      });
      return;
    }

    if (!isValidEmail(nextEmail)) {
      setEmailStatus({
        type: "error",
        message: "Skriv inn en gyldig e-postadresse.",
      });
      return;
    }

    setSubmittingEmail(true);
    setEmailStatus({ type: "", message: "" });

    try {
      await addDoc(collection(db, JOB_PORTAL_WAITLIST_COLLECTION), {
        name: nextName,
        email: nextEmail,
        createdAt: serverTimestamp(),
        source: "/jobb",
      });
      setFullName("");
      setEmail("");
      setEmailStatus({
        type: "success",
        message: "Takk! Vi sier ifra når søknadsportalen åpner.",
      });
    } catch {
      setEmailStatus({
        type: "error",
        message: "Kunne ikke registrere e-post nå. Prøv igjen.",
      });
    } finally {
      setSubmittingEmail(false);
    }
  }

  return (
    <div className="apply-page">
      <header className="apply-hero">
        <div>
          <p className="eyebrow">En inngang til arbeidslivet</p>
          <h1>Søk jobb hos Crust</h1>
          <p className="lead">Vi gir muligheter til ungdom som kan og vil!</p>
        </div>
        <div className="apply-card">
          <h2>
            <FontAwesomeIcon icon={faPersonWalking} /> Er dette deg?
          </h2>

          <span>Du er mellom 15 og 19 år</span>

          <span className="apply-and">og</span>

          <span>1. Du går ikke på skole</span>

          <span className="apply-or">ELLER</span>

          <span>2. Du har et behov for å tjene egne penger</span>
        </div>
      </header>

      <section className="apply-form">
        <h2>Søknad</h2>
        <div className="apply-link">
          {settingsLoading ? (
            <div className="loading-box">Laster...</div>
          ) : portalStatus === JOB_PORTAL_STATUS_OPEN ? (
            <>
              <p>Søknadsskjemaet åpnes i ny fane.</p>
              <a
                className="cta"
                href="https://forms.gle/muPc5sozR2inq74MA"
                target="_blank"
                rel="noreferrer"
              >
                Klikk for å søke{" "}
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
              </a>
            </>
          ) : portalStatus === JOB_PORTAL_STATUS_WAITLIST ? (
            <>
              <p>
                Søknadsportalen er ikke åpen enda. Registrer e-posten din, så
                sier vi ifra når den åpner.
              </p>
              {!hasSubmittedWaitlist ? (
                <form onSubmit={onSubmitEmail} className="apply-waitlist-form">
                  <label htmlFor="waitlist-name">Navn</label>
                  <input
                    id="waitlist-name"
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Fornavn Etternavn"
                    autoComplete="name"
                    required
                  />
                  <label htmlFor="waitlist-email">E-postadresse</label>
                  <input
                    id="waitlist-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="navn@epost.no"
                    autoComplete="email"
                    required
                  />
                  <button
                    type="submit"
                    className="cta"
                    disabled={submittingEmail}
                  >
                    {submittingEmail ? "Lagrer..." : "Registrer e-post"}
                  </button>
                </form>
              ) : null}
              {emailStatus.message ? (
                <p className={`form-status ${emailStatus.type}`}>
                  {emailStatus.message}
                </p>
              ) : null}
            </>
          ) : (
            <p className="apply-closed-message">
              Søknadsportalen vår er ikke åpen nå. Kom tilbake senere.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export default Apply;
