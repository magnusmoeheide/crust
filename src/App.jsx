import { Route, Routes, Link } from "react-router-dom";
import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faUserGraduate,
  faHandshake,
  faTruckFast,
} from "@fortawesome/free-solid-svg-icons";
import Layout from "./components/Layout";
import Apply from "./pages/Apply";
import Locations from "./pages/Locations";
import Partners from "./pages/Partners";
import About from "./pages/About";
import Event from "./pages/Event";
import Frende from "./pages/Frende";
import Contact from "./pages/Contact";
import alesund600 from "./assets/optimized/alesund-600.jpg";
import alesund1200 from "./assets/optimized/alesund-1200.jpg";
import pizza2_480 from "./assets/optimized/pizza2-480.jpeg";
import pizza2_960 from "./assets/optimized/pizza2-960.jpeg";
import pizza2_1600 from "./assets/optimized/pizza2-1600.jpeg";
import prosess600 from "./assets/optimized/prosess-600.png";
import prosess1200 from "./assets/optimized/prosess-1200.png";
import "./App.css";

function Home() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='900' height='700' viewBox='0 0 900 700'><rect width='900' height='700' fill='%23fff1e2'/><rect x='50' y='50' width='800' height='600' rx='32' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='6'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='30' fill='%231c140f'>Crust Pizza</text><text x='50%' y='56%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='18' fill='%235f4c3f'>Bilde kommer</text></svg>";

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const timer = window.setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Kvalitet og mening i hver bit</p>
          <h1>
            Crust gir muligheter til ungdom - og den beste pizzaen i byen.
          </h1>
          <p className="lead">
            Vi er pizzastedet der første jobber starter sterkt. I 2025 ga vi
            under navnet Toastmasters 100 ungdom sin aller første jobb, og en
            mulighet til å ta steget videre. Nå er vi Crust n' Trust, hvor vi
            sikter på å gi nye 100 ungdom dobbelt så mye erfaring, mestring og
            muligheter, samtidig som vi serverer nydelig pizza.
          </p>
          <div className="hero-actions">
            <Link className="cta" to="/plasseringer">
              Bestill for levering nå!
            </Link>
            <a className="ghost" href="/event">
              Bestill for et event
            </a>
          </div>
          <div className="hero-notes">
            <span>Tidligere Toastmasters</span>
            <span>Ansetter 15-19 år</span>
            <span>Jobb både i skoletid og utenfor skoletid</span>
          </div>
        </div>
        <div className="hero-media">
          <img
            className="hero-main"
            src={pizza2_960}
            srcSet={`${pizza2_480} 480w, ${pizza2_960} 960w, ${pizza2_1600} 1600w`}
            sizes="(max-width: 700px) 92vw, (max-width: 1200px) 50vw, 700px"
            alt="Fersk pizza på en treplate"
            decoding="async"
            fetchPriority="high"
          />
        </div>
      </section>

      <section id="resultater" className="impact">
        <div className="section-header">
          <h2>Resultater du kan smake!</h2>
          <p>
            Crust kombinerer mentorordninger, tarifflønn og fleksible vakter,
            slik at ungdom kan bygge selvtillit og arbeidsferdigheter.
          </p>
        </div>
        <div className="impact-grid">
          <article>
            <h3>
              <FontAwesomeIcon icon={faUserGraduate} /> 100 første jobber
            </h3>
            <p>
              Vi ansetter 100 nye ungdom i 2026 og gir dem sin aller første
              lønn.
            </p>
          </article>
          <article>
            <h3>
              <FontAwesomeIcon icon={faHandshake} /> Grundig opplæring
            </h3>
            <p>
              Betalt opplæring i kundeservice, matsikkerhet og ledelse – rett ut
              i praksis.
            </p>
          </article>
          <article>
            <h3>
              <FontAwesomeIcon icon={faTruckFast} /> Selvstendighet
            </h3>
            <p>
              Hver ungdom får ansvar for egen vogn – fra åpning til stenging –
              fordi tillit bygger mestring.
            </p>
          </article>
        </div>
      </section>

      <section id="program" className="program">
        <div className="program-copy">
          <h2>Ditt steg inn i arbeidslivet</h2>
          <p>
            Hver vakt er strukturert for å lære profesjonelle vaner, fra
            punktlighet til kundeservice. Ungdommene roterer mellom roller for å
            lære hele rytmen i en restaurant.
          </p>
          <img
            className="program-image"
            src={prosess600}
            srcSet={`${prosess600} 600w, ${prosess1200} 1200w`}
            sizes="(max-width: 900px) 90vw, 520px"
            alt="Prosess for første jobb hos Crust"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="program-steps">
          <div>
            <h3>
              <span className="step-number">1</span> Intervju
            </h3>
            <p>
              Vi ser deg for den du er - ikke hva du har eller ikke har på CVen.
            </p>
          </div>
          <div>
            <h3>
              <span className="step-number">2</span> Tjen og lær
            </h3>
            <p>
              Jobb med tariff-lønn, veiledning, og en fantastisk mulighet for
              erfaring.
            </p>
          </div>
          <div>
            <h3>
              <span className="step-number">3</span> Steget videre
            </h3>
            <p>Få hjelp til CV-støtte, anbefalingsbrev og alumni-oppfølging.</p>
          </div>
        </div>
      </section>

      <section id="historie" className="story">
        <div className="story-milestones">
          <div>
            <span>2024</span>
            <p>
              Åpnet vår første vogn på Sognsvann, med opplæring først i fokus.
            </p>
          </div>
          <div>
            <span>2025</span>
            <p>
              Åpnet ytterligere 9 vogner. Nådde 100 jobber for tenåringer på ett
              år.
            </p>
          </div>
          <div>
            <span>Nå - 2026</span>
            <p>
              Dobler sesongvarigheten og antallet arbeidstimer for ungdommen.
              <br />
              Bytter fra Toast til Pizza for å styrke bunnlinje og en mer
              bærekraftig bedrift.
            </p>
          </div>
        </div>
        <div className="story-card">
          <div className="story-text">
            <h2>Fra Toastmasters til Crust n' Trust</h2>
            <p>
              Vi startet som Toastmasters, en lokalt forankret toastvogn med
              store ambisjoner. Da ungdomsprogrammet vårt vokste, rebrandet vi
              til Crust med servering av pizza.
            </p>
          </div>
          <div className="story-image">
            <img
              src={alesund600}
              srcSet={`${alesund600} 600w, ${alesund1200} 1200w`}
              sizes="(max-width: 900px) 90vw, 520px"
              alt="Utsikt over Ålesund"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>

      <section id="visit" className="visit">
        <div className="visit-card">
          <h2>Kom sulten, dra inspirert</h2>
          <p>
            Kom innom for den beste pizzaen, eller book Crust for et
            arrangement. <br />
            Hver slice støtter en ungdom i sin aller første jobb!
          </p>
          <div className="visit-actions">
            <a className="cta" href="/event">
              Bestill servering
            </a>

            <a className="ghost" href="/plasseringer">
              Hvor finner du oss
            </a>
          </div>
        </div>
      </section>
    </>
  );
}

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/jobb" element={<Apply />} />
        <Route path="/plasseringer" element={<Locations />} />
        <Route path="/partnere" element={<Partners />} />
        <Route path="/event" element={<Event />} />
        <Route path="/frende" element={<Frende />} />
        <Route path="/kontakt" element={<Contact />} />
        <Route path="/om-oss" element={<About />} />
      </Route>
    </Routes>
  );
}

export default App;
