import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAddressBook,
  faCalendarCheck,
  faCircleInfo,
  faHandshake,
  faHouse,
  faLocationDot,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";
import crustLogo from "../assets/crust-logo-transparent.png";
import "../App.css";

const LOGO_CACHE_KEY = "crust-brand-logo-v1";

function Layout() {
  const location = useLocation();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [logoSrc, setLogoSrc] = useState(() => {
    if (typeof window === "undefined") {
      return crustLogo;
    }
    try {
      return localStorage.getItem(LOGO_CACHE_KEY) || crustLogo;
    } catch {
      return crustLogo;
    }
  });

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    if (logoSrc !== crustLogo) {
      return;
    }

    let cancelled = false;
    const reader = new FileReader();

    fetch(crustLogo)
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      )
      .then((result) => {
        if (cancelled || typeof result !== "string") {
          return;
        }
        setLogoSrc(result);
        try {
          localStorage.setItem(LOGO_CACHE_KEY, result);
        } catch {
          // Ignore storage failures (private mode/quota).
        }
      })
      .catch(() => {
        // Fallback to static asset URL.
      });

    return () => {
      cancelled = true;
      reader.abort();
    };
  }, [logoSrc]);

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
            <img className="brand-logo" src={logoSrc} alt="Crust logo" />
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
            <Link to="/">
              <FontAwesomeIcon className="nav-icon" icon={faHouse} />
              <span className="nav-label">Hjem</span>
            </Link>
            <Link to="/om-oss">
              <FontAwesomeIcon className="nav-icon" icon={faCircleInfo} />
              <span className="nav-label">Om oss</span>
            </Link>
            <Link to="/plasseringer">
              <FontAwesomeIcon className="nav-icon" icon={faLocationDot} />
              <span className="nav-label">Plasseringer</span>
            </Link>
            <Link to="/partnere">
              <FontAwesomeIcon className="nav-icon" icon={faHandshake} />
              <span className="nav-label">Partnere</span>
            </Link>
            <Link to="/event">
              <FontAwesomeIcon className="nav-icon" icon={faCalendarCheck} />
              <span className="nav-label">Event</span>
            </Link>
            <Link to="/kontakt">
              <FontAwesomeIcon className="nav-icon" icon={faAddressBook} />
              <span className="nav-label">Kontakt</span>
            </Link>
            <Link to="/jobb">
              <FontAwesomeIcon className="nav-icon" icon={faUserPlus} />
              <span className="nav-label">Søk jobb</span>
            </Link>
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
