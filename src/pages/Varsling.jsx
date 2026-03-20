import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpRightFromSquare,
  faCircleInfo,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";
import "./Varsling.css";

const VARSLING_FORM_URL = "https://forms.office.com/e/r1y7g3uyEP";

function Varsling() {
  return (
    <div className="varsling-page">
      <header className="varsling-hero">
        <div>
          <p className="eyebrow">For ansatte</p>
          <h1>Varsling</h1>
          <p className="lead">
            Her kan ansatte melde fra om kritikkverdige forhold gjennom et
            Microsoft Forms-skjema.
          </p>
   
        </div>

        <aside className="varsling-card">
          <h2>
            <FontAwesomeIcon icon={faShieldHalved} /> Anonym varsling
          </h2>
          <p>
            Du kan sende inn uten navn. Ikke skriv personopplysninger om deg
            selv dersom du vil forbli anonym.
          </p>
         
        </aside>
      </header>

      <section className="varsling-info">
        <article>
          <h3>
            <FontAwesomeIcon icon={faCircleInfo} /> Viktig
          </h3>
          <p>
            Hvis skjemaet ber deg logge inn eller automatisk fyller inn navn og
            e-post, er ikke anonymiteten satt opp riktig i Microsoft Forms.
          </p>
        </article>
        <article>
         
          <ul>
            <li>Beskriv hva som har skjedd</li>
            <li>Ta med tid, sted og hvem som var involvert</li>
            <li>Forklar om saken haster eller krever oppfolging raskt</li>
          </ul>
        </article>
      </section>

      <section className="varsling-form-section">
        <div className="varsling-form-shell">
          <div className="varsling-form-actions">
            <a
              className="ghost"
              href={VARSLING_FORM_URL}
              target="_blank"
              rel="noreferrer"
            >
              Apne skjema i ny fane{" "}
              <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
            </a>
          </div>

          <div className="varsling-form-embed">
            <iframe
              title="Varslingsskjema"
              src={VARSLING_FORM_URL}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export default Varsling;
