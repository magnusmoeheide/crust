import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPizzaSlice } from "@fortawesome/free-solid-svg-icons";
import "./Event.css";

function Event() {
  useEffect(() => {
    let userInteracted = false;
    const forceTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    };
    const markInteracted = () => {
      userInteracted = true;
    };
    const keepTopIfNeeded = () => {
      if (!userInteracted && window.scrollY > 120) {
        forceTop();
      }
    };

    forceTop();
    const resetSoon = window.setTimeout(forceTop, 100);
    const resetLater = window.setTimeout(forceTop, 450);
    const unlock = window.setTimeout(() => {
      userInteracted = true;
    }, 2500);

    window.addEventListener("scroll", keepTopIfNeeded, { passive: true });
    window.addEventListener("wheel", markInteracted, { passive: true });
    window.addEventListener("touchstart", markInteracted, { passive: true });
    window.addEventListener("keydown", markInteracted);

    return () => {
      window.clearTimeout(resetSoon);
      window.clearTimeout(resetLater);
      window.clearTimeout(unlock);
      window.removeEventListener("scroll", keepTopIfNeeded);
      window.removeEventListener("wheel", markInteracted);
      window.removeEventListener("touchstart", markInteracted);
      window.removeEventListener("keydown", markInteracted);
    };
  }, []);

  return (
    <div className="event-page">
      <header className="event-hero">
        <div>
          <p className="eyebrow">Crust n' Trust på ditt arrangement</p>
          <h1>Bestill Crust pizzaservering</h1>
          <p className="lead">
            La ungdommene våre stå for serveringen. Vi leverer varme pizzaer,
            profesjonell service og en opplevelse som støtter ungdom i jobb.
          </p>
        </div>
        <div className="event-card">
          <h2>
            <FontAwesomeIcon icon={faPizzaSlice} /> Passer for ...
          </h2>
          <ul>
            <li>Lunsj, firmafest eller arrangement for din bedrift</li>
            <li>Bursdag eller andre sammenkomster</li>
            <li>Skoleklasser, lag og foreninger</li>
          </ul>
        </div>
      </header>

      <section className="event-form">
        <div className="form-embed">
          <iframe
            title="Bestillingsskjema"
            src="https://forms.office.com/e/DGZ8yHF423"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </section>
    </div>
  );
}

export default Event;
