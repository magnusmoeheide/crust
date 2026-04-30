// src/services/financialReportApi.js
import { getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const REGION = "europe-west1";

export async function loadFinancialReport({ startDate, endDate, location }) {
  const projectId = getApp().options.projectId;
  const params = new URLSearchParams({ startDate, endDate, location });
  const url = `https://${REGION}-${projectId}.cloudfunctions.net/financialReport?${params}`;

  const token = await getAuth().currentUser?.getIdToken();

  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }

  return res.json();
}