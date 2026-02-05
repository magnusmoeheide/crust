import { Link } from "react-router-dom";
import frendeLogo from "../assets/Frende-logo.png";
import navLogo from "../assets/nav-logo.png";
import varigLogo from "../assets/varig-hadeland.webp";
import obosLogo from "../assets/obos-logo.png";
import "./Partners.css";

function Partners() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='220' viewBox='0 0 360 220'><rect width='360' height='220' fill='%23fff1e2'/><rect x='18' y='18' width='324' height='184' rx='18' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='4'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='18' fill='%231c140f'>Partnerlogo</text></svg>";

  const partners = [
    {
      name: "Frende Forsikring",
      focus:
        "Hovedpartner. Økonomisk bidrag i 2025 og 2026 for å etablere og utvikle arbeidsplasser for ungdom.",
      logo: frendeLogo,
    },
    {
      name: "Varig Hadeland Forsikring",
      focus:
        "Med for første gang i 2026 og deler en vogn med Frende i Gjøvik.",
      logo: varigLogo,
    },
    {
      name: "OBOS",
      focus:
        "Har 1 vogn som gir arbeidsplass til 10 ungdom hvert år. Med oss siden 2024.",
      logo: obosLogo,
    },
    {
      name: "NAV",
      focus: "Stipender til kokketrening og mentoring.",
      logo: navLogo,
    },
    {
      name: "Nabolagets næringsallianse",
      focus: "Lokale leverandører og fellesskapseventer.",
    },
    {
      name: "First Paycheck Initiative",
      focus: "Økonomiopplæring for tenåringer.",
    },
    {
      name: "Lokalt helsesenter",
      focus: "Helse- og sikkerhetsopplæring for unge ansatte.",
    },
  ];

  const linkMap = {
    "Frende Forsikring": "/frende",
    "Varig Hadeland Forsikring": "/varig-hadeland",
    OBOS: "/obos",
  };

  return (
    <div className="partners-page">
      <header className="partners-hero">
        <div>
          <p className="eyebrow">Crust n' Trust - sammen</p>
          <h1>Våre samarbeidspartnere</h1>
          <p className="lead">
            Vi samarbeider med private bedrifter og det offentlige for å gi
            ungdom en mulighet til sin første jobb, et reelt støttenettverk, og
            en vei videre.
          </p>
        </div>
        <div className="partners-card">
          <h2>Sammen med våre partnere gir vi:</h2>
          <ul>
            <li>Arbeidslivstrening + mentoring</li>
            <li>Stipender + videre utdanning</li>
            <li>Nabolagseventer + catering</li>
          </ul>
        </div>
      </header>

      <section className="partners-grid">
        {partners.map((partner, index) => {
          const isFeatured = index === 0;
          return (
            <article
              key={partner.name}
              className={
                isFeatured ? "partner-card partner-featured" : "partner-card"
              }
            >
              <img
                className={
                  partner.name === "OBOS"
                    ? "partner-logo obos-logo"
                    : partner.name === "Varig Hadeland Forsikring"
                      ? "partner-logo varig-logo"
                      : partner.name === "NAV"
                        ? "partner-logo nav-logo"
                        : "partner-logo"
                }
                src={partner.logo ?? placeholder}
                alt={`${partner.name} logo`}
                loading="lazy"
                decoding="async"
              />
              <p>{partner.focus}</p>
              {linkMap[partner.name] && (
                <Link className="ghost" to={linkMap[partner.name]}>
                  Les mer
                </Link>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

export default Partners;
