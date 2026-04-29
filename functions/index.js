require("dotenv").config();
const crypto = require("node:crypto");
const admin = require("firebase-admin");
const functions = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const { logger } = require("firebase-functions");
const { setGlobalOptions } = require("firebase-functions/v2");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { getFinancialReport } = require("./services/financialReport");
const {
  getPlandayLaborReportData,
  verifyPlandayToken,
} = require("./services/plandayService");

admin.initializeApp();

setGlobalOptions({
  region: "europe-west1",
  maxInstances: 10,
});

const db = admin.firestore();
const fieldValue = admin.firestore.FieldValue;
const timestamp = admin.firestore.Timestamp;

const ZETTLE_CLIENT_ID = defineSecret("ZETTLE_CLIENT_ID");
const ZETTLE_CLIENT_SECRET = defineSecret("ZETTLE_CLIENT_SECRET");
const ZETTLE_APP_URL = defineSecret("ZETTLE_APP_URL");
const ZETTLE_REDIRECT_URI = defineSecret("ZETTLE_REDIRECT_URI");
const PLANDAY_CLIENT_ID = defineSecret("PLANDAY_CLIENT_ID");
const PLANDAY_TOKEN = defineSecret("PLANDAY_TOKEN");

const PLANDAY_OAUTH_BASE_URL = "https://id.planday.com";
const PLANDAY_API_BASE_URL = "https://openapi.planday.com";
const PLANDAY_DEFAULT_SCOPE = "plandayapi";
const PLANDAY_PUBLIC_DOC_ID = "planday";
const PLANDAY_PRIVATE_COLLECTION = "plandayPrivate";
const PLANDAY_PRIVATE_DOC_ID = "default";

const ZETTLE_OAUTH_BASE_URL = "https://oauth.zettle.com";
const ZETTLE_PURCHASE_BASE_URL = "https://purchase.izettle.com";
const ZETTLE_DEFAULT_SCOPE = "READ:FINANCE READ:PURCHASE";
const INTEGRATIONS_COLLECTION = "integrations";
const ZETTLE_PUBLIC_DOC_ID = "zettle";
const ZETTLE_PRIVATE_COLLECTION = "zettlePrivate";
const ZETTLE_PRIVATE_DOC_ID = "default";
const ZETTLE_OAUTH_STATES_COLLECTION = "zettleOAuthStates";
const ZETTLE_TOKEN_REFRESH_BUFFER_MS = 2 * 60 * 1000;
const SALES_REPORT_MAX_DAYS = 31;
const SALES_REPORT_PAGE_LIMIT = 200;
const SALES_REPORT_MAX_PAGES = 20;

function isCrustEmail(value) {
  return typeof value === "string" && /@crust\.no$/i.test(value);
}

function getAuthEmail(auth) {
  return String(auth?.token?.email || auth?.token?.preferred_username || "").trim();
}

function requireAdminAuth(request) {
  const email = getAuthEmail(request.auth);
  if (!request.auth?.uid || !isCrustEmail(email)) {
    throw new HttpsError("permission-denied", "Admin login required.");
  }
  return { uid: request.auth.uid, email };
}

function getProviderReturnUrl(appUrl, provider, status, errorCode = "") {
  const searchParams = new URLSearchParams();
  searchParams.set(provider, status);
  if (errorCode) {
    searchParams.set(`${provider}_error`, errorCode);
  }
  const baseUrl = String(appUrl || "").trim();
  if (baseUrl) {
    try {
      const url = new URL("/admin", baseUrl);
      url.search = searchParams.toString();
      return url.toString();
    } catch {
      return `/admin?${searchParams.toString()}`;
    }
  }
  return `/admin?${searchParams.toString()}`;
}

async function verifyFirebaseBearerToken(request) {
  const authHeader = String(request.headers?.authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new HttpsError("unauthenticated", "Missing Authorization bearer token.");
  }
  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    throw new HttpsError("unauthenticated", "Missing bearer token.");
  }
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch {
    throw new HttpsError("unauthenticated", "Invalid or expired auth token.");
  }
}

async function requireRequestAdminAuth(request) {
  const decodedToken = await verifyFirebaseBearerToken(request);
  const email = String(decodedToken.email || decodedToken.preferred_username || "").trim();
  if (!decodedToken.uid || !isCrustEmail(email)) {
    throw new HttpsError("permission-denied", "Admin access required.");
  }
  return { uid: decodedToken.uid, email };
}

