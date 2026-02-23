import "./Frende.css";
import obosLogo from "../assets/obos-logo.png";

function Obos() {
  return (
    <div className="frende-page">
      <header className="frende-hero">
        <div>
          <a className="back-link" href="/partnere">
            ← Tilbake til Partnere
          </a>
          <p className="eyebrow">Byutvikling med plass til flere</p>
          <h1>OBOS bidrar til første jobb for ungdom.</h1>
          <p className="lead">Fast partner siden 2025.</p>
        </div>
        <div className="frende-card">
          <img src={obosLogo} alt="OBOS logo" decoding="async" />
          <p>
            OBOS har hatt én vogn siden 2025, som hvert år gir arbeidsplass til
            rundt 10 ungdommer.
          </p>
        </div>
      </header>

      <section className="frende-body">
        <p>
          Med OBOS på laget får flere unge en konkret vei inn i arbeidslivet,
          med ansvar i hverdagen og tett oppfølging underveis.
        </p>
        <p>
          Partnerskapet handler om mer enn drift av en vogn. Det handler om å
          bygge muligheter i nærmiljøene og gi ungdom erfaring de kan ta med seg
          videre.
        </p>
        <p>
          Når ungdom får sin første jobb gjennom Crust, skaper det både mestring
          her og nå og bedre forutsetninger for fremtiden.
        </p>
        <p>
          Les mer om OBOS her:{" "}
          <a href="https://www.obos.no" target="_blank" rel="noreferrer">
            obos.no
          </a>
          .
        </p>
      </section>
    </div>
  );
}

export default Obos;
