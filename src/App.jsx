import { Route, Routes } from "react-router-dom";
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
import alesundImage from "./assets/Ålesund.jpg";
import pizzaImage from "./assets/pizza.jpeg";
import pizzaTwoImage from "./assets/pizza2.jpeg";
import prosessImage from "./assets/Prosess.png";
import "./App.css";

function Home() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='900' height='700' viewBox='0 0 900 700'><rect width='900' height='700' fill='%23fff1e2'/><rect x='50' y='50' width='800' height='600' rx='32' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='6'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='30' fill='%231c140f'>Crust Pizza</text><text x='50%' y='56%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='18' fill='%235f4c3f'>Bilde kommer</text></svg>";

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Nabolagsdrevet pizza i hver eneste bit</p>
          <h1>
            Crust bygger selvsikre tenåringer med ekte jobb, ekte lønn og den
            beste pizzaen i byen.
          </h1>
          <p className="lead">
            Vi er pizzastedet der første jobber starter sterkt. I 2025 ga vi 100
            tenåringer sin aller første jobb, med solid opplæring og
            legendariske pizzaer.
          </p>
          <div className="hero-actions">
            <button className="cta">Bestill for henting</button>
            <a className="ghost" href="/event">
              Bestill pizza-servering
            </a>
          </div>
          <div className="hero-notes">
            <span>Tidligere Toastmasters</span>
            <span>Ansetter 15-19 år</span>
            <span>Etter-skoletid og helgevakter</span>
          </div>
        </div>
        <div className="hero-media">
          <img
            className="hero-main"
            src={placeholder}
            alt="Fersk pizza på en treplate"
          />
          <div className="hero-grid">
            <img src={pizzaTwoImage} alt="Pizza klar for servering" />
            <img src={pizzaImage} alt="Nystekt pizza" />
          </div>
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
            src={prosessImage}
            alt="Prosess for første jobb hos Crust"
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
              Betalt opplæring, tilbakemelding og en fantastisk mulighet for
              erfaring.
            </p>
          </div>
          <div>
            <h3>
              <span className="step-number">3</span> Karriereløft
            </h3>
            <p>CV-støtte, anbefalingsbrev og alumni-oppfølging.</p>
          </div>
        </div>
      </section>

      <section className="gallery">
        <div className="section-header">
          <h2>Inne hos Crust</h2>
          <p>Varme ovner, modige smaker og et team som lærer sammen.</p>
        </div>
        <div className="photo-grid">
          <img src={placeholder} alt="Ostestring fra pizzastykke" />
          <img src={placeholder} alt="Pizzeria med varm belysning" />
          <img src={placeholder} alt="Hender som strekker pizzadeig" />
          <img
            src={placeholder}
            alt="Kjøkkenteam som forbereder ingredienser"
          />
        </div>
      </section>

      <section id="historie" className="story">
        <div className="story-card">
          <div className="story-text">
            <h2>Fra Toastmasters til Crust</h2>
            <p>
              Vi startet som Toastmasters, en lokalt forankret toastvogn med
              store ambisjoner. Da ungdomsprogrammet vårt vokste, rebrandet vi
              til Crust med servering av pizza.
            </p>
          </div>
          <div className="story-image">
            <img src={alesundImage} alt="Utsikt over Ålesund" />
          </div>
        </div>
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
      </section>

      <section id="visit" className="visit">
        <div className="visit-card">
          <h2>Kom sulten, dra inspirert</h2>
          <p>
            Kom innom for den beste pizzaen, eller book Crust for et
            arrangement. <br />
            Hver bestilling støtter en ungdom i sin aller første jobb!
          </p>
          <div className="visit-actions">
            <a className="cta" href="/event">
              Bestill servering
            </a>
            <a className="ghost" href="/jobb">
              Søk jobb
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
        <Route path="/om-oss" element={<About />} />
      </Route>
    </Routes>
  );
}

export default App;
