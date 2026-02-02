import './Partners.css'

function Partners() {
  const placeholder =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='360' height='220' viewBox='0 0 360 220'><rect width='360' height='220' fill='%23fff1e2'/><rect x='18' y='18' width='324' height='184' rx='18' fill='%23ffe1c8' stroke='%23e75c3e' stroke-width='4'/><text x='50%' y='50%' text-anchor='middle' dominant-baseline='middle' font-family='Arial, sans-serif' font-size='18' fill='%231c140f'>Partnerlogo</text></svg>"

  const partners = [
    {
      name: 'Byens ungdoms- og arbeidsråd',
      focus: 'Karriereveiledning og praksisplasser.',
    },
    {
      name: 'Haven City offentlige skoler',
      focus: 'Etter-skoletid og elevrekruttering.',
    },
    {
      name: 'Future Chefs Foundation',
      focus: 'Stipender til kokketrening og mentoring.',
    },
    {
      name: 'Nabolagets næringsallianse',
      focus: 'Lokale leverandører og fellesskapseventer.',
    },
    {
      name: 'First Paycheck Initiative',
      focus: 'Økonomiopplæring for tenåringer.',
    },
    {
      name: 'Lokalt helsesenter',
      focus: 'Helse- og sikkerhetsopplæring for unge ansatte.',
    },
  ]

  return (
    <div className="partners-page">
      <header className="partners-hero">
        <div>
          <p className="eyebrow">Crust n Trust, forsterket</p>
          <h1>Partnere som vokser med oss</h1>
          <p className="lead">
            Vi samarbeider med skoler, organisasjoner og lokale bedrifter for å
            gi ungdom sin første jobb og et reelt støttenettverk.
          </p>
        </div>
        <div className="partners-card">
          <h2>Partnerhøydepunkter</h2>
          <ul>
            <li>Arbeidslivstrening + mentoring</li>
            <li>Stipender + videre utdanning</li>
            <li>Nabolagseventer + catering</li>
          </ul>
        </div>
      </header>

      <section className="partners-grid">
        {partners.map((partner) => (
          <article key={partner.name}>
            <img src={placeholder} alt={`${partner.name} logo`} />
            <h3>{partner.name}</h3>
            <p>{partner.focus}</p>
            <button className="ghost">Les mer</button>
          </article>
        ))}
      </section>
    </div>
  )
}

export default Partners
