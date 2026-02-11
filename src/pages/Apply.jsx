import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import {
  JOB_APPLICATIONS_DOC_ID,
  SITE_SETTINGS_COLLECTION,
} from "../config/siteSettings";
import "./Apply.css";

function Apply() {
  const [acceptingApplications, setAcceptingApplications] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, SITE_SETTINGS_COLLECTION, JOB_APPLICATIONS_DOC_ID),
      (snapshot) => {
        const nextValue = snapshot.data()?.acceptingApplications;
        setAcceptingApplications(
          typeof nextValue === "boolean" ? nextValue : true,
        );
      },
      () => {
        setAcceptingApplications(true);
      },
    );

    return unsubscribe;
  }, []);

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
            <i class="fa-solid fa-person-walking"></i> Er dette deg?
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
          {acceptingApplications ? (
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
          ) : (
            <p className="apply-closed-message">
              Vi tar dessverre ikke imot søknader nå. Kom tilbake senere.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

export default Apply;
