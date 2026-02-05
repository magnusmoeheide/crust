import "./Frende.css";
import frendeLogo from "../assets/Frende-logo.png";

function Frende() {
  return (
    <div className="frende-page">
      <header className="frende-hero">
        <div>
          <a className="back-link" href="/partnere">
            ← Tilbake til Partnere
          </a>
          <p className="eyebrow">Taste The Service</p>
          <h1>Pizzaen din sier mer enn du tror.</h1>
          <p className="lead">En slice i hånden, en framtid i sikte.</p>
        </div>
        <div className="frende-card">
          <img src={frendeLogo} alt="Frende Forsikring logo" decoding="async" />
          <p>
            Frende vant prisen for Norges aller beste kundeservice i forsikring,
            og nå gir de "Smaken av Frende" videre til ungdommen i Crust.
          </p>
        </div>
      </header>

      <section className="frende-body">
        <p>
          I samarbeid med Frende har Crust åpnet åtte nye matvogner, som
          gir over 100 ungdom en arbeidsplass. Her får de kjenne på mestring,
          god erfaring, og blir opplært og sertifisert i kundeservice av
          Frende.
        </p>
        <p>
          Frende har bidratt økonomisk både i 2025 og i 2026 til å etablere og
          utvikle arbeidsplassene for ungdommen. Uten Frende hadde vi ikke fått
          til dette, og vi er kjempetakknemlige for at de er vår hovedpartner.
        </p>
        <p>Frende har 8,5 vogner i 2026.</p>
        <p>
          Sammen gir vi ungdommen en lysere framtid og verdifull erfaring i
          kundeservice.
        </p>
        <p>
          Smak på kundeservice fra Frende hos Crust! Les mer om Norges
          beste kundeservice og støtten fra Frende:{" "}
          <a href="https://www.frende.no/" target="_blank" rel="noreferrer">
            frende.no
          </a>
          .
        </p>
        <p>
          Grunnen til at Frende gjør dette er fordi de ser at flere unge faller
          utenfor. Samtidig som det er en stadig økning i unge uføre i
          samfunnet. Dette merker Frende, som oftere og oftere hjelper unge med
          økonomisk støtte fra uføredekningen i barne- og
          ungdomsforsikringen. Sammen med oss i Crust tar Frende tak i
          og adresserer et reelt samfunnsproblem, og er med på å snu trenden med
          ungt utenforskap.
        </p>
        <blockquote>
          Når vi bidrar til å snu trenden, er dette skadeforebyggende arbeid for
          oss. Dette er god økonomi for oss, og treffer både oss og
          forsikringskundene rett i lommeboka.
        </blockquote>
        <blockquote>
          Det er rørende å se hvordan de unge vokser med mulighetene for
          mestring, og erfaringen de får gir en fot innenfor arbeidslivet. For
          noen er det også en fin mulighet til å praktisere språk og kultur, og
          knytte nettverk. Vi gleder oss til å se Frendevognene i Oslo, Bergen
          og Ålesund!
        </blockquote>
      </section>
    </div>
  );
}

export default Frende;
