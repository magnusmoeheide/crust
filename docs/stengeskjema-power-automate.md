# Stengeskjema til Microsoft Power Automate

Denne løsningen er satt opp slik:

1. Brukeren sender inn `stengeskjema`.
2. Innsendingen lagres i Firestore `formSubmissions`.
3. Firebase Cloud Function `notifyPowerAutomateOnStengeskjemaSubmission` trigges på nye dokumenter.
4. Funksjonen poster en enkel payload til en Power Automate-webhook.
5. Power Automate sender e-post til både brukeren og en Crust-adresse.

## 1. Lag flow i Power Automate

Bruk en cloud flow med triggeren `When an HTTP request is received`.

Anbefalt oppsett:

- Trigger: `When an HTTP request is received`
- Action: `Send an email (V2)` under `Office 365 Outlook`

I `Send an email (V2)`:

- `To`: `submitterEmail`
- `Cc`: `crustCopyEmail`
- `Subject`: `subject`
- `Body`: `htmlBody`
- Slå på HTML-format hvis designer viser dette som eget valg

E-posten inneholder bare en standard melding om at skjemaet er sendt inn, samt en lenke til en egen kvitteringsside for akkurat den innsendingen.

## 2. JSON-schema i triggeren

Bruk dette schemaet i `When an HTTP request is received`:

```json
{
  "type": "object",
  "properties": {
    "eventType": { "type": "string" },
    "submissionId": { "type": "string" },
    "formSlug": { "type": "string" },
    "formTitle": { "type": "string" },
    "submittedAtIso": { "type": "string" },
    "submitterEmail": { "type": "string" },
    "crustCopyEmail": { "type": "string" },
    "receiptUrl": { "type": "string" },
    "subject": { "type": "string" },
    "htmlBody": { "type": "string" },
    "textBody": { "type": "string" }
  },
  "required": [
    "submissionId",
    "formSlug",
    "formTitle",
    "submittedAtIso",
    "submitterEmail",
    "crustCopyEmail",
    "receiptUrl",
    "subject",
    "htmlBody"
  ]
}
```

Når du lagrer triggeren, får du webhook-URL-en som skal legges inn som Firebase secret.

## 3. Sett secrets i Firebase

Sett webhook-URL, ønsket Crust-mottaker og base-url til appen:

```bash
firebase functions:secrets:set POWER_AUTOMATE_STENGESKJEMA_WEBHOOK_URL
firebase functions:secrets:set CRUST_STENGESKJEMA_COPY_EMAIL
firebase functions:secrets:set CRUST_PUBLIC_APP_URL
```

## 4. Installer og deploy functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

## 5. Viktig om e-postfeltet

Flowen bruker spørsmålsfeltet med typen `E-post` som mottakeradresse for brukeren. Hvis skjemaet mangler et slikt felt, sendes ikke automatisk kopi til bruker.

## 6. Viktig om lenken

Lenken i e-posten peker til en egen kvitteringsside for akkurat den innsendingen, for eksempel `/skjema/stengeskjema/kvittering/[token]`.
