# Planday setup

Denne repoen har nå et første oppsett for Planday OAuth og daglig lønnskost i `/sales`.

## Hva som er inkludert

- `createPlandayAuthSession`: starter OAuth-flyt mot Planday.
- `plandayAuthCallback`: mottar callback og lagrer tokens serverside.
- `disconnectPlanday`: kobler fra Planday og revoker refresh token.
- `getPlandayLaborReport`: henter lønnskost fra Planday Payroll API.
- Admin-oppsett for department IDs i `/admin`.
- Lønnskost per dag i `/sales`, sammen med Zettle-salg.

## Firebase secrets

Sett disse før deploy:

```bash
firebase functions:secrets:set PLANDAY_CLIENT_ID
firebase functions:secrets:set PLANDAY_APP_URL
firebase functions:secrets:set PLANDAY_REDIRECT_URI
firebase functions:secrets:set PLANDAY_SCOPES
```

Anbefalte verdier:

- `PLANDAY_APP_URL`: appens origin, for eksempel `https://crust.no`
- `PLANDAY_REDIRECT_URI`: callback-URL for funksjonen, for eksempel `https://europe-west1-crust-11575.cloudfunctions.net/plandayAuthCallback`
- `PLANDAY_SCOPES`: space-separert scopes-streng fra Planday som matcher tillatelsene du faktisk har valgt i appen. `openid offline_access` legges til automatisk hvis de mangler. Ikke lim inn access token her.

## Planday app settings

I Planday API Access:

- bruk samme redirect URI som i `PLANDAY_REDIRECT_URI`
- velg tillatelsene som dekker Payroll API i appen, og bruk de samme scope-navnene i `PLANDAY_SCOPES`

## Department IDs

Planday Payroll API kan hente lønnsdata for én eller flere avdelinger i en valgt periode. Derfor lagres department IDs i `/admin`, og disse brukes når `/sales` henter lønnskost.

## Kilder

- https://developer.planday.com/gettingstarted/authorization-flow/
- https://developer.planday.com/guides/timeandcost-guide/
