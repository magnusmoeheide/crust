import { useEffect } from 'react'
import './Event.css'

function Event() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    const reset = window.setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
    }, 100)
    return () => window.clearTimeout(reset)
  }, [])

  return (
    <div className="event-page">
      <header className="event-hero">
        <div>
          <p className="eyebrow">Crust n Trust på ditt arrangement</p>
          <h1>Bestill Crust pizzaservering</h1>
          <p className="lead">
            La ungdommene våre stå for serveringen. Vi leverer varme pizzaer,
            profesjonell service og en opplevelse som støtter første jobber.
          </p>
        </div>
        <div className="event-card">
          <h2>Passer for</h2>
          <ul>
            <li>Skoler og elevråd</li>
            <li>Bedrifter og kickoff</li>
            <li>Nabolagseventer</li>
          </ul>
        </div>
      </header>

      <section className="event-form">
        <h2>Bestilling</h2>
        <div className="form-embed">
          <iframe
            title="Bestillingsskjema"
            src="https://forms.office.com/e/DGZ8yHF423"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </section>
    </div>
  )
}

export default Event
