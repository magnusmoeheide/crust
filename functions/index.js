import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { logger } from 'firebase-functions'

const POWER_AUTOMATE_STENGESKJEMA_WEBHOOK_URL = defineSecret(
  'POWER_AUTOMATE_STENGESKJEMA_WEBHOOK_URL',
)
const CRUST_STENGESKJEMA_COPY_EMAIL = defineSecret('CRUST_STENGESKJEMA_COPY_EMAIL')
const CRUST_PUBLIC_APP_URL = defineSecret('CRUST_PUBLIC_APP_URL')
const STENGESKJEMA_SLUG = 'stengeskjema'

initializeApp()

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toSubmittedIso(value, fallbackDate = new Date()) {
  if (!value) {
    return fallbackDate.toISOString()
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  return fallbackDate.toISOString()
}

function buildReceiptUrl(baseUrl, formSlug, receiptToken) {
  const normalizedBaseUrl = normalizeText(baseUrl).replace(/\/+$/, '')
  if (!normalizedBaseUrl) {
    return ''
  }

  return `${normalizedBaseUrl}/skjema/${encodeURIComponent(formSlug)}/kvittering/${encodeURIComponent(receiptToken)}`
}

function buildHtmlBody({ formTitle, formSlug, submissionId, submittedAtIso, receiptUrl }) {
  const submittedLabel = new Date(submittedAtIso).toLocaleString('nb-NO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return `
    <div style="font-family:Arial,sans-serif;color:#182c3c;">
      <h2 style="margin:0 0 12px;">${escapeHtml(formTitle)} er sendt inn</h2>
      <p style="margin:0 0 6px;"><strong>Skjema:</strong> ${escapeHtml(formTitle)} (${escapeHtml(formSlug)})</p>
      <p style="margin:0 0 6px;"><strong>Innsending:</strong> ${escapeHtml(submissionId)}</p>
      <p style="margin:0 0 18px;"><strong>Sendt inn:</strong> ${escapeHtml(submittedLabel)}</p>
      <p style="margin:0 0 16px;">Skjemaet er registrert.</p>
      <p style="margin:0;">
        <a href="${escapeHtml(receiptUrl)}" style="color:#182c3c;font-weight:600;">Vis kvitteringen</a>
      </p>
    </div>
  `.trim()
}

function buildTextBody({ formTitle, formSlug, submissionId, submittedAtIso, receiptUrl }) {
  const submittedLabel = new Date(submittedAtIso).toLocaleString('nb-NO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const lines = [
    `${formTitle} er sendt inn`,
    `Skjema: ${formTitle} (${formSlug})`,
    `Innsending: ${submissionId}`,
    `Sendt inn: ${submittedLabel}`,
    '',
    'Skjemaet er registrert.',
    '',
    `Vis kvitteringen: ${receiptUrl}`,
  ]

  return lines.join('\n')
}

function guessSubmitterEmail(submission) {
  const explicitEmail = normalizeText(submission?.submitterEmail)
  if (explicitEmail) {
    return explicitEmail
  }

  const firstEmailLikeValue = Object.values(submission?.answers || {}).find((value) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeText(value)),
  )

  return normalizeText(firstEmailLikeValue)
}

export const notifyPowerAutomateOnStengeskjemaSubmission = onDocumentCreated(
  {
    document: 'formSubmissions/{submissionId}',
    region: 'europe-west1',
    secrets: [
      POWER_AUTOMATE_STENGESKJEMA_WEBHOOK_URL,
      CRUST_STENGESKJEMA_COPY_EMAIL,
      CRUST_PUBLIC_APP_URL,
    ],
    retry: false,
  },
  async (event) => {
    const snapshot = event.data
    if (!snapshot) {
      return
    }

    const submission = snapshot.data()
    if (!submission || submission.formSlug !== STENGESKJEMA_SLUG) {
      return
    }

    const submitterEmail = guessSubmitterEmail(submission)

    if (!submitterEmail) {
      logger.warn('Skipping Power Automate notification because no submitter email was found.', {
        submissionId: snapshot.id,
        formSlug: submission.formSlug,
      })
      return
    }

    const submittedAtIso = toSubmittedIso(submission.submittedAt, new Date())
    const formTitle = normalizeText(submission.formTitle) || 'Stengeskjema'
    const firestore = getFirestore()
    const receiptRef = firestore.collection('formSubmissionReceipts').doc()
    const receiptUrl = buildReceiptUrl(CRUST_PUBLIC_APP_URL.value(), submission.formSlug, receiptRef.id)

    if (!receiptUrl) {
      logger.error('Skipping Power Automate notification because CRUST_PUBLIC_APP_URL is missing.', {
        submissionId: snapshot.id,
      })
      return
    }

    await receiptRef.set({
      formSlug: submission.formSlug,
      formTitle,
      submissionId: snapshot.id,
      submitterEmail,
      submittedAtIso,
      answers: submission.answers || {},
      imagePaths: Array.isArray(submission.imagePaths) ? submission.imagePaths : [],
      createdAt: FieldValue.serverTimestamp(),
    })

    const payload = {
      eventType: 'stengeskjema.submitted',
      submissionId: snapshot.id,
      formSlug: submission.formSlug,
      formTitle,
      submittedAtIso,
      submitterEmail,
      crustCopyEmail: CRUST_STENGESKJEMA_COPY_EMAIL.value(),
      receiptUrl,
      subject: `${formTitle} er sendt inn`,
      htmlBody: buildHtmlBody({
        formTitle,
        formSlug: submission.formSlug,
        submissionId: snapshot.id,
        submittedAtIso,
        receiptUrl,
      }),
      textBody: buildTextBody({
        formTitle,
        formSlug: submission.formSlug,
        submissionId: snapshot.id,
        submittedAtIso,
        receiptUrl,
      }),
    }

    const response = await fetch(POWER_AUTOMATE_STENGESKJEMA_WEBHOOK_URL.value(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const responseText = await response.text()
      logger.error('Power Automate webhook returned a non-2xx response.', {
        submissionId: snapshot.id,
        status: response.status,
        responseText,
      })
      throw new Error(`Power Automate webhook failed with status ${response.status}`)
    }

    await snapshot.ref.update({
      receiptToken: receiptRef.id,
      notificationFlowSentAt: FieldValue.serverTimestamp(),
    })
  },
)
