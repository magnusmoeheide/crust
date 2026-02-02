import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import "../App.css";

function Layout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  return (
    <div className="page">
      <div className="rename-banner">
        <span>Toastmasters har byttet navn til Crust</span>
      </div>
      <header className="site-header">
        <Link to="/" className="brand">
          <span className="brand-mark">Crust</span>
          <span className="brand-tag">Crust n Trust</span>
        </Link>
        <nav className="site-nav">
          <Link to="/">Hjem</Link>
          <Link to="/om-oss">Om oss</Link>
          <Link to="/plasseringer">Plasseringer</Link>
          <Link to="/partnere">Partnere</Link>
          <Link to="/event">Event</Link>
          <Link to="/jobb">Søk jobb</Link>
        </nav>
        <Link className="cta" to="/jobb">
          Søk nå
        </Link>
      </header>

      <main className="page-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div>
          <strong>Crust Pizza Co.</strong>
          <p>Første jobber, varig selvtillit.</p>
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
          <p>
            *Søknader på tlf, sms eller mail kan dessverre ikke besvares. <br />
            Benytt søknadsskjemaet på{" "}
            <a href="/jobb">
              <u>/jobb</u>
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}

export default Layout;
