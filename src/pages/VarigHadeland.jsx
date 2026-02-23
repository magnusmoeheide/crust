import "./Frende.css";
import varigLogo from "../assets/varig-hadeland.webp";

function VarigHadeland() {
  return (
    <div className="frende-page">
      <header className="frende-hero">
        <div>
          <a className="back-link" href="/partnere">
            ← Tilbake til Partnere
          </a>
          <p className="eyebrow">Lokal kraft i samarbeid</p>
          <h1>Varig Hadeland løfter ungdom i jobb.</h1>
          <p className="lead">Én vogn i Gjøvik. Flere muligheter for ungdom.</p>
        </div>
        <div className="frende-card">
          <img
            src={varigLogo}
            alt="Varig Hadeland Forsikring logo"
            decoding="async"
          />
          <p>
            Varig Hadeland Forsikring er med Crust for første gang i 2026, og
            deler én vogn med Frende i Gjøvik.
          </p>
        </div>
      </header>

      <section className="frende-body">
        <p>
          Samarbeidet med Varig Hadeland gjør at flere ungdom får en trygg
          inngang til arbeidslivet med reelt ansvar, oppfølging og mestring i
          praksis.
        </p>
        <p>
          Gjennom partnerskapet bidrar Varig Hadeland til at ungdom får
          arbeidserfaring, bygger selvtillit og står sterkere videre i utdanning
          og jobb.
        </p>
        <p>
          Sammen med Crust er målet tydelig: skape lokale muligheter som gir
          varig effekt for ungdom i regionen.
        </p>
        <p>
          Les mer om Varig Hadeland her:{" "}
          <a href="https://varighadeland.no/" target="_blank" rel="noreferrer">
            varighadeland.no
          </a>
          .
        </p>
      </section>
    </div>
  );
}

export default VarigHadeland;