function getSecretValue(secretParam, name) {
  const value = String(secretParam?.value?.() || process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function getExpiryTimestamp(expiresInSeconds) {
  const parsedSeconds = Number(expiresInSeconds);
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return null;
  }
  return timestamp.fromDate(new Date(Date.now() + parsedSeconds * 1000));
}

function getDateFromTimestamp(value) {
  const date = value?.toDate?.();
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatUtcDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function formatUtcDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoBoundary(value, fieldName) {
  const text = String(value || "").trim();
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime())) {
    throw new HttpsError("invalid-argument", `Invalid ${fieldName}.`);
  }
  return parsed;
}

function parseDateOnly(value, fieldName) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Invalid ${fieldName}. Expected format YYYY-MM-DD.`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName}. Expected format YYYY-MM-DD.`);
  }
  return text;
}

function normalizeErrorMessage(error, fallbackMessage) {
  if (error instanceof HttpsError) return error.message || fallbackMessage;
  if (error instanceof Error && error.message) return error.message;
  return fallbackMessage;
}

function getZettlePrivateRef() {
  return db.collection(ZETTLE_PRIVATE_COLLECTION).doc(ZETTLE_PRIVATE_DOC_ID);
}

function getPlandayPrivateRef() {
  return db.collection(PLANDAY_PRIVATE_COLLECTION).doc(PLANDAY_PRIVATE_DOC_ID);
}

function getPlandayConfig() {
  const clientId = String(process.env.PLANDAY_CLIENT_ID || getSecretValue(PLANDAY_CLIENT_ID, "PLANDAY_CLIENT_ID") || "").trim();
  const token = String(process.env.PLANDAY_TOKEN || getSecretValue(PLANDAY_TOKEN, "PLANDAY_TOKEN") || "").trim();
  if (!clientId) throw new HttpsError("failed-precondition", "Planday client ID is missing.");
  if (!token) throw new HttpsError("failed-precondition", "Planday refresh token is missing.");
  return { clientId, refreshToken: token };
}

async function setPublicStatus(payload) {
  await db.collection(INTEGRATIONS_COLLECTION).doc(ZETTLE_PUBLIC_DOC_ID).set(
    { provider: "zettle", updatedAt: fieldValue.serverTimestamp(), ...payload },
    { merge: true },
  );
}

async function setPlandayPublicStatus(payload) {
  await db.collection(INTEGRATIONS_COLLECTION).doc(PLANDAY_PUBLIC_DOC_ID).set(
    { provider: "planday", updatedAt: fieldValue.serverTimestamp(), ...payload },
    { merge: true },
  );
}

function parseIsoLocalDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return formatUtcDate(parsed);
}

function parseDurationToMinutes(value) {
  const parts = String(value || "").trim().split(":");
  if (parts.length !== 3) return 0;
  const days = Number(parts[0] || 0);
  const hours = Number(parts[1] || 0);
  const minutes = Number(parts[2] || 0);
  if (![days, hours, minutes].every(Number.isFinite)) return 0;
  return days * 24 * 60 + hours * 60 + minutes;
}

function parseDepartmentIds(value) {
  const input = Array.isArray(value) ? value : [];
  const uniqueIds = [];
  input.forEach((entry) => {
    const numericId = Number(String(entry || "").trim());
    if (!Number.isInteger(numericId) || numericId <= 0) return;
    if (!uniqueIds.includes(numericId)) uniqueIds.push(numericId);
  });
  return uniqueIds;
}

async function getStoredZettleConnection() {
  const snapshot = await getZettlePrivateRef().get();
  if (!snapshot.exists) throw new HttpsError("failed-precondition", "Zettle is not connected.");
  const data = snapshot.data() || {};
  const accessToken = String(data.accessToken || "").trim();
  const refreshToken = String(data.refreshToken || "").trim();
  if (!accessToken || !refreshToken) throw new HttpsError("failed-precondition", "Zettle tokens are missing.");
  return data;
}

