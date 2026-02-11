import { Route, Routes, Link, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPizzaSlice,
  faUserGraduate,
  faHandshake,
  faTruckFast,
} from "@fortawesome/free-solid-svg-icons";
import { faCalendar as faCalendarRegular } from "@fortawesome/free-regular-svg-icons";
import Layout from "./components/Layout";
import Apply from "./pages/Apply";
import Locations from "./pages/Locations";
import Partners from "./pages/Partners";
import About from "./pages/About";
import Event from "./pages/Event";
import Frende from "./pages/Frende";
import Contact from "./pages/Contact";
import Forms from "./pages/Forms";
import FormPage from "./pages/FormPage";
import VarigHadeland from "./pages/VarigHadeland";
import Obos from "./pages/Obos";
import Admin from "./pages/Admin";
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
        <div className="hero-header">
          <p className="eyebrow">Kvalitet og mening i hver bit</p>
          <h1>
            Ungdom på jobb <br />
            med byens beste Pizza!
          </h1>
        </div>
        <div className="hero-content">
          <div className="hero-copy">
            <p className="lead">
              <strong>Vogna som gir jobb til ungdom som står utenfor.</strong>
              <br /> I 2025 ga vi, under navnet Toastmasters, 100 ungdommer sin
              aller første jobb og en fot innenfor arbeidslivet. <br />
            </p>
            <p className="lead">
              Nå er vi Crust n' Trust, hvor vi skal gi 100 nye ungdommer dobbelt
              så mye erfaring, mestring og muligheter, samtidig som vi serverer
              skikkelig god pizza.
            </p>
            <div className="hero-actions">
              <Link className="cta" to="/plasseringer">
                Hent pizza nå! <FontAwesomeIcon icon={faPizzaSlice} />
              </Link>
              <a className="ghost" href="/event">
                Bestill til et arrangement{" "}
                <FontAwesomeIcon icon={faCalendarRegular} />
              </a>
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
          <div className="hero-notes">
            <span>
              <i class="fa-solid fa-angles-right"></i> Tidligere Toastmasters
            </span>
            <span>
              <i class="fa-solid fa-child-reaching"></i> Ansetter 15 til 19 år
            </span>
            <span>
              <i class="fa-solid fa-school"></i> Jobb både i og utenfor skoletid
            </span>
          </div>
        </div>
      </section>

      <section id="resultater" className="impact">
        <div className="section-header impact-header-box">
          <h2>
            Resultater du kan smake <i class="fa-regular fa-circle-check"></i>
          </h2>
          <p>
            Crust kombinerer god opplæring, veiledning, tarifflønn og fleksible
            vakter, slik at ungdom får en arena for mestring og erfaring, bygger
            selvtillit, og får efaring som åpner dører videre i arbeidslivet.
          </p>
        </div>
        <div className="impact-grid">
          <article>
            <h3>
              <FontAwesomeIcon icon={faUserGraduate} /> 100 første jobber
            </h3>
            <p>
              Vi ansetter 100 nye ungdommer i 2026 og gir dem sin aller første
              lønn.
            </p>
          </article>
          <article>
            <h3>
              <FontAwesomeIcon icon={faHandshake} /> Grundig opplæring
            </h3>
            <p>
              Opplæring og kurs i kundeservice, matsikkerhet, renhold og ledelse
              – rett ut i praksis.
            </p>
          </article>
          <article>
            <h3>
              <FontAwesomeIcon icon={faTruckFast} /> Selvstendighet
            </h3>
            <p>
              Hver ungdom får ansvar for egen vogn, fra åpning til stenging,
              fordi vi vet at tillit bygger mestring.
            </p>
          </article>
        </div>
      </section>

      <section id="program" className="program">
        <div className="program-copy">
          <h2>
            Ditt steg inn i arbeidslivet{" "}
            <i class="fa-solid fa-building-circle-check"></i>
          </h2>
          <p>
            Hos oss utvikler ungdom sterke arbeidsvaner, fra punktlighet til god
            kundeservice. De får tillit og ansvar i praksis. <br />
            Her er det ungdommen som styrer vogna!
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
              Vi ser deg for den du er, ikke hva du har eller ikke har på CV-en.
            </p>
          </div>
          <div>
            <h3>
              <span className="step-number">2</span> Tjen og lær
            </h3>
            <p>
              Jobb med tarifflønn, veiledning og en fantastisk mulighet til å få
              erfaring.
            </p>
          </div>
          <div>
            <h3>
              <span className="step-number">3</span> Steget videre
            </h3>
            <p>
              Få hjelp med CV, anbefalingsbrev og oppfølging videre etterpå.
            </p>
          </div>
        </div>
      </section>

      <section id="historie" className="story">
        <div className="story-milestones">
          <div>
            <span>2024</span>
            <p>
              Åpnet vår første vogn på Sognsvann i Oslo, hvor vi fikk testet ut
              konseptet.
            </p>
          </div>
          <div>
            <span>2025</span>
            <p>
              Åpnet ytterligere 9 vogner. Nådde målet om 100 ungdommer i jobb på
              ett år.
            </p>
          </div>
          <div>
            <span>Nå - 2026</span>
            <p>
              Vi dobler sesongvarigheten og antallet arbeidstimer for ungdommen.
              Vi går fra toast til pizza for å styrke bunnlinjen og bygge en mer
              bærekraftig bedrift.
            </p>
          </div>
        </div>
        <div className="story-card">
          <h2 className="story-heading">
            Fra Toastmasters til{" "}
            <span className="no-break">Crust n' Trust</span>
          </h2>
          <div className="story-text">
            <p>
              Vi startet som Toastmasters, en lokalt forankret toastvogn med
              store ambisjoner. Så fikk vi Frende Forsikring med på laget, som
              så verdien i å gi muligheter til ungdom. <br />
              <br />I år bytter vi navn til Crust, med pizza på menyen og enda
              flere muligheter og arbeidstimer for ungdom.
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
          <h2>Sulten, nysgjerrig, eller kanskje begge?</h2>
          <p>
            Kom innom for den beste pizzaen, eller book oss for et arrangement.{" "}
            <br />
            Hver slice støtter en ungdom i sin aller første jobb!
          </p>
          <div className="visit-actions">
            <a className="cta" href="/event">
              Bestill servering <i class="fa-solid fa-pizza-slice"></i>
            </a>

            <a className="ghost" href="/plasseringer">
              Hvor finner du oss <i class="fa-solid fa-map-pin"></i>
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
        <Route path="/varig-hadeland" element={<VarigHadeland />} />
        <Route path="/obos" element={<Obos />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/skjema" element={<Forms />} />
        <Route path="/skjema/:formSlug" element={<FormPage />} />
        <Route path="/skjema/:formSlug/submissions" element={<FormPage />} />
        <Route path="/skjema/:formSlug/edit" element={<FormPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
