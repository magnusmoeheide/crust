import "./Locations.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationDot } from "@fortawesome/free-solid-svg-icons";
import foodtruckImage from "../assets/Foodtruck.png";

function Locations() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'><rect width='600' height='600' fill='%23fff1e2'/><rect x='40' y='40' width='520' height='520' rx='28' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='6'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='28' fill='%231c140f'>Crust Foodtruck</text><text x='50%' y='56%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='16' fill='%235f4c3f'>Bilde kommer</text></svg>";

  const trucks = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    name: `Crust Foodtruck ${index + 1}`,
    neighborhood: [
      "Sentrum",
      "Elvebyen",
      "Nordpark",
      "Østmarkedet",
      "Sydhøyden",
      "Sjøsiden",
      "Kunstkvartalet",
      "Gamlebyen",
      "Havnepunktet",
      "Katten",
    ][index],
    hours: {
      weekday: "Man-Fre: 11:00-21:00",
      weekend: "Lør-Søn: 12:00-20:00",
    },
    photo: foodtruckImage,
  }));

  return (
    <div className="locations-page">
      <header className="locations-hero">
        <div>
          <p className="eyebrow">Ni foodtrucks, ett oppdrag</p>
          <h1>Finn en Crust Foodtruck</h1>
          <p className="lead">
            Våre 10 foodtrucks bringer Crust n Trust til nabolag over hele byen.
            Hvert stopp støtter ungdommens første jobb og opplæring.
          </p>
        </div>
        <div className="locations-card">
          <h2>2026</h2>
          <ul>
            <li>10 aktive vogner</li>
            <li>Daglig servering 11:00-21:00</li>
            <li>Skolearrangementer + catering</li>
          </ul>
        </div>
      </header>

      <section className="locations-grid">
        {trucks.map((truck) => (
          <article key={truck.id}>
            <img src={truck.photo} alt={`${truck.name} fasade`} />
            <h3>{truck.name}</h3>
            <p className="location-neighborhood">
              <FontAwesomeIcon icon={faLocationDot} /> {truck.neighborhood}
            </p>
            <p>{truck.hours.weekday}</p>
            <p>{truck.hours.weekend}</p>
            <a
              className="ghost location-cta"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${truck.name} ${truck.neighborhood}`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Ta meg dit
            </a>
          </article>
        ))}
      </section>
    </div>
  );
}

export default Locations;
