import "./Locations.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLocationDot, faTruck } from "@fortawesome/free-solid-svg-icons";
import foodtruck600 from "../assets/optimized/foodtruck-600.png";
import foodtruck1200 from "../assets/optimized/foodtruck-1200.png";

function Locations() {
  const trucks = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    name: `Crust Foodtruck ${index + 1}`,
    neighborhood: [
      "Oslo",
      "Oslo",
      "Oslo",
      "Oslo",
      "Oslo",
      "Oslo",
      "Oslo",
      "Oslo",
      "Bergen",
      "Gjøvik",
    ][index],
    hours: {
      weekday: "Man-Fre: 11:00-21:00",
      weekend: "Lør-Søn: 12:00-20:00",
    },
    photo: {
      src: foodtruck600,
      srcSet: `${foodtruck600} 600w, ${foodtruck1200} 1200w`,
    },
  }));

  return (
    <div className="locations-page">
      <header className="locations-hero">
        <div>
          <p className="eyebrow">Ti vogner - ett mål!</p>
          <h1>Finn en pizzavogn!</h1>
          <p className="lead">
            Våre 10 foodtrucks bringer Crust n' Trust til nabolag over hele Oslo
            - og litt utenfor! Ta turen innom for en smak av vår crusty pizza.
          </p>
        </div>
        <div className="locations-card">
          <h2>
            <FontAwesomeIcon icon={faTruck} /> 2026
          </h2>
          <ul>
            <li>10 aktive vogner</li>
            <li>Daglig servering</li>
            <li>Åpner fra 7. april og utover måneden!</li>
          </ul>
        </div>
      </header>

      <section className="locations-grid">
        {trucks.map((truck) => (
          <article key={truck.id}>
            <img
              src={truck.photo.src}
              srcSet={truck.photo.srcSet}
              sizes="(max-width: 700px) 90vw, 320px"
              alt={`${truck.name} fasade`}
              loading="lazy"
              decoding="async"
            />
            <h3>{truck.name}</h3>
            <p className="location-neighborhood">
              <FontAwesomeIcon icon={faLocationDot} /> {truck.neighborhood}
            </p>
            <p>{truck.hours.weekday}</p>
            <p>{truck.hours.weekend}</p>
            <a
              className="ghost location-cta is-disabled"
              href="#"
              aria-disabled="true"
              tabIndex={-1}
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
