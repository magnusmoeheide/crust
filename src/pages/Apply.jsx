import "./Apply.css";

function Apply() {
  return (
    <div className="apply-page">
      <header className="apply-hero">
        <div>
          <p className="eyebrow">Første jobb, ekte støtte</p>
          <h1>Søk jobb hos Crust</h1>
          <p className="lead">
            Vi ansetter ungdom i deres aller første jobb og gir betalt
            opplæring, mentorer og fleksible vakter.
          </p>
        </div>
        <div className="apply-card">
          <h2>Er dette deg?</h2>
          <ul className="apply-list">
            <li>Du er mellom 15 og 19 år</li>
            <li>Du går ikke på skole</li>
          </ul>
          <span className="apply-or">ELLER</span>
          <ul className="apply-list">
            <li>Du har et behov for å tjene egne penger</li>
          </ul>
        </div>
      </header>

      <section className="apply-form">
        <h2>Søknad</h2>
        <div className="apply-link">
          <p>Søknadsskjemaet åpnes i ny fane.</p>
          <a
            className="cta"
            href="https://forms.gle/muPc5sozR2inq74MA"
            target="_blank"
            rel="noreferrer"
          >
            Klikk for å søke
          </a>
        </div>
      </section>
    </div>
  );
}

export default Apply;