async function getStoredPlandayConnection() {
  const snapshot = await getPlandayPrivateRef().get();
  if (!snapshot.exists) throw new HttpsError("failed-precondition", "Planday is not connected.");
  const data = snapshot.data() || {};
  const accessToken = String(data.accessToken || "").trim();
  if (!accessToken) throw new HttpsError("failed-precondition", "Planday access token is missing.");
  return data;
}

async function storeZettleTokens(currentData, tokenData) {
  const expiresAt = getExpiryTimestamp(tokenData.expires_in);
  const nextRefreshToken = String(tokenData.refresh_token || currentData?.refreshToken || "").trim();
  const nextScope = String(tokenData.scope || currentData?.scope || "").trim();
  const nextTokenType = String(tokenData.token_type || currentData?.tokenType || "Bearer").trim();
  await getZettlePrivateRef().set(
    {
      accessToken: String(tokenData.access_token || "").trim(),
      refreshToken: nextRefreshToken,
      tokenType: nextTokenType || "Bearer",
      scope: nextScope,
      expiresAt,
      updatedAt: fieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await setPublicStatus({
    status: "connected",
    scope: nextScope,
    tokenType: nextTokenType || "Bearer",
    expiresAt,
    lastError: fieldValue.delete(),
  });
  return {
    ...currentData,
    accessToken: String(tokenData.access_token || "").trim(),
    refreshToken: nextRefreshToken,
    tokenType: nextTokenType || "Bearer",
    scope: nextScope,
    expiresAt,
  };
}

async function refreshZettleAccessToken(currentData) {
  const refreshToken = String(currentData?.refreshToken || "").trim();
  if (!refreshToken) throw new HttpsError("failed-precondition", "Zettle refresh token is missing.");
  const zettleClientId = getSecretValue(ZETTLE_CLIENT_ID, "ZETTLE_CLIENT_ID");
  const zettleClientSecret = getSecretValue(ZETTLE_CLIENT_SECRET, "ZETTLE_CLIENT_SECRET");
  const tokenResponse = await fetch(`${ZETTLE_OAUTH_BASE_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: zettleClientId,
      client_secret: zettleClientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!tokenResponse.ok) {
    const failureBody = await tokenResponse.text();
    logger.error("Zettle refresh token exchange failed", { status: tokenResponse.status, body: failureBody });
    await setPublicStatus({ status: "error", lastError: `Token refresh failed (${tokenResponse.status}).` });
    throw new HttpsError("internal", "Unable to refresh Zettle access token.");
  }
  const tokenData = await tokenResponse.json();
  return storeZettleTokens(currentData, tokenData);
}

async function getValidZettleConnection() {
  const currentData = await getStoredZettleConnection();
  const expiryDate = getDateFromTimestamp(currentData.expiresAt);
  const accessToken = String(currentData.accessToken || "").trim();
  if (!accessToken) throw new HttpsError("failed-precondition", "Zettle access token is missing.");
  if (expiryDate && expiryDate.getTime() <= Date.now() + ZETTLE_TOKEN_REFRESH_BUFFER_MS) {
    return refreshZettleAccessToken(currentData);
  }
  return currentData;
}

async function zettleApiFetchJson(url, accessToken) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Zettle API request failed (${response.status}).`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return response.json();
}

async function zettleApiGet(url) {
  let connection = await getValidZettleConnection();
  try {
    return await zettleApiFetchJson(url, String(connection.accessToken || "").trim());
  } catch (error) {
    if (error?.status !== 401) throw error;
    connection = await refreshZettleAccessToken(connection);
    return zettleApiFetchJson(url, String(connection.accessToken || "").trim());
  }
}

async function fetchZettleIdentity() {
  return zettleApiGet(`${ZETTLE_OAUTH_BASE_URL}/users/self`);
}

function buildPurchaseSummary(purchases) {
  let currency = "";
  let grossSalesAmount = 0;
  let refundAmount = 0;
  let netSalesAmount = 0;
  let salesCount = 0;
  let refundCount = 0;
  const paymentTotals = new Map();
  const productTotals = new Map();
  const dailyTotals = new Map();

  const normalizedPurchases = purchases.map((purchase) => {
    const amount = Number(purchase?.amount || 0);
    const vatAmount = Number(purchase?.vatAmount || 0);
    const netAmount = amount - vatAmount;
    const isRefund = Boolean(purchase?.refund) || amount < 0;
    const purchaseCurrency = String(purchase?.currency || "").trim();
    if (!currency && purchaseCurrency) currency = purchaseCurrency;
    netSalesAmount += netAmount;
    if (isRefund) { refundCount += 1; refundAmount += Math.abs(amount); }
    else { salesCount += 1; grossSalesAmount += amount; }
    const purchaseDate = parseIsoLocalDate(purchase?.timestamp || purchase?.created || "");
    if (purchaseDate) {
      const currentDay = dailyTotals.get(purchaseDate) || {
        date: purchaseDate, grossSalesAmount: 0, netSalesAmount: 0,
        vatAmount: 0, refundAmount: 0, salesCount: 0, refundCount: 0,
      };
      currentDay.grossSalesAmount += amount;
      currentDay.netSalesAmount += netAmount;
      currentDay.vatAmount += vatAmount;
      if (isRefund) { currentDay.refundAmount += Math.abs(amount); currentDay.refundCount += 1; }
      else { currentDay.salesCount += 1; }
      dailyTotals.set(purchaseDate, currentDay);
    }
    const paymentTypes = Array.isArray(purchase?.payments) ? purchase.payments : [];
    paymentTypes.forEach((payment) => {
      const type = String(payment?.type || "UNKNOWN").trim() || "UNKNOWN";
      paymentTotals.set(type, Number(paymentTotals.get(type) || 0) + Number(payment?.amount || 0));
    });
    const products = Array.isArray(purchase?.products) ? purchase.products : [];
    products.forEach((product) => {
      const name = String(product?.name || "").trim();
      if (!name) return;
      const current = productTotals.get(name) || { name, quantity: 0, amount: 0 };
      const quantity = Number(product?.quantity || 0);
      const unitPrice = Number(product?.unitPrice || 0);
      current.quantity += quantity;
      current.amount += quantity * unitPrice;
      productTotals.set(name, current);
    });
    return {
      purchaseUuid: String(purchase?.purchaseUUID1 || purchase?.purchaseUUID || "").trim(),
      timestamp: String(purchase?.timestamp || purchase?.created || "").trim(),
      amount, netAmount, vatAmount, currency: purchaseCurrency,
      source: String(purchase?.source || "").trim(),
      purchaseNumber: purchase?.purchaseNumber == null ? null : Number(purchase.purchaseNumber),
      userDisplayName: String(purchase?.userDisplayName || "").trim(),
      refunded: Boolean(purchase?.refunded),
      refund: Boolean(purchase?.refund),
      paymentTypes: paymentTypes.map((payment) => String(payment?.type || "UNKNOWN")),
      productNames: products.map((product) => String(product?.name || "").trim()).filter(Boolean).slice(0, 4),
    };
  });

  return {
    currency,
    recordCount: normalizedPurchases.length,
    salesCount, refundCount, grossSalesAmount, refundAmount, netSalesAmount,
    paymentBreakdown: Array.from(paymentTotals.entries()).map(([type, amount]) => ({ type, amount })).sort((l, r) => Math.abs(r.amount) - Math.abs(l.amount)),
    topProducts: Array.from(productTotals.values()).sort((l, r) => Math.abs(r.amount) - Math.abs(l.amount)).slice(0, 8),
    dailySales: Array.from(dailyTotals.values()).sort((l, r) => l.date.localeCompare(r.date)),
    purchases: normalizedPurchases,
  };
}

async function fetchZettlePurchases(startAt, endAt) {
  const purchases = [];
  let lastPurchaseHash = "";
  let truncated = false;
  for (let pageIndex = 0; pageIndex < SALES_REPORT_MAX_PAGES; pageIndex += 1) {
    const params = new URLSearchParams({
      limit: String(SALES_REPORT_PAGE_LIMIT),
      descending: "true",
      startDate: formatUtcDateTime(startAt),
      endDate: formatUtcDateTime(endAt),
    });
    if (lastPurchaseHash) params.set("lastPurchaseHash", lastPurchaseHash);
    const data = await zettleApiGet(`${ZETTLE_PURCHASE_BASE_URL}/purchases/v2?${params.toString()}`);
    const pagePurchases = Array.isArray(data?.purchases) ? data.purchases : [];
    if (pagePurchases.length === 0) break;
    purchases.push(...pagePurchases);
    lastPurchaseHash = String(data?.lastPurchaseHash || "").trim();
    if (!lastPurchaseHash || !Array.isArray(data?.linkUrls) || data.linkUrls.length === 0) break;
    if (pageIndex === SALES_REPORT_MAX_PAGES - 1) truncated = true;
  }
  return { purchases, truncated };
}

exports.createZettleAuthSession = onCall(
  { secrets: [ZETTLE_CLIENT_ID, ZETTLE_REDIRECT_URI], cors: true },
  async (request) => {
    const adminUser = requireAdminAuth(request);
    const state = crypto.randomUUID();
    await db.collection(ZETTLE_OAUTH_STATES_COLLECTION).doc(state).set({
      initiatedByUid: adminUser.uid,
      initiatedByEmail: adminUser.email,
      createdAt: fieldValue.serverTimestamp(),
    });
    const zettleClientId = getSecretValue(ZETTLE_CLIENT_ID, "ZETTLE_CLIENT_ID");
    const zettleRedirectUri = getSecretValue(ZETTLE_REDIRECT_URI, "ZETTLE_REDIRECT_URI");
    const authUrl = new URL("/authorize", ZETTLE_OAUTH_BASE_URL);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", zettleClientId);
    authUrl.searchParams.set("scope", ZETTLE_DEFAULT_SCOPE);
    authUrl.searchParams.set("redirect_uri", zettleRedirectUri);
    authUrl.searchParams.set("state", state);
    await setPublicStatus({ status: "pending", pendingAt: fieldValue.serverTimestamp(), pendingByEmail: adminUser.email, lastError: fieldValue.delete() });
    return { authUrl: authUrl.toString() };
  },
);

exports.zettleAuthCallback = onRequest(
  { secrets: [ZETTLE_CLIENT_ID, ZETTLE_CLIENT_SECRET, ZETTLE_APP_URL, ZETTLE_REDIRECT_URI] },
  async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    const method = String(request.method || "").toUpperCase();
    if (method === "OPTIONS") { response.status(204).send(""); return; }
    if (method !== "GET") { response.status(405).send("Method Not Allowed"); return; }
    const zettleClientId = getSecretValue(ZETTLE_CLIENT_ID, "ZETTLE_CLIENT_ID");
    const zettleClientSecret = getSecretValue(ZETTLE_CLIENT_SECRET, "ZETTLE_CLIENT_SECRET");
    const zettleRedirectUri = getSecretValue(ZETTLE_REDIRECT_URI, "ZETTLE_REDIRECT_URI");
    const zettleAppUrl = getSecretValue(ZETTLE_APP_URL, "ZETTLE_APP_URL");
    const code = String(request.query.code || "").trim();
    const state = String(request.query.state || "").trim();
    const oauthError = String(request.query.error || "").trim();
    const oauthErrorDescription = String(request.query.error_description || "").trim();
    const stateRef = db.collection(ZETTLE_OAUTH_STATES_COLLECTION).doc(state);
    if (!state || (!code && !oauthError)) { response.redirect(302, getProviderReturnUrl(zettleAppUrl, "zettle", "error", "missing_state")); return; }
    const stateSnapshot = await stateRef.get();
    if (!stateSnapshot.exists) { response.redirect(302, getProviderReturnUrl(zettleAppUrl, "zettle", "error", "invalid_state")); return; }
    const stateData = stateSnapshot.data() || {};
    if (oauthError) {
      await setPublicStatus({ status: "error", lastError: oauthErrorDescription || oauthError });
      await stateRef.delete().catch(() => {});
      response.redirect(302, getProviderReturnUrl(zettleAppUrl, "zettle", "error", oauthError));
      return;
    }
    try {
      const tokenResponse = await fetch(`${ZETTLE_OAUTH_BASE_URL}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: zettleClientId, client_secret: zettleClientSecret, redirect_uri: zettleRedirectUri, code }).toString(),
      });
      if (!tokenResponse.ok) {
        const failureBody = await tokenResponse.text();
        logger.error("Zettle token exchange failed", { status: tokenResponse.status, body: failureBody });
        await setPublicStatus({ status: "error", lastError: `Token exchange failed (${tokenResponse.status}).` });
        await stateRef.delete().catch(() => {});
        response.redirect(302, getProviderReturnUrl(zettleAppUrl, "zettle", "error", "token_exchange_failed"));
        return;
      }
      const tokenData = await tokenResponse.json();
      const expiresAt = getExpiryTimestamp(tokenData.expires_in);
      await db.collection(ZETTLE_PRIVATE_COLLECTION).doc(ZETTLE_PRIVATE_DOC_ID).set(
        { provider: "zettle", accessToken: String(tokenData.access_token || ""), refreshToken: String(tokenData.refresh_token || ""), tokenType: String(tokenData.token_type || "Bearer"), scope: String(tokenData.scope || ""), expiresAt, updatedAt: fieldValue.serverTimestamp(), connectedByUid: String(stateData.initiatedByUid || ""), connectedByEmail: String(stateData.initiatedByEmail || "") },
        { merge: true },
      );
      await setPublicStatus({ status: "connected", connectedAt: fieldValue.serverTimestamp(), connectedByUid: String(stateData.initiatedByUid || ""), connectedByEmail: String(stateData.initiatedByEmail || ""), scope: String(tokenData.scope || ""), tokenType: String(tokenData.token_type || "Bearer"), expiresAt, lastError: fieldValue.delete() });
      await stateRef.delete().catch(() => {});
      response.redirect(302, getProviderReturnUrl(zettleAppUrl, "zettle", "connected"));
    } catch (error) {
      logger.error("Zettle callback failed", error);
      await setPublicStatus({ status: "error", lastError: error instanceof Error ? error.message : "Unknown callback error." });
      await stateRef.delete().catch(() => {});
      response.redirect(302, getProviderReturnUrl(zettleAppUrl, "zettle", "error", "callback_failed"));
    }
  },
);

exports.disconnectZettle = onCall(
  { cors: true },
  async (request) => {
    const adminUser = requireAdminAuth(request);
    await db.collection(ZETTLE_PRIVATE_COLLECTION).doc(ZETTLE_PRIVATE_DOC_ID).delete();
    await setPublicStatus({ status: "not_connected", disconnectedAt: fieldValue.serverTimestamp(), disconnectedByEmail: adminUser.email, lastError: fieldValue.delete() });
    return { ok: true };
  },
);

exports.verifyZettleConnection = onCall(
  { secrets: [ZETTLE_CLIENT_ID, ZETTLE_CLIENT_SECRET, ZETTLE_REDIRECT_URI], cors: true },
  async (request) => {
    requireAdminAuth(request);
    try {
      const identity = await fetchZettleIdentity();
      const userUuid = String(identity?.uuid || "").trim();
      const organizationUuid = String(identity?.organizationUuid || "").trim();
      await setPublicStatus({ status: "connected", zettleUserUuid: userUuid || fieldValue.delete(), organizationUuid: organizationUuid || fieldValue.delete(), verifiedAt: fieldValue.serverTimestamp(), lastError: fieldValue.delete() });
      return { connected: true, userUuid, organizationUuid };
    } catch (error) {
      logger.error("Zettle verification failed", error);
      const message = normalizeErrorMessage(error, "Unable to verify Zettle connection.");
      await setPublicStatus({ status: "error", lastError: message });
      throw new HttpsError("internal", message);
    }
  },
);

exports.refreshZettleToken = onCall(
  { secrets: [ZETTLE_CLIENT_ID, ZETTLE_CLIENT_SECRET, ZETTLE_REDIRECT_URI], cors: true },
  async (request) => {
    requireAdminAuth(request);
    try {
      const currentData = await getStoredZettleConnection();
      const refreshedData = await refreshZettleAccessToken(currentData);
      await setPublicStatus({ status: "connected", message: "Zettle token refreshed successfully." });
      return { success: true, expiresAt: refreshedData.expiresAt };
    } catch (error) {
      const message = normalizeErrorMessage(error, "Unable to refresh Zettle token.");
      await setPublicStatus({ status: "error", lastError: message });
      throw new HttpsError("internal", message);
    }
  },
);

exports.getZettleSalesReport = onCall(
  { secrets: [ZETTLE_CLIENT_ID, ZETTLE_CLIENT_SECRET, ZETTLE_REDIRECT_URI], cors: true },
  async (request) => {
    requireAdminAuth(request);
    const startAt = parseIsoBoundary(request.data?.startAt, "startAt");
    const endAt = parseIsoBoundary(request.data?.endAt, "endAt");
    if (endAt <= startAt) throw new HttpsError("invalid-argument", "endAt must be after startAt.");
    const daySpan = (endAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daySpan > SALES_REPORT_MAX_DAYS) throw new HttpsError("invalid-argument", `Sales report range cannot exceed ${SALES_REPORT_MAX_DAYS} days.`);
    try {
      const identity = await fetchZettleIdentity();
      const userUuid = String(identity?.uuid || "").trim();
      const organizationUuid = String(identity?.organizationUuid || "").trim();
      const purchaseResult = await fetchZettlePurchases(startAt, endAt);
      const summary = buildPurchaseSummary(purchaseResult.purchases);
      await setPublicStatus({ status: "connected", zettleUserUuid: userUuid || fieldValue.delete(), organizationUuid: organizationUuid || fieldValue.delete(), verifiedAt: fieldValue.serverTimestamp(), lastSalesFetchAt: fieldValue.serverTimestamp(), lastError: fieldValue.delete() });
      return { startAt: startAt.toISOString(), endAt: endAt.toISOString(), connectedAccount: { userUuid, organizationUuid }, truncated: purchaseResult.truncated, ...summary };
    } catch (error) {
      logger.error("Zettle sales report failed", error);
      const message = normalizeErrorMessage(error, "Unable to load Zettle sales report.");
      await setPublicStatus({ status: "error", lastError: message });
      throw new HttpsError("internal", message);
    }
  },
);

exports.connectPlanday = onRequest(
  { secrets: [PLANDAY_CLIENT_ID, PLANDAY_TOKEN] },
  async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    const method = String(request.method || "").toUpperCase();
    if (method === "OPTIONS") { response.status(204).send(""); return; }
    if (method !== "POST" && method !== "GET") { response.status(405).json({ error: "Method Not Allowed" }); return; }
    try {
      const adminUser = await requireRequestAdminAuth(request);
      const verification = await verifyPlandayToken();
      await setPlandayPublicStatus({ status: "connected", connectedAt: fieldValue.serverTimestamp(), connectedByEmail: adminUser.email, employeeCount: Number(verification.employeeCount || 0), verifiedAt: fieldValue.serverTimestamp(), authType: "refresh_token", lastError: fieldValue.delete() });
      response.json({ connected: true, employeeCount: Number(verification.employeeCount || 0) });
    } catch (error) {
      logger.error("Planday connection failed", error);
      const message = normalizeErrorMessage(error, "Unable to connect to Planday.");
      await setPlandayPublicStatus({ status: "error", lastError: message });
      response.status(500).json({ error: message });
    }
  },
);

exports.verifyPlandayConnection = exports.connectPlanday;

exports.verifyPlandayConnection = onCall(
  { secrets: [PLANDAY_CLIENT_ID, PLANDAY_TOKEN], cors: true },
  async (request) => {
    requireAdminAuth(request);
    try {
      const verification = await verifyPlandayToken();
      return { employeeCount: Number(verification.employeeCount || 0) };
    } catch (error) {
      logger.error("Planday verification failed", error);
      const message = normalizeErrorMessage(error, "Unable to verify Planday token.");
      throw new HttpsError("internal", message);
    }
  },
);

exports.plandayAuthCallback = onRequest(
  { secrets: [PLANDAY_CLIENT_ID, PLANDAY_TOKEN] },
  async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    const method = String(request.method || "").toUpperCase();
    if (method === "OPTIONS") { response.status(204).send(""); return; }
    if (method !== "GET" && method !== "POST") { response.status(405).json({ error: "Method Not Allowed" }); return; }
    const errorCode = String(request.query?.error || "").trim();
    const errorDescription = String(request.query?.error_description || "").trim();
    const code = String(request.query?.code || "").trim();
    if (!errorCode && !code) { response.status(400).json({ error: "Missing callback parameters." }); return; }
    if (errorCode) {
      await setPlandayPublicStatus({ status: "error", lastError: errorDescription || errorCode });
      response.status(200).json({ ok: false, error: errorCode, errorDescription });
      return;
    }
    response.status(501).json({ ok: false, error: "Planday OAuth callback flow is not supported. Use connectPlanday with a stored PLANDAY_TOKEN.", code });
  },
);

exports.disconnectPlanday = onCall(
  { cors: true },
  async (request) => {
    const adminUser = requireAdminAuth(request);
    await setPlandayPublicStatus({ status: "not_connected", disconnectedAt: fieldValue.serverTimestamp(), disconnectedByEmail: adminUser.email, authType: "bearer_token", employeeCount: fieldValue.delete(), lastError: fieldValue.delete() });
    return { ok: true };
  },
);

exports.getPlandayLaborReport = onCall(
  { secrets: [PLANDAY_CLIENT_ID, PLANDAY_TOKEN], cors: true },
  async (request) => {
    requireAdminAuth(request);
    const startAt = parseIsoBoundary(request.data?.startAt, "startAt");
    const endAt = parseIsoBoundary(request.data?.endAt, "endAt");
    const departmentIds = parseDepartmentIds(request.data?.departmentIds);
    if (endAt <= startAt) throw new HttpsError("invalid-argument", "endAt must be after startAt.");
    if (departmentIds.length === 0) throw new HttpsError("invalid-argument", "At least one Planday department ID is required.");
    const daySpan = (endAt.getTime() - startAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daySpan > SALES_REPORT_MAX_DAYS) throw new HttpsError("invalid-argument", `Labor report range cannot exceed ${SALES_REPORT_MAX_DAYS} days.`);
    try {
      const fromDate = formatUtcDate(startAt);
      const toDate = formatUtcDate(new Date(endAt.getTime() - 1));
      const summary = await getPlandayLaborReportData({ from: fromDate, to: toDate, departmentIds });
      await setPlandayPublicStatus({ status: "connected", authType: "refresh_token", verifiedAt: fieldValue.serverTimestamp(), lastLaborFetchAt: fieldValue.serverTimestamp(), lastError: fieldValue.delete() });
      return { startAt: startAt.toISOString(), endAt: endAt.toISOString(), departmentIds, ...summary };
    } catch (error) {
      logger.error("Planday labor report failed", error);
      const message = normalizeErrorMessage(error, "Unable to load Planday labor report.");
      await setPlandayPublicStatus({ status: "error", lastError: message });
      throw new HttpsError("internal", message);
    }
  },
);

// ✅ Returns employees missing hourly rates in Firestore
exports.getMissingRates = onCall(
  { secrets: [PLANDAY_CLIENT_ID, PLANDAY_TOKEN], cors: true },
  async (request) => {
    requireAdminAuth(request);
    const { getMissingRateReport } = require("./services/plandayService");
    return getMissingRateReport();
  },
);

// ✅ financialReport with all required secrets including Zettle for auto-refresh
exports.financialReport = onRequest(
  {
    secrets: [PLANDAY_CLIENT_ID, PLANDAY_TOKEN, ZETTLE_CLIENT_ID, ZETTLE_CLIENT_SECRET],
  },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (request.method === "OPTIONS") { response.status(204).send(""); return; }
    if (request.method !== "GET") { response.status(405).json({ error: "Method Not Allowed" }); return; }

    try {
      const startDateRaw = String(request.query?.startDate || "").trim();
      const endDateRaw = String(request.query?.endDate || "").trim();

      // ✅ Support multiple locations via comma-separated query param
      const locationRaw = String(request.query?.location || "all").trim();
      const locations = locationRaw === "all"
        ? ["all"]
        : locationRaw.split(",").map((l) => l.trim()).filter(Boolean);

      if (!startDateRaw || !endDateRaw) {
        response.status(400).json({ error: "Missing required query parameters: startDate and endDate." });
        return;
      }

      const startDate = parseDateOnly(startDateRaw, "startDate");
      const endDate = parseDateOnly(endDateRaw, "endDate");

      if (startDate > endDate) {
        response.status(400).json({ error: "Invalid date range: startDate must be before or equal to endDate." });
        return;
      }

      const report = await getFinancialReport(startDate, endDate, locations);
      response.status(200).json(report);
    } catch (error) {
      logger.error("Financial report endpoint failed", error);
      const message = error instanceof Error ? error.message : "Unable to generate financial report.";
      const statusCode = message.startsWith("Invalid ") || message.startsWith("Missing ") ? 400 : 500;
      response.status(statusCode).json({ error: message });
    }
  },
);