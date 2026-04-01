# Zettle setup

This repo now contains a Firebase Functions scaffold for Zettle OAuth.

## What is included

- `createZettleAuthSession`: callable function that creates an OAuth state and returns the Zettle authorize URL.
- `zettleAuthCallback`: HTTP callback that exchanges the authorization code for Zettle tokens.
- `disconnectZettle`: callable function that removes the saved Zettle connection.
- `verifyZettleConnection`: callable function that verifies which Zettle user and organization the saved tokens belong to.
- `getZettleSalesReport`: callable function that fetches sales data from the Zettle Purchase API.
- Firestore status document in `integrations/zettle`.
- Private token storage in `zettlePrivate/default`.
- Admin sales page at `/sales`.

## Firebase secrets

Set these before deploying:

```bash
firebase functions:secrets:set ZETTLE_CLIENT_ID
firebase functions:secrets:set ZETTLE_CLIENT_SECRET
firebase functions:secrets:set ZETTLE_APP_URL
firebase functions:secrets:set ZETTLE_REDIRECT_URI
```

Suggested values:

- `ZETTLE_APP_URL`: your app origin, for example `https://crust.no`
- `ZETTLE_REDIRECT_URI`: your deployed callback URL, for example `https://europe-west1-crust-11575.cloudfunctions.net/zettleAuthCallback`

## Zettle app settings

In the Zettle Developer Portal, register:

- App URL: the same value as `ZETTLE_APP_URL`
- OAuth Redirect URI: the same value as `ZETTLE_REDIRECT_URI`

The OAuth base URL is hardcoded to `https://oauth.zettle.com`, matching Zettle's example integration.

## Deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Next step

The current setup already supports:

- verifying which Zettle organization is connected
- loading live sales data from Zettle on `/sales`

Possible next steps:

- cache daily sales snapshots in Firestore if you want historical reports without live API fetches
- add products/inventory sync if you want stock sync
