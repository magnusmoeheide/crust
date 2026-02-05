import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import crustLogo from "../assets/crust-logo-transparent.png";
import "../App.css";

function Layout() {
  const location = useLocation();
  const [isNavOpen, setIsNavOpen] = useState(false);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  useEffect(() => {
    setIsNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const titleMap = {
      "/": "Hjem",
      "/om-oss": "Om oss",
      "/plasseringer": "Plasseringer",
      "/partnere": "Partnere",
      "/event": "Event",
      "/jobb": "Søk jobb",
      "/frende": "Frende",
      "/kontakt": "Kontakt",
    };
    const pageTitle = titleMap[location.pathname];
    document.title = pageTitle
      ? `Crust n' Trust | ${pageTitle}`
      : "Crust n' Trust";
  }, [location.pathname]);

  return (
    <div className="page">
      <div className="rename-banner">
        <span>Toastmasters har byttet navn til Crust n' Trust</span>
      </div>
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="brand">
            <img className="brand-logo" src={crustLogo} alt="Crust logo" />
            <span className="brand-text">
              <span className="brand-mark">Crust</span>
              <span className="brand-tag">Crust n' Trust</span>
            </span>
          </Link>
          <button
            className="nav-toggle"
            type="button"
            aria-label="Åpne meny"
            aria-expanded={isNavOpen}
            onClick={() => setIsNavOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          <nav className={`site-nav ${isNavOpen ? "is-open" : ""}`}>
            <Link to="/">Hjem</Link>
            <Link to="/om-oss">Om oss</Link>
            <Link to="/plasseringer">Plasseringer</Link>
            <Link to="/partnere">Partnere</Link>
            <Link to="/event">Event</Link>
            <Link to="/kontakt">Kontakt</Link>
            <Link to="/jobb">Søk jobb</Link>
          </nav>
        </div>
      </header>

      <main className="page-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div>
            <strong>@2026 Crust n' Trust</strong>
            <p>Ungdom på jobb!</p>
          </div>
          <div>
            <strong>Adresse</strong>
            <p>Sandakerveien 121</p>
            <p>0484 Oslo</p>
          </div>
          <div>
            <strong>Kontakt</strong>
            <p>
              <a mailto="hei@crust.no" href="mailto:hei@crust.no">
                hei@crust.no
              </a>
            </p>
            <p>+47 958 85 852</p>
            <br />
            <p className="footer-note">
              *Søknader på tlf, sms eller mail kan dessverre ikke besvares.{" "}
              <br />
              Benytt søknadsskjemaet på{" "}
              <a href="/jobb">
                <u>/jobb</u>
              </a>
              .
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
