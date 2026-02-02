import "./About.css";
import christianImage from "../assets/Christian.png";
import haakonImage from "../assets/Haakon.jpeg";
import magnusImage from "../assets/Magnus.jpeg";
import josteinImage from "../assets/Jostein.jpeg";
import historieImage from "../assets/Historie.jpeg";

function About() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='420' viewBox='0 0 360 420'><rect width='360' height='420' fill='%23fff1e2'/><rect x='18' y='18' width='324' height='384' rx='18' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='4'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='18' fill='%231c140f'>Crust team</text></svg>";

  const team = [
    {
      name: "Magnus Heide",
      role: "Gründer og Daglig leder",
      focus:
        "Leder driften, følger opp ungdommen og sikrer god kundeopplevelse.",
      image: magnusImage,
    },
    {
      name: "Haakon Aarseth",
      role: "Partneransvarlig",
      focus: "Utvikler samarbeid med bedrifter og relevante aktører.",
      image: haakonImage,
    },
    {
      name: "Christian Træland",
      role: "Gründer og Styremedlem",
      focus: "Setter strategi og støtter ledelsen.",
      image: christianImage,
    },
    {
      name: "Jostein",
      role: "Styreleder",
      focus: "Sikrer god styring, prioriteringer og langsiktig retning.",
      image: josteinImage,
    },
  ];

  return (
    <div className="about-page">
      <header className="about-hero">
        <div>
          <p className="eyebrow">Om oss</p>
          <h1>Crust bygger selvtillit gjennom første jobb</h1>
          <p className="lead">
            Vi er en pizzarestaurant og et ungdomsprogram i ett. Målet vårt er å
            gi unge arbeidserfaring, mestring og en trygg vei inn i
            arbeidslivet.
          </p>
        </div>
        <div className="about-card">
          <h2>Crust n Trust</h2>
          <p>
            Vi gir ungdom ansvar for egen butikk, samtidig som vi tilbyr tett
            oppfølging og opplæring. Resultatet er bedre ferdigheter, sterkere
            fellesskap og tryggere fremtidsvalg.
          </p>
        </div>
      </header>

      <section className="about-history">
        <div className="history-layout">
          <div>
            <div className="section-header">
              <h2>Vår historie</h2>
              <p>
                Flere og flere ungdom i Norge faller fra et tradisjonelt
                utdanningsløp. Crust er et nytt konsept som satser på ungdom og
                gir dem en vei inn i arbeidslivet - en mulighet til å utvikle
                seg, få arbeidserfaring og åpne dører til nye muligheter.
              </p>
            </div>
            <div className="history-body">
              <p>
                For å møte dette behovet og bidra til å forhindre utenforskap,
                startet vi Crust, tidligere Toastmasters.
              </p>
              <p>
                Vårt mål er å gi ungdommer en plattform hvor de kan oppleve
                mestring, tilegne seg arbeidslivsferdigheter og bygge
                selvtillit.
              </p>
              <p>
                Gjennom praktisk arbeid og ansvar i en trygg og støttende
                arbeidskultur, hjelper vi dem med å bygge en sterkere fremtid og
                bryte barrierer som kan lede til marginalisering.
              </p>
              <p>
                Vi satser på ungdommen ved å gi dem ansvar for egen butikk,
                samtidig som vi gir dem verdifull erfaring de kan ta med seg
                videre i livet. Gjennom praktisk arbeid og ansvar, utvikler de
                ferdigheter som selvstendighet, ledelse og problemløsning, og
                forbereder seg på fremtidige utfordringer både i arbeidslivet og
                i samfunnet.
              </p>
            </div>
          </div>
          <div className="history-media">
            <img src={historieImage} alt="Crust sin historie i bilder" />
          </div>
        </div>
      </section>

      <section className="about-team">
        <div className="section-header">
          <h2>Crust-teamet</h2>
          <p>
            Et lite team med stort ansvar for trygghet, læring og fellesskap.
          </p>
        </div>
        <div className="team-grid">
          {team.map((member) => (
            <article key={member.name}>
              <img
                src={member.image || placeholder}
                alt={`Portrett av ${member.name}`}
              />
              <div className="team-card">
                <h3>{member.name}</h3>
                <span>{member.role}</span>
                <p>{member.focus}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default About;
