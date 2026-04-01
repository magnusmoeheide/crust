import { useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '../firebase'
import { STENGESKJEMA_ID, defaultStengeskjema } from '../forms/defaultForms'
import { useAdminSession } from '../hooks/useAdminSession'
import './Forms.css'

const LOCATION_OTHER_VALUE = '__other_location__'
const FORM_DRAFT_STORAGE_PREFIX = 'crust-form-draft:'
const FORM_LANGUAGE_STORAGE_KEY = 'crust-public-form-language'
const ENGLISH_TRANSLATION_CACHE_KEY = 'crust-public-form-english-cache'
const SUBMISSION_DATE_KEY = 'Innsendt dato'
const SUBMISSION_TIME_KEY = 'Innsendt tid'
const SELECT_DETAIL_SUFFIX = '__details'
const SELF_DECLARATION_ACCEPTED_KEY = 'Egenerklæring bekreftet'
const SELECT_OPTION_HISTORY_CATEGORIES = ['normal', 'orange', 'red']
const RECEIPT_EDIT_WINDOW_MS = 30 * 60 * 1000
const PUBLIC_FORM_COPY = {
  no: {
    languageLabel: 'Språk',
    norwegian: 'Norsk',
    english: 'English',
    translating: 'Oversetter skjemaet til engelsk...',
    translatingHint: 'Dette kan ta noen sekunder.',
    translationError: 'Kunne ikke oversette alt akkurat nå. Noe vises fortsatt på norsk.',
    formEyebrow: 'Skjema',
    receiptEyebrow: 'Kvittering',
    receiptLead: 'Her er en kopi av akkurat denne innsendingen.',
    receiptTitlePrefix: 'Takk,',
    receiptTitleSuffix: 'er sendt inn',
    submissionLabel: 'Innsending',
    submittedLabel: 'Sendt inn',
    loadingImage: 'Laster bilde...',
    loadingForm: 'Laster skjema...',
    loadingReceipt: 'Laster kvittering...',
    editSubmission: 'Rediger',
    editWindowExpired: 'Redigeringsfristen på 30 minutter er utløpt.',
    editingSubmission: 'Du redigerer en tidligere innsending.',
    resetAnswers: 'Nullstill alle svar',
    resetAnswersConfirm: 'Nullstill alle svar i skjemaet?',
    sendForm: 'Send skjema',
    sendingForm: 'Sender skjema...',
    formSent: 'Skjema sendt inn',
    select: 'Velg',
    loadingLocations: 'Laster lokasjoner...',
    chooseLocation: 'Velg lokasjon',
    other: 'Annet',
    noLocationsHelp: 'Ingen lagrede lokasjoner funnet. Velg "Annet" for å skrive inn manuelt.',
    writeHere: 'Skriv her',
    enterLocation: 'Skriv inn lokasjon',
    takePhoto: 'Ta bilde',
    uploadNewPhoto: 'Last opp nytt bilde',
    describeMore: 'Beskriv nærmere',
    fullName: 'Fullt navn',
    emailAddress: 'E-postadresse',
    selfDeclarationFallback: 'Jeg bekrefter opplysningene i skjemaet.',
    confirmSelfDeclaration: 'Jeg bekrefter egenerklæringen',
    optionalNote: ' (ikke obligatorisk)',
  },
  en: {
    languageLabel: 'Language',
    norwegian: 'Norwegian',
    english: 'English',
    translating: 'Translating the form to English...',
    translatingHint: 'This can take a few seconds.',
    translationError: 'Could not translate everything right now. Some text is still shown in Norwegian.',
    formEyebrow: 'Form',
    receiptEyebrow: 'Receipt',
    receiptLead: 'Here is a copy of this exact submission.',
    receiptTitlePrefix: 'Thanks,',
    receiptTitleSuffix: 'has been submitted',
    submissionLabel: 'Submission',
    submittedLabel: 'Submitted',
    loadingImage: 'Loading image...',
    loadingForm: 'Loading form...',
    loadingReceipt: 'Loading receipt...',
    editSubmission: 'Edit',
    editWindowExpired: 'The 30-minute edit window has expired.',
    editingSubmission: 'You are editing a previous submission.',
    resetAnswers: 'Reset all answers',
    resetAnswersConfirm: 'Reset all answers in the form?',
    sendForm: 'Submit form',
    sendingForm: 'Submitting form...',
    formSent: 'Form submitted',
    select: 'Choose',
    loadingLocations: 'Loading locations...',
    chooseLocation: 'Choose location',
    other: 'Other',
    noLocationsHelp: 'No saved locations were found. Choose "Other" to enter one manually.',
    writeHere: 'Write here',
    enterLocation: 'Enter location',
    takePhoto: 'Take photo',
    uploadNewPhoto: 'Upload a new photo',
    describeMore: 'Describe in more detail',
    fullName: 'Full name',
    emailAddress: 'Email address',
    selfDeclarationFallback: 'I confirm the information in the form.',
    confirmSelfDeclaration: 'I confirm the self-declaration',
    optionalNote: ' (optional)',
  },
}

function toQuestionId(raw) {
  const base = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!base) {
    return `question-${Math.random().toString(36).slice(2, 8)}`
  }
  return base
}

function sanitizeFileName(name) {
  return String(name || 'image')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-')
}

function parseQuestionOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions
      .map((option) => String(option || '').trim())
      .filter((option) => option.length > 0)
  }

  if (typeof rawOptions === 'string') {
    return rawOptions
      .split(',')
      .map((option) => option.trim())
      .filter((option) => option.length > 0)
  }

  return []
}

function normalizeVisibleForLocations(rawLocations) {
  const values = Array.isArray(rawLocations)
    ? rawLocations
    : typeof rawLocations === 'string'
      ? rawLocations.split(',')
      : []

  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  )
}

function readPreferredPublicFormLanguage() {
  if (typeof window === 'undefined') {
    return 'no'
  }

  try {
    return window.localStorage.getItem(FORM_LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'no'
  } catch {
    return 'no'
  }
}

function writePreferredPublicFormLanguage(language) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(FORM_LANGUAGE_STORAGE_KEY, language === 'en' ? 'en' : 'no')
  } catch {}
}

function readEnglishTranslationCache() {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const stored = window.localStorage.getItem(ENGLISH_TRANSLATION_CACHE_KEY)
    if (!stored) {
      return {}
    }

    const parsed = JSON.parse(stored)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeEnglishTranslationCache(cache) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(ENGLISH_TRANSLATION_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

function collectFormTranslationTexts(form) {
  const textSet = new Set()

  function addText(value) {
    const text = String(value || '').trim()
    if (text) {
      textSet.add(text)
    }
  }

  addText(form?.title)
  addText(form?.description)
  addText(form?.selfDeclarationText)

  ;(form?.questions || []).forEach((question) => {
    addText(question?.label)
    addText(question?.placeholder)
    ;(question?.options || []).forEach((option) => addText(option))

    if (question?.selectOptionDetails && typeof question.selectOptionDetails === 'object') {
      Object.values(question.selectOptionDetails).forEach((detail) => {
        addText(detail?.text)
      })
    }
  })

  return Array.from(textSet)
}

async function translateNorwegianTextToEnglish(text, signal) {
  const value = String(text || '').trim()
  if (!value) {
    return ''
  }

  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'no',
    tl: 'en',
    dt: 't',
    q: value,
  })

  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
    signal,
  })

  if (!response.ok) {
    throw new Error(`Translate request failed (${response.status})`)
  }

  const payload = await response.json()
  const translated = Array.isArray(payload?.[0])
    ? payload[0].map((part) => String(part?.[0] || '')).join('').trim()
    : ''

  return translated || value
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

function toEditorQuestion(question, index) {
  const normalized = normalizeQuestion(question, index)
  return {
    ...normalized,
    imagePreviewUrl: normalized.imageUrl || '',
    imageFile: null,
    removeImage: false,
    moveTarget: '',
    optionsText:
      normalized.type === 'select'
        ? typeof question?.optionsText === 'string'
          ? question.optionsText
          : normalized.options.join(', ')
        : '',
  }
}

function isSectionQuestion(question) {
  return question?.type === 'section'
}

function normalizeImageZoom(rawZoom) {
  const parsed = Number(rawZoom)
  if (!Number.isFinite(parsed)) {
    return 1
  }

  return Math.min(2.5, Math.max(0.5, Math.round(parsed * 100) / 100))
}

function normalizeQuestion(question, index) {
  const label = String(question?.label || '').trim()
  const fallbackLabel = `Spørsmål ${index + 1}`
  const type = ['text', 'textarea', 'select', 'location', 'number', 'date', 'camera', 'name', 'email', 'section'].includes(question?.type)
    ? question.type
    : 'text'
  const options = type === 'select' ? parseQuestionOptions(question?.options) : []
  const legacySelectDetailEnabled = Boolean(question?.selectDetailEnabled)
  const selectOptionDetails =
    type === 'select'
      ? options.reduce((accumulator, option) => {
          const rawDetail =
            question?.selectOptionDetails && typeof question.selectOptionDetails === 'object'
              ? question.selectOptionDetails[option]
              : null
          const rawKind = rawDetail?.kind || rawDetail?.type || ''
          const kind = ['input', 'message', 'camera'].includes(rawKind)
            ? rawKind
            : legacySelectDetailEnabled
              ? 'input'
              : 'none'

          accumulator[option] = {
            kind,
            text:
              typeof rawDetail?.text === 'string'
                ? rawDetail.text
                : legacySelectDetailEnabled && kind === 'input'
                  ? 'Beskriv nærmere'
                  : '',
            messageColor: typeof rawDetail?.messageColor === 'string' ? rawDetail.messageColor : '',
            messageBold: Boolean(rawDetail?.messageBold),
            historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(rawDetail?.historyCategory)
              ? rawDetail.historyCategory
              : 'normal',
          }

          return accumulator
        }, {})
      : {}

  return {
    id: question?.id ? toQuestionId(question.id) : toQuestionId(label || `q-${index + 1}`),
    label: label || fallbackLabel,
    type,
    required: type === 'section' ? false : Boolean(question?.required),
    placeholder: String(question?.placeholder || ''),
    imageUrl: String(question?.imageUrl || '').trim(),
    imageZoom: normalizeImageZoom(question?.imageZoom),
    includeInAnalysis: type === 'section' ? false : Boolean(question?.includeInAnalysis),
    includeInReview: type === 'section' ? false : Boolean(question?.includeInReview),
    reviewHelpText: type === 'section' ? '' : String(question?.reviewHelpText || '').trim(),
    analysisLabel: type === 'section' ? '' : String(question?.analysisLabel || '').trim(),
    deliveryUnlimited: type === 'select' ? Boolean(question?.deliveryUnlimited) || !question?.deliveryMaxUnits : true,
    deliveryMaxUnits:
      type === 'select' && Number.isFinite(Number(question?.deliveryMaxUnits)) && Number(question?.deliveryMaxUnits) > 0
        ? String(question.deliveryMaxUnits)
        : '',
    helpTextColor: String(question?.helpTextColor || '').trim(),
    helpTextBold: Boolean(question?.helpTextBold),
    visibleForLocations: type === 'location' ? [] : normalizeVisibleForLocations(question?.visibleForLocations),
    selectOptionDetails,
    options,
  }
}

function formatTime(timestamp) {
  if (!timestamp) {
    return '-'
  }
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate().toLocaleString('nb-NO')
  }
  if (timestamp instanceof Date) {
    return timestamp.toLocaleString('nb-NO')
  }
  return '-'
}

function getReceiptEditState(submittedAtIso) {
  const submittedAtMs = submittedAtIso ? Date.parse(submittedAtIso) : Number.NaN
  if (!Number.isFinite(submittedAtMs)) {
    return {
      allowed: false,
      remainingMs: 0,
    }
  }

  const remainingMs = submittedAtMs + RECEIPT_EDIT_WINDOW_MS - Date.now()
  return {
    allowed: remainingMs > 0,
    remainingMs: Math.max(0, remainingMs),
  }
}

function toDateValue(timestamp) {
  if (!timestamp) {
    return null
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : timestamp
  return date instanceof Date ? date : null
}

function getDatePart(timestamp) {
  const date = toDateValue(timestamp)
  if (!date) {
    return '-'
  }
  return date.toLocaleDateString('nb-NO')
}

function getClockPart(timestamp) {
  const date = toDateValue(timestamp)
  if (!date) {
    return '-'
  }
  return date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
}

function getSubmissionDayKey(timestamp) {
  if (!timestamp) {
    return ''
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : timestamp
  if (!(date instanceof Date)) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatSubmissionDayLabel(dayKey) {
  if (!dayKey) {
    return 'Alle dager'
  }

  const [year, month, day] = dayKey.split('-').map((value) => Number(value))
  if (!year || !month || !day) {
    return dayKey
  }

  return new Date(year, month - 1, day).toLocaleDateString('nb-NO')
}

function getSubmissionName(answers, questions = []) {
  const nameQuestion = questions.find((question) => question.type === 'name')
  if (nameQuestion?.id && answers?.[nameQuestion.id] && String(answers[nameQuestion.id]).trim()) {
    return String(answers[nameQuestion.id]).trim()
  }

  const candidates = ['navn', 'name', 'fullName', 'fullname']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return String(answers[key]).trim()
    }
  }
  return '-'
}

function getSubmissionEmail(answers, questions = []) {
  const emailQuestion = questions.find((question) => question.type === 'email')
  if (emailQuestion?.id && answers?.[emailQuestion.id] && String(answers[emailQuestion.id]).trim()) {
    return String(answers[emailQuestion.id]).trim()
  }

  const candidates = ['epost', 'e-post', 'email', 'mail']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return String(answers[key]).trim()
    }
  }
  return ''
}

function getSubmissionPlace(answers) {
  const candidates = ['sted', 'location', 'lokasjon', 'place']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return String(answers[key]).trim()
    }
  }
  return '-'
}

function getSubmissionLocation(answers, questions = []) {
  const locationQuestion = questions.find((question) => question.type === 'location')
  if (locationQuestion?.id && answers?.[locationQuestion.id] && String(answers[locationQuestion.id]).trim()) {
    return String(answers[locationQuestion.id]).trim()
  }

  return getSubmissionPlace(answers)
}

function getSelectedFormLocation(questions = [], answers = {}, locationOtherAnswers = {}) {
  const locationQuestion = questions.find((question) => question.type === 'location')
  if (!locationQuestion?.id) {
    return ''
  }

  const answerValue = answers?.[locationQuestion.id]
  if (answerValue === LOCATION_OTHER_VALUE) {
    return String(locationOtherAnswers?.[locationQuestion.id] || '').trim()
  }

  return String(answerValue || '').trim()
}

function isQuestionVisibleForLocation(question, selectedLocationName) {
  if (!question || question.type === 'location') {
    return true
  }

  const visibleForLocations = normalizeVisibleForLocations(question.visibleForLocations)
  if (visibleForLocations.length === 0) {
    return true
  }

  const normalizedSelectedLocation = String(selectedLocationName || '').trim().toLowerCase()
  if (!normalizedSelectedLocation) {
    return false
  }

  return visibleForLocations.some(
    (locationName) => String(locationName || '').trim().toLowerCase() === normalizedSelectedLocation,
  )
}

function getVisibleFormQuestions(questions = [], selectedLocationName = '') {
  return questions.filter((question, index) => {
    if (isSectionQuestion(question)) {
      for (let nextIndex = index + 1; nextIndex < questions.length; nextIndex += 1) {
        const nextQuestion = questions[nextIndex]
        if (isSectionQuestion(nextQuestion)) {
          break
        }
        if (isQuestionVisibleForLocation(nextQuestion, selectedLocationName)) {
          return true
        }
      }
      return false
    }

    return isQuestionVisibleForLocation(question, selectedLocationName)
  })
}

function isStorageImagePath(value) {
  return typeof value === 'string' && value.startsWith('forms/images/')
}

function getHelpTextStyle(question) {
  if (!isSectionQuestion(question)) {
    return undefined
  }

  const style = {}

  if (question?.helpTextColor) {
    style.color = question.helpTextColor
  }

  if (question?.helpTextBold) {
    style.fontWeight = 700
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function getInputPlaceholder(question, fallback = '') {
  return question?.placeholder ? '' : fallback
}

function lightenHexColor(color, amount = 0.45) {
  const normalized = String(color || '').trim()
  const hexMatch = normalized.match(/^#?([0-9a-f]{6})$/i)
  if (!hexMatch) {
    return ''
  }

  const hex = hexMatch[1]
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
  const lightened = channels.map((channel) =>
    Math.round(channel + (255 - channel) * Math.min(Math.max(amount, 0), 1)),
  )

  return `#${lightened.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function getSelectMessageStyle(behavior) {
  if (behavior?.kind !== 'message') {
    return undefined
  }

  const style = {}

  if (behavior.messageColor) {
    style.color = behavior.messageColor
    style.backgroundColor = lightenHexColor(behavior.messageColor, 0.9)
    style.border = `1px solid ${behavior.messageColor}`
    style.borderRadius = '10px'
    style.padding = '10px 12px'
  }

  if (behavior.messageBold) {
    style.fontWeight = 700
  }

  return Object.keys(style).length > 0 ? style : undefined
}

function getSelectDetailAnswerKey(questionId) {
  return `${questionId}${SELECT_DETAIL_SUFFIX}`
}

function getSelectOptionBehavior(question, selectedOption) {
  if (!selectedOption || question?.type !== 'select') {
    return { kind: 'none', text: '' }
  }

  const detail =
    question?.selectOptionDetails && typeof question.selectOptionDetails === 'object'
      ? question.selectOptionDetails[selectedOption]
      : null

  const kind = ['input', 'message', 'camera'].includes(detail?.kind) ? detail.kind : 'none'
  return {
    kind,
    text: typeof detail?.text === 'string' ? detail.text : '',
    messageColor: typeof detail?.messageColor === 'string' ? detail.messageColor : '',
    messageBold: Boolean(detail?.messageBold),
    historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(detail?.historyCategory)
      ? detail.historyCategory
      : 'normal',
  }
}

function getHistoryCellCategory(question, submission) {
  if (question?.type !== 'select') {
    return ''
  }

  if (hasAnalysisRefillAction(submission, question?.id)) {
    return ''
  }

  const selectedValue = String(submission?.answers?.[question.id] || '').trim()
  if (!selectedValue) {
    return ''
  }

  const historyCategory = getSelectOptionBehavior(question, selectedValue).historyCategory
  return historyCategory === 'orange' || historyCategory === 'red' ? historyCategory : ''
}

function getDeliveryMaxUnits(question) {
  const parsed = Number.parseInt(question?.deliveryMaxUnits, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function getFirstNormalOption(question) {
  if (question?.type !== 'select') {
    return null
  }

  const options = Array.isArray(question.options) ? question.options : []
  const firstNormalIndex = options.findIndex(
    (option) => getSelectOptionBehavior(question, option).historyCategory === 'normal',
  )

  if (firstNormalIndex === -1) {
    return null
  }

  return {
    index: firstNormalIndex,
    value: options[firstNormalIndex],
  }
}

function getLocationQuestionDeliverySetting(location, formSlug, question) {
  const options = Array.isArray(question?.options) ? question.options : []
  const locationSettings =
    location?.formSettings &&
    typeof location.formSettings === 'object' &&
    location.formSettings[formSlug] &&
    typeof location.formSettings[formSlug] === 'object'
      ? location.formSettings[formSlug]
      : null
  const savedSetting =
    locationSettings &&
    question?.id &&
    locationSettings[question.id] &&
    typeof locationSettings[question.id] === 'object'
      ? locationSettings[question.id]
      : null
  const fallbackTarget = getFirstNormalOption(question)?.value || ''
  const savedTargetValue =
    savedSetting && typeof savedSetting.targetValue === 'string' && savedSetting.targetValue.trim()
      ? savedSetting.targetValue
      : ''
  const fallbackMaxUnits = getDeliveryMaxUnits(question)

  return {
    targetValue: options.includes(savedTargetValue) ? savedTargetValue : fallbackTarget,
    deliveryUnlimited:
      savedSetting && typeof savedSetting.deliveryUnlimited === 'boolean'
        ? savedSetting.deliveryUnlimited
        : Boolean(question?.deliveryUnlimited) || !fallbackMaxUnits,
    deliveryMaxUnits:
      savedSetting && Number.isFinite(Number(savedSetting.deliveryMaxUnits)) && Number(savedSetting.deliveryMaxUnits) > 0
        ? String(savedSetting.deliveryMaxUnits)
        : fallbackMaxUnits
          ? String(fallbackMaxUnits)
          : '',
  }
}

function getLocationDeliverySetting(locationName, locations = [], formSlug, question) {
  const normalizedName = String(locationName || '').trim()
  if (!normalizedName || !question?.id) {
    return getLocationQuestionDeliverySetting(null, formSlug, question)
  }

  const matchingLocation = locations.find(
    (location) => String(location.name || '').trim() === normalizedName,
  )

  return getLocationQuestionDeliverySetting(matchingLocation, formSlug, question)
}

function getAnalysisAction(submission, questionId) {
  if (!submission || !questionId) {
    return null
  }

  const actions =
    submission.analysisActions && typeof submission.analysisActions === 'object'
      ? submission.analysisActions
      : null
  const action =
    actions && actions[questionId] && typeof actions[questionId] === 'object'
      ? actions[questionId]
      : null

  if (!action) {
    return null
  }

  const actionType = String(action.type || '').trim().toLowerCase()
  return actionType === 'refill' || actionType === 'ordered' ? action : null
}

function hasAnalysisRefillAction(submission, questionId) {
  return Boolean(getAnalysisAction(submission, questionId))
}

function getDeliveryRecommendation(question, submission, locationSetting = null) {
  if (question?.type !== 'select' || !submission || hasAnalysisRefillAction(submission, question.id)) {
    return null
  }

  const currentValue = String(submission.answers?.[question.id] || '').trim()
  if (!currentValue) {
    return null
  }

  const currentCategory = getSelectOptionBehavior(question, currentValue).historyCategory
  if (currentCategory !== 'orange' && currentCategory !== 'red') {
    return null
  }

  const options = Array.isArray(question.options) ? question.options : []
  const currentIndex = options.findIndex((option) => option === currentValue)
  const fallbackTarget = getFirstNormalOption(question)
  const targetValue = String(locationSetting?.targetValue || fallbackTarget?.value || '').trim()
  const targetIndex = options.findIndex((option) => option === targetValue)

  if (currentIndex === -1 || targetIndex === -1 || currentIndex >= targetIndex) {
    return null
  }

  const maxUnits = getDeliveryMaxUnits(locationSetting || question)
  const unlimited =
    typeof locationSetting?.deliveryUnlimited === 'boolean'
      ? locationSetting.deliveryUnlimited || !maxUnits
      : Boolean(question?.deliveryUnlimited) || !maxUnits
  let recommendedUnits = null

  if (!unlimited && options.length > 1) {
    const currentUnits = Math.floor((currentIndex * maxUnits) / (options.length - 1))
    const targetUnits = Math.ceil((targetIndex * maxUnits) / (options.length - 1))
    recommendedUnits = Math.max(0, targetUnits - currentUnits)
  }

  return {
    questionId: question.id,
    label: question.analysisLabel || question.label,
    currentValue,
    currentCategory,
    targetValue,
    maxUnits,
    unlimited,
    recommendedUnits,
    isOrdered: hasAnalysisRefillAction(submission, question.id),
    sourceEntries: [{ submissionId: submission.id, questionId: question.id }],
  }
}

function getLocationCity(locationName, locations = []) {
  const normalizedName = String(locationName || '').trim()
  if (!normalizedName) {
    return 'Ukjent by'
  }

  const matchingLocation = locations.find(
    (location) => String(location.name || '').trim() === normalizedName,
  )
  const city = String(matchingLocation?.city || matchingLocation?.address || '').trim()

  return city || 'Ukjent by'
}

function sortDeliveryCards(cards = []) {
  return [...cards].sort((a, b) => {
    const aCriticalUnits = a.products.reduce(
      (sum, product) =>
        sum +
        (product.currentCategory === 'red' && typeof product.recommendedUnits === 'number'
          ? product.recommendedUnits
          : 0),
      0,
    )
    const bCriticalUnits = b.products.reduce(
      (sum, product) =>
        sum +
        (product.currentCategory === 'red' && typeof product.recommendedUnits === 'number'
          ? product.recommendedUnits
          : 0),
      0,
    )

    if (bCriticalUnits !== aCriticalUnits) {
      return bCriticalUnits - aCriticalUnits
    }

    if (b.knownTotalUnits !== a.knownTotalUnits) {
      return b.knownTotalUnits - a.knownTotalUnits
    }

    const aCriticalCount = a.products.filter((product) => product.currentCategory === 'red').length
    const bCriticalCount = b.products.filter((product) => product.currentCategory === 'red').length
    if (bCriticalCount !== aCriticalCount) {
      return bCriticalCount - aCriticalCount
    }

    return String(a.location || '').localeCompare(String(b.location || ''), 'nb')
  })
}

function sortDeliveryLocationEntries(entries = []) {
  return [...entries].sort((a, b) => {
    if (a.currentCategory !== b.currentCategory) {
      return a.currentCategory === 'red' ? -1 : 1
    }

    const aUnits = typeof a.recommendedUnits === 'number' ? a.recommendedUnits : -1
    const bUnits = typeof b.recommendedUnits === 'number' ? b.recommendedUnits : -1
    if (bUnits !== aUnits) {
      return bUnits - aUnits
    }

    return String(a.location || '').localeCompare(String(b.location || ''), 'nb')
  })
}

function formatDeliveryPurchaseLabel(item) {
  const hasKnownUnits = typeof item?.recommendedUnits === 'number'

  if (item?.unlimited) {
    if (hasKnownUnits && item.recommendedUnits > 0) {
      return `Minst ${item.recommendedUnits} stk`
    }
    return 'Sett maks antall for å få beregning'
  }

  return `${hasKnownUnits ? item.recommendedUnits : 0} stk`
}

function getSubmissionStatusLabel(status) {
  switch (String(status || '').trim()) {
    case 'reviewed':
      return 'Reviewed'
    case 'awaiting review':
      return 'Awaiting review'
    default:
      return status ? String(status) : 'Awaiting review'
  }
}

function getFlaggedStatusLabel(status) {
  return String(status || '').trim().toLowerCase() === 'complete' ? 'Complete' : 'Open'
}

function getHistoryAnswerValues(submission, question) {
  const mainValue = submission.answers?.[question.id]
  const detailValue = submission.answers?.[getSelectDetailAnswerKey(question.id)]

  return [mainValue, detailValue]
    .filter((value) => String(value || '').trim())
    .map((value) => (isStorageImagePath(value) ? 'Bilde vedlagt' : String(value || '-')))
}

function getAnswerDisplayLabel(answerKey, answers, questions = []) {
  const detailQuestionId = answerKey.endsWith(SELECT_DETAIL_SUFFIX)
    ? answerKey.slice(0, -SELECT_DETAIL_SUFFIX.length)
    : ''

  if (detailQuestionId) {
    const question = questions.find((item) => item.id === detailQuestionId)
    const selectedOption = answers?.[detailQuestionId]
    return question
      ? `${question.label} - utdyping${selectedOption ? ` (${selectedOption})` : ''}`
      : answerKey
  }

  const question = questions.find((item) => item.id === answerKey)
  return question?.label || answerKey
}

function getQuestionForAnswerKey(answerKey, questions = []) {
  const detailQuestionId = answerKey.endsWith(SELECT_DETAIL_SUFFIX)
    ? answerKey.slice(0, -SELECT_DETAIL_SUFFIX.length)
    : answerKey

  return questions.find((item) => item.id === detailQuestionId) || null
}

function getOrderedAnswerEntries(answers, questions = [], options = {}) {
  const includeRemainingAnswers = options.includeRemainingAnswers !== false
  const usedKeys = new Set()
  const entries = []

  questions.forEach((question) => {
    if (isSectionQuestion(question)) {
      return
    }

    const answerValue = answers?.[question.id]
    if (typeof answerValue !== 'undefined' && String(answerValue || '').trim()) {
      entries.push([question.id, answerValue])
      usedKeys.add(question.id)
    }

    const detailKey = getSelectDetailAnswerKey(question.id)
    const detailValue = answers?.[detailKey]
    if (typeof detailValue !== 'undefined' && String(detailValue || '').trim()) {
      entries.push([detailKey, detailValue])
      usedKeys.add(detailKey)
    }
  })

  if (includeRemainingAnswers) {
    Object.entries(answers || {}).forEach(([key, value]) => {
      if (usedKeys.has(key)) {
        return
      }
      if (!String(value || '').trim()) {
        return
      }
      entries.push([key, value])
    })
  }

  return entries
}

function getReviewDisplayValue(answerKey, value, question, translate) {
  if (isStorageImagePath(value)) {
    return ''
  }

  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) {
    return '-'
  }

  if (!question || answerKey.endsWith(SELECT_DETAIL_SUFFIX)) {
    return normalizedValue
  }

  if (question.type === 'select') {
    return translate(normalizedValue)
  }

  return normalizedValue
}

function createEditorQuestion(seed) {
  return {
    id: toQuestionId(seed),
    label: 'Nytt spørsmål',
    type: 'text',
    required: false,
    placeholder: '',
    imageUrl: '',
    imageZoom: 1,
    includeInAnalysis: false,
    includeInReview: false,
    reviewHelpText: '',
    analysisLabel: '',
    deliveryUnlimited: true,
    deliveryMaxUnits: '',
    helpTextColor: '',
    helpTextBold: false,
    visibleForLocations: [],
    selectOptionDetails: {},
    imagePreviewUrl: '',
    imageFile: null,
    removeImage: false,
    moveTarget: '',
    options: [],
    optionsText: '',
  }
}

function getTodayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function getFormDraftStorageKey(formSlug) {
  return `${FORM_DRAFT_STORAGE_PREFIX}${formSlug}`
}

function readFormDraft(formSlug) {
  if (typeof window === 'undefined') {
    return {
      answers: {},
      locationOtherAnswers: {},
      selectDetailAnswers: {},
      selfDeclarationAccepted: false,
    }
  }

  try {
    const stored = window.localStorage.getItem(getFormDraftStorageKey(formSlug))
    if (!stored) {
      return {
        answers: {},
        locationOtherAnswers: {},
        selectDetailAnswers: {},
        selfDeclarationAccepted: false,
      }
    }

    const parsed = JSON.parse(stored)
    return {
      answers: parsed?.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
      locationOtherAnswers:
        parsed?.locationOtherAnswers && typeof parsed.locationOtherAnswers === 'object'
          ? parsed.locationOtherAnswers
          : {},
      selectDetailAnswers:
        parsed?.selectDetailAnswers && typeof parsed.selectDetailAnswers === 'object'
          ? parsed.selectDetailAnswers
          : {},
      selfDeclarationAccepted: Boolean(parsed?.selfDeclarationAccepted),
    }
  } catch {
    return {
      answers: {},
      locationOtherAnswers: {},
      selectDetailAnswers: {},
      selfDeclarationAccepted: false,
    }
  }
}

function writeFormDraft(formSlug, draft) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(getFormDraftStorageKey(formSlug), JSON.stringify(draft))
  } catch {}
}

function clearFormDraft(formSlug) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.removeItem(getFormDraftStorageKey(formSlug))
  } catch {}
}

function toSortOrder(item) {
  if (typeof item?.order === 'number' && Number.isFinite(item.order)) {
    return item.order
  }
  if (typeof item?.order === 'string' && item.order.trim()) {
    const parsed = Number(item.order)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return Number.POSITIVE_INFINITY
}

function getFormSaveErrorMessage(error) {
  const code = error?.code || ''
  if (code === 'storage/unauthorized') {
    return 'Kunne ikke laste opp spørsmålsbildet. Mangler tilgang i Firebase Storage-regler.'
  }
  if (code === 'storage/canceled') {
    return 'Bildeopplastingen ble avbrutt.'
  }
  if (code === 'storage/unknown') {
    return 'Ukjent Storage-feil ved opplasting av spørsmålsbildet.'
  }
  if (code === 'permission-denied') {
    return 'Kunne ikke lagre skjema. Mangler tilgang i Firestore-regler.'
  }
  return code ? `Kunne ikke lagre skjema (${code}).` : 'Kunne ikke lagre skjema. Prøv igjen.'
}

function getSubmitErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'permission-denied') {
    return 'Kunne ikke sende inn skjemaet. Mangler tilgang i Firestore-regler.'
  }

  if (code === 'storage/unauthorized') {
    return 'Kunne ikke laste opp bilde. Mangler tilgang i Firebase Storage-regler.'
  }

  return code ? `Noe gikk galt ved innsending (${code}). Prøv igjen.` : 'Noe gikk galt ved innsending. Prøv igjen.'
}

function getLocationsLoadErrorMessage(error) {
  const code = error?.code || ''

  if (code === 'permission-denied') {
    return 'Kunne ikke hente lokasjoner. Sjekk Firestore-regler eller admin-tilgang.'
  }

  if (code === 'unauthenticated') {
    return 'Du må være logget inn som admin for å hente lokasjoner her.'
  }

  return code ? `Kunne ikke hente lokasjoner (${code}).` : 'Kunne ikke hente lokasjoner akkurat nå.'
}

function FormPage() {
  const { formSlug = STENGESKJEMA_ID, receiptToken = '', submissionId = '' } = useParams()
  const location = useLocation()
  const editReceiptToken = useMemo(
    () => new URLSearchParams(location.search).get('editReceipt')?.trim() || '',
    [location.search],
  )
  const activeFormSlug = String(formSlug || STENGESKJEMA_ID).trim().toLowerCase()
  const isDefaultForm = activeFormSlug === STENGESKJEMA_ID
  const isSubmissionsView = location.pathname.endsWith('/submissions')
  const isReviewView = location.pathname.includes('/review/')
  const isFlaggedView = location.pathname.endsWith('/flagget')
  const isDeliverySettingsView = location.pathname.endsWith('/leveringsliste/innstillinger')
  const isDeliveryView = location.pathname.endsWith('/leveringsliste')
  const isHistoryView =
    location.pathname.endsWith('/analyse') || location.pathname.endsWith('/historikk')
  const isEditPage = location.pathname.endsWith('/edit')
  const isReceiptPage = location.pathname.includes('/kvittering/')
  const isStandalonePublicForm =
    !isSubmissionsView &&
    !isEditPage &&
    !isHistoryView &&
    !isFlaggedView &&
    !isReviewView &&
    !isDeliverySettingsView &&
    !isDeliveryView
  const isSubmissionEditMode = !isReceiptPage && Boolean(editReceiptToken) && isStandalonePublicForm
  const activeReceiptLookupToken = isReceiptPage ? receiptToken : editReceiptToken

  const [formData, setFormData] = useState(defaultStengeskjema)
  const [formDocId, setFormDocId] = useState(STENGESKJEMA_ID)
  const [answers, setAnswers] = useState({})
  const [locationOtherAnswers, setLocationOtherAnswers] = useState({})
  const [selectDetailAnswers, setSelectDetailAnswers] = useState({})
  const [selectDetailFiles, setSelectDetailFiles] = useState({})
  const [selectDetailPreviews, setSelectDetailPreviews] = useState({})
  const [selfDeclarationAccepted, setSelfDeclarationAccepted] = useState(false)
  const [cameraFiles, setCameraFiles] = useState({})
  const [cameraPreviews, setCameraPreviews] = useState({})
  const [formInstanceKey, setFormInstanceKey] = useState(0)
  const [loadingForm, setLoadingForm] = useState(true)
  const [availableLocations, setAvailableLocations] = useState([])
  const [loadingLocations, setLoadingLocations] = useState(true)
  const [availableLocationsError, setAvailableLocationsError] = useState('')
  const [draftReady, setDraftReady] = useState(false)
  const [submitState, setSubmitState] = useState({ submitting: false, message: '', error: '' })
  const [submitOverlay, setSubmitOverlay] = useState({ open: false, status: 'idle' })
  const [displayLanguage, setDisplayLanguage] = useState(readPreferredPublicFormLanguage)
  const [englishTranslations, setEnglishTranslations] = useState(readEnglishTranslationCache)
  const [translationState, setTranslationState] = useState({ loading: false, error: '' })

  const [editorTitle, setEditorTitle] = useState(defaultStengeskjema.title)
  const [editorDescription, setEditorDescription] = useState(defaultStengeskjema.description)
  const [editorIncludeSubmissionDateTime, setEditorIncludeSubmissionDateTime] = useState(
    Boolean(defaultStengeskjema.includeSubmissionDateTime),
  )
  const [editorEnableSelfDeclaration, setEditorEnableSelfDeclaration] = useState(
    Boolean(defaultStengeskjema.enableSelfDeclaration),
  )
  const [editorSelfDeclarationText, setEditorSelfDeclarationText] = useState(
    defaultStengeskjema.selfDeclarationText || '',
  )
  const [editorQuestions, setEditorQuestions] = useState(
    defaultStengeskjema.questions.map((item, index) => toEditorQuestion(item, index)),
  )
  const [saveState, setSaveState] = useState({ saving: false, message: '', error: '' })
  const [deliverySettingsState, setDeliverySettingsState] = useState({
    saving: false,
    message: '',
    error: '',
  })

  const [submissions, setSubmissions] = useState([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [statusUpdateState, setStatusUpdateState] = useState({})
  const [deleteSubmissionState, setDeleteSubmissionState] = useState({})
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('')
  const [selectedSubmissionImageUrls, setSelectedSubmissionImageUrls] = useState({})
  const [selectedSubmissionImagesLoading, setSelectedSubmissionImagesLoading] = useState(false)
  const [selectedSubmissionDay, setSelectedSubmissionDay] = useState('')
  const [reviewDraftStatuses, setReviewDraftStatuses] = useState({})
  const [reviewDraftComments, setReviewDraftComments] = useState({})
  const [reviewSubmissionState, setReviewSubmissionState] = useState({ saving: false, error: '' })
  const [historySubmissionLimit, setHistorySubmissionLimit] = useState('3')
  const [historyDefaultState, setHistoryDefaultState] = useState({
    saving: false,
    error: '',
    message: '',
  })
  const [historyQuestionFilterOpen, setHistoryQuestionFilterOpen] = useState(false)
  const [historyShowAllQuestions, setHistoryShowAllQuestions] = useState(true)
  const [selectedHistoryQuestionIds, setSelectedHistoryQuestionIds] = useState([])
  const [historyLocationFilterOpen, setHistoryLocationFilterOpen] = useState(false)
  const [historyShowAllLocations, setHistoryShowAllLocations] = useState(true)
  const [selectedHistoryLocations, setSelectedHistoryLocations] = useState([])
  const [receiptSubmission, setReceiptSubmission] = useState(null)
  const [loadingReceipt, setLoadingReceipt] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [receiptImageUrls, setReceiptImageUrls] = useState({})
  const [flaggedImageUrls, setFlaggedImageUrls] = useState({})
  const [flaggedReviewOpenId, setFlaggedReviewOpenId] = useState('')
  const [flaggedActionDrafts, setFlaggedActionDrafts] = useState({})
  const [flaggedActionState, setFlaggedActionState] = useState({})
  const [flaggedCollapsedIds, setFlaggedCollapsedIds] = useState({})
  const [analysisActionState, setAnalysisActionState] = useState({})
  const [deliveryGroupByNeighborhood, setDeliveryGroupByNeighborhood] = useState(false)
  const [deliveryGroupByProductPerCity, setDeliveryGroupByProductPerCity] = useState(false)
  const [editorLocationSettings, setEditorLocationSettings] = useState({})
  const [hydratedEditReceiptToken, setHydratedEditReceiptToken] = useState('')

  const { user, isAdmin, loading, error } = useAdminSession()
  const shouldTranslateToEnglish = displayLanguage === 'en' || isReviewView
  const publicCopy = shouldTranslateToEnglish ? PUBLIC_FORM_COPY.en : PUBLIC_FORM_COPY.no

  function translateText(value) {
    const text = String(value || '')
    if (!text) {
      return ''
    }

    if (!shouldTranslateToEnglish) {
      return text
    }

    return englishTranslations[text] || englishTranslations[text.trim()] || text
  }

  function getLocalizedInputPlaceholder(question, fallback = '') {
    if (question?.placeholder) {
      return translateText(question.placeholder)
    }

    return fallback
  }

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const viewportMeta = document.querySelector('meta[name="viewport"]')
    if (!viewportMeta) {
      return
    }

    const originalContent = viewportMeta.getAttribute('content') || ''

    if (isStandalonePublicForm) {
      viewportMeta.setAttribute(
        'content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
      )
    } else {
      viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0')
    }

    return () => {
      viewportMeta.setAttribute('content', originalContent || 'width=device-width, initial-scale=1.0')
    }
  }, [isStandalonePublicForm])

  useEffect(() => {
    if (!isStandalonePublicForm) {
      return
    }

    writePreferredPublicFormLanguage(displayLanguage)
  }, [displayLanguage, isStandalonePublicForm])

  useEffect(() => {
    let cancelled = false

    async function loadForm() {
      setLoadingForm(true)
      try {
        const formsQuery = query(collection(db, 'forms'), where('slug', '==', activeFormSlug))
        const querySnapshot = await getDocs(formsQuery)

        const matching = querySnapshot.docs[0]
        const merged = matching
          ? {
              ...(isDefaultForm ? defaultStengeskjema : {}),
              ...matching.data(),
              id: matching.id,
              slug: activeFormSlug,
            }
          : isDefaultForm
            ? defaultStengeskjema
            : {
                id: activeFormSlug,
                slug: activeFormSlug,
                title: activeFormSlug,
                description: 'Skjemaet ble ikke funnet.',
                questions: [],
              }

        const normalizedQuestions = (merged.questions || []).map((item, index) =>
          normalizeQuestion(item, index),
        )

        if (!cancelled) {
          const normalized = {
            ...merged,
            includeSubmissionDateTime: Boolean(merged.includeSubmissionDateTime),
            enableSelfDeclaration: Boolean(merged.enableSelfDeclaration),
            selfDeclarationText: String(merged.selfDeclarationText || ''),
            questions: normalizedQuestions,
          }

          setFormData(normalized)
          setFormDocId(matching?.id || activeFormSlug)
          setEditorTitle(normalized.title || defaultStengeskjema.title)
          setEditorDescription(normalized.description || defaultStengeskjema.description)
          setEditorIncludeSubmissionDateTime(Boolean(normalized.includeSubmissionDateTime))
          setEditorEnableSelfDeclaration(Boolean(normalized.enableSelfDeclaration))
          setEditorSelfDeclarationText(String(normalized.selfDeclarationText || ''))
          setEditorQuestions((merged.questions || []).map((item, index) => toEditorQuestion(item, index)))
        }
      } finally {
        if (!cancelled) {
          setLoadingForm(false)
        }
      }
    }

    loadForm()

    return () => {
      cancelled = true
    }
  }, [activeFormSlug, isDefaultForm])

  useEffect(() => {
    if (submitState.submitting) {
      setSubmitOverlay({ open: true, status: 'submitting' })
      return
    }

    if (submitState.message) {
      setSubmitOverlay({ open: true, status: 'success' })
      const timeoutId = window.setTimeout(() => {
        setSubmitOverlay({ open: false, status: 'idle' })
      }, 1800)

      return () => {
        window.clearTimeout(timeoutId)
      }
    }

    if (submitState.error) {
      setSubmitOverlay({ open: false, status: 'idle' })
    }
  }, [submitState.error, submitState.message, submitState.submitting])

  useEffect(() => {
    if ((!isStandalonePublicForm && !isReviewView) || loadingForm || !shouldTranslateToEnglish) {
      setTranslationState({ loading: false, error: '' })
      return
    }

    const missingTexts = collectFormTranslationTexts(formData).filter(
      (text) => !String(englishTranslations[text] || '').trim(),
    )

    if (missingTexts.length === 0) {
      setTranslationState({ loading: false, error: '' })
      return
    }

    let cancelled = false
    const controller = typeof AbortController === 'function' ? new AbortController() : null

    setTranslationState({ loading: true, error: '' })

    async function loadTranslations() {
      const nextTranslations = { ...englishTranslations }
      let hadError = false

      for (const text of missingTexts) {
        try {
          nextTranslations[text] = await translateNorwegianTextToEnglish(text, controller?.signal)
        } catch (error) {
          if (error?.name === 'AbortError') {
            return
          }
          hadError = true
          nextTranslations[text] = text
        }
      }

      if (cancelled) {
        return
      }

      setEnglishTranslations(nextTranslations)
      writeEnglishTranslationCache(nextTranslations)
      setTranslationState({
        loading: false,
        error: hadError ? publicCopy.translationError : '',
      })
    }

    loadTranslations()

    return () => {
      cancelled = true
      controller?.abort()
    }
  }, [
    englishTranslations,
    formData,
    isReviewView,
    isStandalonePublicForm,
    loadingForm,
    publicCopy.translationError,
    shouldTranslateToEnglish,
  ])

  useEffect(() => {
    if (!isSubmissionEditMode) {
      setHydratedEditReceiptToken('')
    }
  }, [isSubmissionEditMode, editReceiptToken])

  useEffect(() => {
    if (loadingForm) {
      setDraftReady(false)
      return
    }

    if (isReceiptPage) {
      setDraftReady(true)
      return
    }

    if (isSubmissionEditMode) {
      if (!receiptSubmission || hydratedEditReceiptToken === editReceiptToken) {
        setDraftReady(Boolean(receiptSubmission))
        return
      }

      const receiptAnswers = receiptSubmission.answers || {}
      const nextAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question)) {
          return accumulator
        }

        const storedValue = receiptAnswers[question.id]
        const normalizedValue = typeof storedValue !== 'undefined' ? String(storedValue || '') : ''

        if (question.type === 'location') {
          const matchesSavedLocation = availableLocations.some(
            (location) => String(location.name || '').trim() === normalizedValue,
          )
          accumulator[question.id] = matchesSavedLocation ? normalizedValue : normalizedValue ? LOCATION_OTHER_VALUE : ''
          return accumulator
        }

        accumulator[question.id] = normalizedValue
        return accumulator
      }, {})

      const nextLocationOtherAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'location') {
          return accumulator
        }

        const storedValue = String(receiptAnswers[question.id] || '').trim()
        if (!storedValue) {
          return accumulator
        }

        const matchesSavedLocation = availableLocations.some(
          (location) => String(location.name || '').trim() === storedValue,
        )
        if (!matchesSavedLocation) {
          accumulator[question.id] = storedValue
        }

        return accumulator
      }, {})

      const nextSelectDetailAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'select') {
          return accumulator
        }

        const detailKey = getSelectDetailAnswerKey(question.id)
        const storedValue = receiptAnswers[detailKey]
        if (typeof storedValue !== 'undefined') {
          accumulator[question.id] = String(storedValue || '')
        }
        return accumulator
      }, {})

      const nextSelectDetailPreviews = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'select') {
          return accumulator
        }

        const detailValue = String(receiptAnswers[getSelectDetailAnswerKey(question.id)] || '').trim()
        if (isStorageImagePath(detailValue)) {
          const previewUrl = receiptSubmission.imageUrls?.[detailValue] || receiptImageUrls[detailValue] || ''
          if (previewUrl) {
            accumulator[question.id] = previewUrl
          }
        }
        return accumulator
      }, {})

      const nextCameraPreviews = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question) || question.type !== 'camera') {
          return accumulator
        }

        const storedValue = String(receiptAnswers[question.id] || '').trim()
        if (isStorageImagePath(storedValue)) {
          const previewUrl = receiptSubmission.imageUrls?.[storedValue] || receiptImageUrls[storedValue] || ''
          if (previewUrl) {
            accumulator[question.id] = previewUrl
          }
        }
        return accumulator
      }, {})

      setAnswers(nextAnswers)
      setLocationOtherAnswers(nextLocationOtherAnswers)
      setSelectDetailAnswers(nextSelectDetailAnswers)
      setSelectDetailFiles({})
      setSelectDetailPreviews(nextSelectDetailPreviews)
      setCameraFiles({})
      setCameraPreviews(nextCameraPreviews)
      setSelfDeclarationAccepted(Boolean(receiptAnswers[SELF_DECLARATION_ACCEPTED_KEY]))
      setHydratedEditReceiptToken(editReceiptToken)
      setDraftReady(true)
      return
    }

    const draft = readFormDraft(activeFormSlug)
    const nextAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question)) {
        return accumulator
      }
      const storedValue = draft.answers?.[question.id]
      accumulator[question.id] =
        typeof storedValue !== 'undefined'
          ? String(storedValue)
          : question.type === 'date'
            ? getTodayInputValue()
            : ''
      return accumulator
    }, {})

    const nextLocationOtherAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question) || question.type !== 'location') {
        return accumulator
      }
      const storedValue = draft.locationOtherAnswers?.[question.id]
      if (typeof storedValue !== 'undefined') {
        accumulator[question.id] = String(storedValue)
      }
      return accumulator
    }, {})

    const nextSelectDetailAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question) || question.type !== 'select') {
        return accumulator
      }
      const storedValue = draft.selectDetailAnswers?.[question.id]
      if (typeof storedValue !== 'undefined') {
        accumulator[question.id] = String(storedValue)
      }
      return accumulator
    }, {})

    setAnswers(nextAnswers)
    setLocationOtherAnswers(nextLocationOtherAnswers)
    setSelectDetailAnswers(nextSelectDetailAnswers)
    setSelfDeclarationAccepted(
      Boolean(formData.enableSelfDeclaration) && Boolean(draft.selfDeclarationAccepted),
    )
    setDraftReady(true)
  }, [
    activeFormSlug,
    availableLocations,
    editReceiptToken,
    formData.enableSelfDeclaration,
    formData.questions,
    hydratedEditReceiptToken,
    isReceiptPage,
    isSubmissionEditMode,
    loadingForm,
    receiptImageUrls,
    receiptSubmission,
  ])

  useEffect(() => {
    if (
      loadingForm ||
      !draftReady ||
      isSubmissionEditMode ||
      isEditPage ||
      isSubmissionsView ||
      isReceiptPage ||
      isHistoryView ||
      isDeliverySettingsView ||
      isDeliveryView ||
      isFlaggedView ||
      isReviewView
    ) {
      return
    }

    const normalizedAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question)) {
        return accumulator
      }
      accumulator[question.id] =
        typeof answers[question.id] !== 'undefined'
          ? String(answers[question.id] || '')
          : question.type === 'date'
            ? getTodayInputValue()
            : ''
      return accumulator
    }, {})

    const normalizedLocationOtherAnswers = formData.questions.reduce((accumulator, question) => {
      if (!isSectionQuestion(question) && question.type === 'location' && typeof locationOtherAnswers[question.id] !== 'undefined') {
        accumulator[question.id] = String(locationOtherAnswers[question.id] || '')
      }
      return accumulator
    }, {})

    const normalizedSelectDetailAnswers = formData.questions.reduce((accumulator, question) => {
      if (
        !isSectionQuestion(question) &&
        question.type === 'select' &&
        typeof selectDetailAnswers[question.id] !== 'undefined'
      ) {
        accumulator[question.id] = String(selectDetailAnswers[question.id] || '')
      }
      return accumulator
    }, {})

    writeFormDraft(activeFormSlug, {
      answers: normalizedAnswers,
      locationOtherAnswers: normalizedLocationOtherAnswers,
      selectDetailAnswers: normalizedSelectDetailAnswers,
      selfDeclarationAccepted,
    })
  }, [
    activeFormSlug,
    answers,
    draftReady,
    formData.questions,
    isDeliverySettingsView,
    isSubmissionEditMode,
    isDeliveryView,
    isEditPage,
    isFlaggedView,
    isHistoryView,
    isReceiptPage,
    isReviewView,
    isSubmissionsView,
    loadingForm,
    locationOtherAnswers,
    selectDetailAnswers,
    selfDeclarationAccepted,
  ])

  useEffect(() => {
    setLoadingLocations(true)
    setAvailableLocationsError('')

    const unsubscribe = onSnapshot(
      query(collection(db, 'locations')),
      (snapshot) => {
        const rows = snapshot.docs
          .map((locationDoc) => ({
            id: locationDoc.id,
            ...locationDoc.data(),
          }))
          .sort((a, b) => {
            const orderDiff = toSortOrder(a) - toSortOrder(b)
            if (orderDiff !== 0) {
              return orderDiff
            }
            return String(a.name || '').localeCompare(String(b.name || ''), 'nb')
          })

        setAvailableLocations(rows)
        setAvailableLocationsError('')
        setLoadingLocations(false)
      },
      (error) => {
        setAvailableLocations([])
        setAvailableLocationsError(getLocationsLoadErrorMessage(error))
        setLoadingLocations(false)
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    if (availableLocations.length === 0 || editorQuestions.length === 0) {
      return
    }

    setEditorLocationSettings((previous) => {
      const next = {}

      availableLocations.forEach((location) => {
        next[location.id] = {}

        editorQuestions.forEach((question) => {
          if (question.type !== 'select') {
            return
          }

          const existingSetting =
            previous[location.id] && previous[location.id][question.id]
              ? previous[location.id][question.id]
              : null

          next[location.id][question.id] =
            existingSetting || getLocationQuestionDeliverySetting(location, activeFormSlug, question)
        })
      })

      return next
    })
  }, [activeFormSlug, availableLocations, editorQuestions])

  useEffect(() => {
    if (!isAdmin) {
      setSubmissions([])
      return
    }

    let cancelled = false

    async function loadSubmissions() {
      setLoadingSubmissions(true)

      try {
        const submissionsQuery = query(
          collection(db, 'formSubmissions'),
          where('formSlug', '==', activeFormSlug),
        )
        const snapshot = await getDocs(submissionsQuery)

        const rows = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => {
            const aSeconds = a.submittedAt?.seconds || 0
            const bSeconds = b.submittedAt?.seconds || 0
            return bSeconds - aSeconds
          })

        if (cancelled) {
          return
        }

        setSubmissions(rows)
      } finally {
        if (!cancelled) {
          setLoadingSubmissions(false)
        }
      }
    }

    loadSubmissions()

    return () => {
      cancelled = true
    }
  }, [activeFormSlug, isAdmin])

  useEffect(() => {
    if (!activeReceiptLookupToken) {
      setReceiptSubmission(null)
      setReceiptError('')
      setLoadingReceipt(false)
      return
    }

    let cancelled = false

    async function loadReceipt() {
      setLoadingReceipt(true)
      setReceiptError('')

      try {
        const snapshot = await getDoc(doc(db, 'formSubmissionReceipts', activeReceiptLookupToken))

        if (!snapshot.exists()) {
          if (!cancelled) {
            setReceiptSubmission(null)
            setReceiptError('Fant ikke kvitteringen.')
          }
          return
        }

        const data = snapshot.data()
        if (String(data?.formSlug || '').trim().toLowerCase() !== activeFormSlug) {
          if (!cancelled) {
            setReceiptSubmission(null)
            setReceiptError('Kvitteringen tilhører et annet skjema.')
          }
          return
        }

        if (!cancelled) {
          setReceiptSubmission({ id: snapshot.id, ...data })
        }
      } catch {
        if (!cancelled) {
          setReceiptSubmission(null)
          setReceiptError('Kunne ikke laste kvitteringen akkurat nå.')
        }
      } finally {
        if (!cancelled) {
          setLoadingReceipt(false)
        }
      }
    }

    loadReceipt()

    return () => {
      cancelled = true
    }
  }, [activeFormSlug, activeReceiptLookupToken])

  useEffect(() => {
    if (!receiptSubmission) {
      setReceiptImageUrls({})
      return
    }

    let cancelled = false
    const imagePaths = Array.from(
      new Set(Object.values(receiptSubmission.answers || {}).filter((value) => isStorageImagePath(value))),
    )

    if (imagePaths.length === 0) {
      setReceiptImageUrls({})
      return
    }

    Promise.all(
      imagePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    ).then((pairs) => {
      if (cancelled) {
        return
      }

      setReceiptImageUrls(
        Object.fromEntries(pairs.filter(([, url]) => Boolean(url))),
      )
    })

    return () => {
      cancelled = true
    }
  }, [receiptSubmission])

  useEffect(() => {
    if (isReviewView && submissionId) {
      setSelectedSubmissionId(submissionId)
      return
    }

    setSelectedSubmissionId('')
  }, [activeFormSlug, isSubmissionsView, isFlaggedView, isReviewView, submissionId])

  useEffect(() => {
    if (!isSubmissionsView) {
      setSelectedSubmissionDay('')
      return
    }

    const availableDayKeys = Array.from(
      new Set(submissions.map((submission) => getSubmissionDayKey(submission.submittedAt)).filter(Boolean)),
    )

    if (availableDayKeys.length === 0) {
      setSelectedSubmissionDay('')
      return
    }

    setSelectedSubmissionDay((previous) =>
      previous && availableDayKeys.includes(previous) ? previous : availableDayKeys[0],
    )
  }, [isSubmissionsView, submissions])

  useEffect(() => {
    if (!selectedSubmissionId) {
      setSelectedSubmissionImageUrls({})
      setSelectedSubmissionImagesLoading(false)
      setReviewDraftStatuses({})
      setReviewDraftComments({})
      setReviewSubmissionState({ saving: false, error: '' })
      return
    }

    const selectedSubmission = submissions.find((item) => item.id === selectedSubmissionId)
    if (!selectedSubmission) {
      setSelectedSubmissionImageUrls({})
      setSelectedSubmissionImagesLoading(false)
      setReviewDraftStatuses({})
      setReviewDraftComments({})
      setReviewSubmissionState({ saving: false, error: '' })
      return
    }

    let cancelled = false
    setSelectedSubmissionImagesLoading(true)
    const reviewQuestionsForSubmission = formData.questions.filter(
      (question) => !isSectionQuestion(question) && Boolean(question.includeInReview),
    )
    const reviewEntries = getOrderedAnswerEntries(
      selectedSubmission.answers || {},
      reviewQuestionsForSubmission,
      {
        includeRemainingAnswers: false,
      },
    )
    const flaggedKeys = Array.isArray(selectedSubmission.flaggedAnswers)
      ? selectedSubmission.flaggedAnswers
          .map((item) => String(item?.answerKey || '').trim())
          .filter(Boolean)
      : []
    const defaultStatus = selectedSubmission.status === 'reviewed' ? 'approved' : ''

    setReviewDraftStatuses(
      Object.fromEntries(
        reviewEntries.map(([answerKey]) => [
          answerKey,
          flaggedKeys.includes(answerKey) ? 'flagged' : defaultStatus,
        ]),
      ),
    )
    setReviewDraftComments(
      Array.isArray(selectedSubmission.flaggedAnswers)
        ? Object.fromEntries(
            selectedSubmission.flaggedAnswers
              .map((item) => [String(item?.answerKey || '').trim(), String(item?.comment || '')])
              .filter(([answerKey]) => Boolean(answerKey)),
          )
        : {},
    )
    setReviewSubmissionState({ saving: false, error: '' })

    const allPaths = [
      ...(Array.isArray(selectedSubmission.imagePaths) ? selectedSubmission.imagePaths : []),
      ...Object.values(selectedSubmission.answers || {}).filter((value) => isStorageImagePath(value)),
    ]
    const uniquePaths = Array.from(new Set(allPaths))

    Promise.all(
      uniquePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    )
      .then((pairs) => {
        if (cancelled) {
          return
        }
        setSelectedSubmissionImageUrls(
          Object.fromEntries(pairs.filter(([, url]) => url.length > 0)),
        )
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedSubmissionImagesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [formData.questions, selectedSubmissionId, submissions])

  useEffect(() => {
    const validQuestionIds = new Set(
      formData.questions
        .filter((question) => !isSectionQuestion(question) && Boolean(question.includeInAnalysis))
        .map((question) => question.id),
    )

    setSelectedHistoryQuestionIds((previous) =>
      previous.filter((questionId) => validQuestionIds.has(questionId)),
    )
  }, [formData.questions])

  useEffect(() => {
    if (!isHistoryView) {
      setHistoryQuestionFilterOpen(false)
      setHistoryLocationFilterOpen(false)
    }
  }, [isHistoryView])

  function onAnswerChange(questionId, value) {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: value,
    }))
  }

  async function onCameraFileChange(questionId, file) {
    setCameraFiles((previous) => ({
      ...previous,
      [questionId]: file,
    }))
    onAnswerChange(questionId, file ? file.name : '')

    if (!file) {
      setCameraPreviews((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      return
    }

    try {
      const previewUrl = await readFileAsDataUrl(file)
      setCameraPreviews((previous) => ({
        ...previous,
        [questionId]: previewUrl,
      }))
    } catch {
      setCameraPreviews((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
    }
  }

  async function onSelectDetailCameraFileChange(questionId, file) {
    setSelectDetailFiles((previous) => ({
      ...previous,
      [questionId]: file,
    }))

    if (!file) {
      setSelectDetailPreviews((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
      return
    }

    try {
      const previewUrl = await readFileAsDataUrl(file)
      setSelectDetailPreviews((previous) => ({
        ...previous,
        [questionId]: previewUrl,
      }))
    } catch {
      setSelectDetailPreviews((previous) => {
        if (typeof previous[questionId] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[questionId]
        return next
      })
    }
  }

  function resetAllAnswers() {
    const confirmed = window.confirm(publicCopy.resetAnswersConfirm)
    if (!confirmed) {
      return
    }

    const clearedAnswers = formData.questions.reduce((accumulator, question) => {
      if (isSectionQuestion(question)) {
        return accumulator
      }
      accumulator[question.id] = question.type === 'date' ? getTodayInputValue() : ''
      return accumulator
    }, {})

    setAnswers(clearedAnswers)
    setLocationOtherAnswers({})
    setSelectDetailAnswers({})
    setSelectDetailFiles({})
    setSelectDetailPreviews({})
    setSelfDeclarationAccepted(false)
    setCameraFiles({})
    setCameraPreviews({})
    setFormInstanceKey((previous) => previous + 1)
    clearFormDraft(activeFormSlug)
    setSubmitState({
      submitting: false,
      message: 'Alle svar er nullstilt.',
      error: '',
    })
  }

  async function onSubmit(event) {
    event.preventDefault()
    setSubmitState({ submitting: false, message: '', error: '' })

    if (formData.enableSelfDeclaration && !selfDeclarationAccepted) {
      setSubmitState({
        submitting: false,
        message: '',
        error:
          displayLanguage === 'en'
            ? 'You must confirm the self-declaration.'
            : 'Du må bekrefte egenerklæringen.',
      })
      return
    }

    const missingRequired = visibleInputQuestions.find((question) => {
      const answerValue = String(answers[question.id] || '').trim()
      const selectedBehavior = getSelectOptionBehavior(question, answerValue)

      if (question.type === 'select' && selectedBehavior.kind === 'input' && answerValue) {
        return !String(selectDetailAnswers[question.id] || '').trim()
      }

      if (question.type === 'select' && selectedBehavior.kind === 'camera' && answerValue) {
        return (
          !selectDetailFiles[question.id] &&
          !String(selectDetailAnswers[question.id] || '').trim() &&
          !String(selectDetailPreviews[question.id] || '').trim()
        )
      }

      if (!question.required) {
        return false
      }

      if (question.type === 'camera') {
        return !cameraFiles[question.id] && !answerValue
      }

      if (question.type === 'location') {
        return answers[question.id] === LOCATION_OTHER_VALUE
          ? !String(locationOtherAnswers[question.id] || '').trim()
          : !answerValue
      }

      return !answerValue
    })

    if (missingRequired) {
      setSubmitState({
        submitting: false,
        message: '',
        error:
          displayLanguage === 'en'
            ? `Missing answer: ${translateText(missingRequired.label)}`
            : `Manglende svar: ${missingRequired.label}`,
      })
      return
    }

    if (isSubmissionEditMode) {
      const editState = getReceiptEditState(receiptSubmission?.submittedAtIso)
      if (!receiptSubmission?.submissionId) {
        setSubmitState({
          submitting: false,
          message: '',
          error: publicCopy.loadingReceipt,
        })
        return
      }
      if (!editState.allowed) {
        setSubmitState({
          submitting: false,
          message: '',
          error: publicCopy.editWindowExpired,
        })
        return
      }
    }

    const receiptWindow = window.open('', '_blank')
    setSubmitState({ submitting: true, message: '', error: '' })

    try {
      const submissionRef =
        isSubmissionEditMode && receiptSubmission?.submissionId
          ? doc(db, 'formSubmissions', receiptSubmission.submissionId)
          : doc(collection(db, 'formSubmissions'))
      const receiptRef =
        isSubmissionEditMode && editReceiptToken
          ? doc(db, 'formSubmissionReceipts', editReceiptToken)
          : doc(collection(db, 'formSubmissionReceipts'))
      const imagePaths = []
      const receiptImageMap = {}
      const submissionAnswers = {}

      visibleInputQuestions.forEach((question) => {
        const answerValue = answers[question.id]
        submissionAnswers[question.id] =
          typeof answerValue === 'string' ? answerValue.trim() : answerValue || ''

        if (question.type === 'location') {
          submissionAnswers[question.id] =
            answers[question.id] === LOCATION_OTHER_VALUE
              ? String(locationOtherAnswers[question.id] || '').trim()
              : String(answers[question.id] || '').trim()
        }

        if (question.type === 'select') {
          const selectedValue = String(answers[question.id] || '').trim()
          const selectedBehavior = getSelectOptionBehavior(question, selectedValue)
          const detailValue = String(selectDetailAnswers[question.id] || '').trim()
          if (selectedBehavior.kind === 'input' && detailValue) {
            submissionAnswers[getSelectDetailAnswerKey(question.id)] = detailValue
          }
          if (selectedBehavior.kind === 'camera') {
            const file = selectDetailFiles[question.id]
            if (file) {
              const fileName = sanitizeFileName(file.name)
              const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${question.id}-detail-${fileName}`
              imagePaths.push(path)
              submissionAnswers[getSelectDetailAnswerKey(question.id)] = path
            }
          }
        }
      })

      if (formData.includeSubmissionDateTime) {
        const submittedNow = new Date()
        submissionAnswers[SUBMISSION_DATE_KEY] = submittedNow.toLocaleDateString('nb-NO')
        submissionAnswers[SUBMISSION_TIME_KEY] = submittedNow.toLocaleTimeString('nb-NO', {
          hour: '2-digit',
          minute: '2-digit',
        })
      }

      if (formData.enableSelfDeclaration && selfDeclarationAccepted) {
        submissionAnswers[SELF_DECLARATION_ACCEPTED_KEY] = 'Ja'
      }

      await Promise.all(
        visibleInputQuestions.map(async (question) => {
          if (question.type !== 'camera') {
            return
          }
          const file = cameraFiles[question.id]
          if (!file) {
            return
          }
          const fileName = sanitizeFileName(file.name)
          const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${question.id}-${fileName}`
          await uploadBytes(ref(storage, path), file, {
            contentType: file.type,
          })
          const downloadUrl = await getDownloadURL(ref(storage, path))
          imagePaths.push(path)
          submissionAnswers[question.id] = path
          receiptImageMap[path] = downloadUrl
        }),
      )

      await Promise.all(
        formData.questions.map(async (question) => {
          if (question.type !== 'select') {
            return
          }

          const selectedValue = String(answers[question.id] || '').trim()
          const selectedBehavior = getSelectOptionBehavior(question, selectedValue)
          if (selectedBehavior.kind !== 'camera') {
            return
          }

          const file = selectDetailFiles[question.id]
          if (!file) {
            return
          }

          const fileName = sanitizeFileName(file.name)
          const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${question.id}-detail-${fileName}`
          await uploadBytes(ref(storage, path), file, {
            contentType: file.type,
          })
          submissionAnswers[getSelectDetailAnswerKey(question.id)] = path
          receiptImageMap[path] = await getDownloadURL(ref(storage, path))
        }),
      )

      const allImagePaths = Array.from(
        new Set(Object.values(submissionAnswers).filter((value) => isStorageImagePath(value))),
      )
      const mergedReceiptImageMap = allImagePaths.reduce((accumulator, path) => {
        accumulator[path] =
          receiptImageMap[path] ||
          receiptSubmission?.imageUrls?.[path] ||
          receiptImageUrls[path] ||
          ''
        return accumulator
      }, {})

      const submitterEmail = getSubmissionEmail(submissionAnswers, formData.questions)
      const submittedAtIso = new Date().toISOString()

      let receiptTokenValue = ''

      try {
        await setDoc(
          receiptRef,
          {
            formSlug: activeFormSlug,
            formTitle: formData.title || activeFormSlug,
            submissionId: submissionRef.id,
            submitterEmail,
            submittedAtIso: isSubmissionEditMode
              ? receiptSubmission?.submittedAtIso || submittedAtIso
              : submittedAtIso,
            answers: submissionAnswers,
            imagePaths: allImagePaths,
            imageUrls: mergedReceiptImageMap,
            ...(isSubmissionEditMode
              ? {
                  updatedAt: serverTimestamp(),
                }
              : {
                  createdAt: serverTimestamp(),
                }),
          },
          { merge: isSubmissionEditMode },
        )
        receiptTokenValue = receiptRef.id
      } catch (receiptError) {
        console.error('Failed to create submission receipt', {
          formSlug: activeFormSlug,
          submissionId: submissionRef.id,
          error: receiptError,
        })
      }

      await setDoc(
        submissionRef,
        {
          formId: formDocId,
          formSlug: activeFormSlug,
          formTitle: formData.title || activeFormSlug,
          answers: submissionAnswers,
          imagePaths: allImagePaths,
          ...(receiptTokenValue ? { receiptToken: receiptTokenValue } : {}),
          submitterEmail,
          status: 'awaiting review',
          statusUpdatedBy: 'system',
          statusUpdatedAt: serverTimestamp(),
          ...(isSubmissionEditMode
            ? {
                updatedAt: serverTimestamp(),
              }
            : {
                submittedAt: serverTimestamp(),
              }),
        },
        { merge: isSubmissionEditMode },
      )

      if (receiptTokenValue) {
        receiptWindow?.location.replace(
          `http://crust.no/skjema/stengeskjema/kvittering/${receiptTokenValue}`,
        )
      } else {
        receiptWindow?.close()
      }

      const clearedAnswers = formData.questions.reduce((accumulator, question) => {
        if (isSectionQuestion(question)) {
          return accumulator
        }
        accumulator[question.id] = question.type === 'date' ? getTodayInputValue() : ''
        return accumulator
      }, {})

      clearFormDraft(activeFormSlug)
      setAnswers(clearedAnswers)
      setLocationOtherAnswers({})
      setSelectDetailAnswers({})
      setSelectDetailFiles({})
      setSelectDetailPreviews({})
      setSelfDeclarationAccepted(false)
      setCameraFiles({})
      setCameraPreviews({})
      setFormInstanceKey((previous) => previous + 1)
      setSubmitState({
        submitting: false,
        message:
          displayLanguage === 'en'
            ? isSubmissionEditMode
              ? 'Thanks! Your changes have been saved.'
              : 'Thanks! The form has been submitted.'
            : isSubmissionEditMode
              ? 'Takk! Endringene er lagret.'
              : 'Takk! Skjemaet er sendt inn.',
        error: '',
      })
    } catch (error) {
      receiptWindow?.close()
      console.error('Failed to submit form', {
        formSlug: activeFormSlug,
        error,
      })
      setSubmitState({
        submitting: false,
        message: '',
        error: getSubmitErrorMessage(error),
      })
    }
  }

  function onEditorQuestionChange(index, key, value) {
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) => {
        if (questionIndex !== index) {
          return question
        }

        if (key === 'options') {
          const nextOptions = parseQuestionOptions(value)
          const nextSelectOptionDetails = nextOptions.reduce((accumulator, option) => {
            const existingDetail =
              question.selectOptionDetails && typeof question.selectOptionDetails === 'object'
                ? question.selectOptionDetails[option]
                : null

            accumulator[option] = {
              kind: ['input', 'message', 'camera'].includes(existingDetail?.kind)
                ? existingDetail.kind
                : 'none',
              text: typeof existingDetail?.text === 'string' ? existingDetail.text : '',
              messageColor:
                typeof existingDetail?.messageColor === 'string' ? existingDetail.messageColor : '',
              messageBold: Boolean(existingDetail?.messageBold),
              historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(existingDetail?.historyCategory)
                ? existingDetail.historyCategory
                : 'normal',
            }

            return accumulator
          }, {})

          return {
            ...question,
            optionsText: String(value),
            options: nextOptions,
            selectOptionDetails: nextSelectOptionDetails,
          }
        }

        if (key === 'type') {
          const currentOptions = parseQuestionOptions(question.optionsText || question.options)
          const nextOptions = currentOptions.length > 0 ? currentOptions : ['Ja', 'Nei']
          const nextSelectOptionDetails =
            value === 'select'
              ? nextOptions.reduce((accumulator, option) => {
                  const existingDetail =
                    question.selectOptionDetails && typeof question.selectOptionDetails === 'object'
                      ? question.selectOptionDetails[option]
                      : null

                  accumulator[option] = {
                    kind: ['input', 'message', 'camera'].includes(existingDetail?.kind)
                      ? existingDetail.kind
                      : 'none',
                    text: typeof existingDetail?.text === 'string' ? existingDetail.text : '',
                    messageColor:
                      typeof existingDetail?.messageColor === 'string'
                        ? existingDetail.messageColor
                        : '',
                    messageBold: Boolean(existingDetail?.messageBold),
                    historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(
                      existingDetail?.historyCategory,
                    )
                      ? existingDetail.historyCategory
                      : 'normal',
                  }

                  return accumulator
                }, {})
              : {}

          return {
            ...question,
            type: value,
            required: value === 'section' ? false : question.required,
            includeInReview: value === 'section' ? false : question.includeInReview,
            deliveryUnlimited: value === 'select' ? question.deliveryUnlimited : true,
            deliveryMaxUnits: value === 'select' ? question.deliveryMaxUnits : '',
            imageUrl: question.imageUrl,
            imagePreviewUrl: question.imagePreviewUrl,
            imageFile: question.imageFile,
            removeImage: question.removeImage,
            visibleForLocations: value === 'location' ? [] : normalizeVisibleForLocations(question.visibleForLocations),
            selectOptionDetails: nextSelectOptionDetails,
            options: value === 'select' ? nextOptions : [],
            optionsText:
              value === 'select'
                ? nextOptions.join(', ')
                : '',
          }
        }

        if (key === 'label') {
          return {
            ...question,
            label: value,
          }
        }

        return {
          ...question,
          [key]: value,
        }
      }),
    )
  }

  async function onEditorQuestionImageChange(index, file) {
    if (!file) {
      return
    }

    const previewUrl = await readFileAsDataUrl(file)
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) =>
        questionIndex === index
          ? {
              ...question,
              imageFile: file,
              imagePreviewUrl: previewUrl,
              removeImage: false,
            }
          : question,
      ),
    )
  }

  function removeEditorQuestionImage(index) {
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) =>
        questionIndex === index
          ? {
              ...question,
              imageUrl: '',
              imagePreviewUrl: '',
              imageZoom: 1,
              imageFile: null,
              removeImage: true,
            }
          : question,
      ),
    )
  }

  function onEditorSelectOptionDetailChange(index, option, key, value) {
    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) => {
        if (questionIndex !== index) {
          return question
        }

        const currentDetail =
          question.selectOptionDetails && typeof question.selectOptionDetails === 'object'
            ? question.selectOptionDetails[option]
            : null

        const nextDetail = {
          kind: ['input', 'message', 'camera'].includes(currentDetail?.kind)
            ? currentDetail.kind
            : 'none',
          text: typeof currentDetail?.text === 'string' ? currentDetail.text : '',
          messageColor:
            typeof currentDetail?.messageColor === 'string' ? currentDetail.messageColor : '',
          messageBold: Boolean(currentDetail?.messageBold),
          historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(currentDetail?.historyCategory)
            ? currentDetail.historyCategory
            : 'normal',
          [key]: value,
        }

        if (key === 'kind' && value === 'none') {
          nextDetail.text = ''
        }

        return {
          ...question,
          selectOptionDetails: {
            ...(question.selectOptionDetails || {}),
            [option]: nextDetail,
          },
        }
      }),
    )
  }

  function onEditorQuestionVisibleLocationChange(index, locationName, checked) {
    const normalizedLocationName = String(locationName || '').trim()
    if (!normalizedLocationName) {
      return
    }

    setEditorQuestions((previous) =>
      previous.map((question, questionIndex) => {
        if (questionIndex !== index) {
          return question
        }

        const nextVisibleForLocations = checked
          ? [...normalizeVisibleForLocations(question.visibleForLocations), normalizedLocationName]
          : normalizeVisibleForLocations(question.visibleForLocations).filter(
              (item) => item !== normalizedLocationName,
            )

        return {
          ...question,
          visibleForLocations: nextVisibleForLocations,
        }
      }),
    )
  }

  function getEditorLocationSetting(locationId, question) {
    const existingSetting =
      editorLocationSettings[locationId] && editorLocationSettings[locationId][question.id]
        ? editorLocationSettings[locationId][question.id]
        : null
    const matchingLocation = availableLocations.find((location) => location.id === locationId) || null

    return existingSetting || getLocationQuestionDeliverySetting(matchingLocation, activeFormSlug, question)
  }

  function onEditorLocationSettingChange(locationId, question, key, value) {
    setEditorLocationSettings((previous) => ({
      ...previous,
      [locationId]: {
        ...(previous[locationId] || {}),
        [question.id]: {
          ...getEditorLocationSetting(locationId, question),
          ...(previous[locationId]?.[question.id] || {}),
          [key]: value,
        },
      },
    }))
  }

  function addQuestion() {
    setEditorQuestions((previous) => [
      ...previous,
      createEditorQuestion(`new-question-${previous.length + 1}-${Date.now()}`),
    ])
  }

  function insertQuestionAfter(index) {
    setEditorQuestions((previous) => {
      const next = [...previous]
      next.splice(index + 1, 0, createEditorQuestion(`insert-question-${index + 1}-${Date.now()}`))
      return next
    })
  }

  function addSection() {
    setEditorQuestions((previous) => [
      ...previous,
      {
        id: toQuestionId(`section-${previous.length + 1}`),
        label: `Kategori ${previous.length + 1}`,
        type: 'section',
        required: false,
        placeholder: '',
        imageUrl: '',
        imageZoom: 1,
        includeInAnalysis: false,
        deliveryUnlimited: true,
        deliveryMaxUnits: '',
        helpTextColor: '',
        helpTextBold: false,
        visibleForLocations: [],
        selectOptionDetails: {},
        imagePreviewUrl: '',
        imageFile: null,
        removeImage: false,
        options: [],
        optionsText: '',
        moveTarget: '',
      },
    ])
  }

  function removeQuestion(index) {
    const confirmed = window.confirm('Fjerne dette spørsmålet?')
    if (!confirmed) {
      return
    }

    setEditorQuestions((previous) => previous.filter((_, questionIndex) => questionIndex !== index))
  }

  function duplicateQuestion(index) {
    setEditorQuestions((previous) => {
      const sourceQuestion = previous[index]
      if (!sourceQuestion) {
        return previous
      }

      const duplicateId = toQuestionId(
        `${sourceQuestion.id || sourceQuestion.label || 'question'}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
      )

      const duplicatedQuestion = {
        ...sourceQuestion,
        id: duplicateId,
        label: sourceQuestion.label ? `${sourceQuestion.label} kopi` : `Kopi ${index + 1}`,
        imagePreviewUrl: sourceQuestion.imagePreviewUrl || sourceQuestion.imageUrl || '',
        imageZoom: normalizeImageZoom(sourceQuestion.imageZoom),
        moveTarget: '',
        options: [...(sourceQuestion.options || [])],
        selectOptionDetails: Object.fromEntries(
          Object.entries(sourceQuestion.selectOptionDetails || {}).map(([option, detail]) => [
            option,
            {
              kind: detail?.kind || 'none',
              text: typeof detail?.text === 'string' ? detail.text : '',
              messageColor:
                typeof detail?.messageColor === 'string' ? detail.messageColor : '',
              messageBold: Boolean(detail?.messageBold),
              historyCategory: SELECT_OPTION_HISTORY_CATEGORIES.includes(detail?.historyCategory)
                ? detail.historyCategory
                : 'normal',
            },
          ]),
        ),
      }

      const next = [...previous]
      next.splice(index + 1, 0, duplicatedQuestion)
      return next
    })
  }

  function moveQuestion(index, direction) {
    const nextIndex = direction === 'up' ? index - 1 : index + 1
    if (nextIndex < 0 || nextIndex >= editorQuestions.length) {
      return
    }

    setEditorQuestions((previous) => {
      const reordered = [...previous]
      const [item] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, item)
      return reordered
    })
  }

  function moveQuestionToNumber(index, rawValue) {
    const requestedNumber = Number(rawValue)
    if (!Number.isFinite(requestedNumber)) {
      return
    }

    const nextIndex = Math.min(
      editorQuestions.length - 1,
      Math.max(0, Math.round(requestedNumber) - 1),
    )

    if (nextIndex === index) {
      setEditorQuestions((previous) =>
        previous.map((question, questionIndex) =>
          questionIndex === index
            ? {
                ...question,
                moveTarget: '',
              }
            : question,
        ),
      )
      return
    }

    setEditorQuestions((previous) => {
      const reordered = [...previous]
      const [item] = reordered.splice(index, 1)
      reordered.splice(nextIndex, 0, {
        ...item,
        moveTarget: '',
      })

      return reordered.map((question) => ({
        ...question,
        moveTarget: '',
      }))
    })
  }

  function getQuestionImageStyle(question) {
    return {
      '--question-image-scale': String(normalizeImageZoom(question?.imageZoom)),
    }
  }

  function renderQuestionImage(src, alt, zoom, preview = false) {
    if (!src) {
      return null
    }

    return (
      <div className={preview ? 'question-image-preview-frame' : 'question-image-frame'}>
        <img
          className={preview ? 'question-image-preview-image' : 'question-image'}
          src={src}
          alt={alt}
          loading="lazy"
          style={getQuestionImageStyle({ imageZoom: zoom })}
        />
      </div>
    )
  }

  async function onSaveForm(targetIndex = null) {
    setSaveState({ saving: true, message: '', error: '' })

    try {
      const preparedQuestions = await Promise.all(
        editorQuestions.map(
          async ({ imageFile, optionsText, removeImage, ...question }, index) => {
            let imageUrl = removeImage ? '' : String(question.imageUrl || '').trim()

            if (imageFile) {
              const fileName = sanitizeFileName(imageFile.name)
              const questionId = question.id || toQuestionId(question.label || `q-${index + 1}`)
              const path = `forms/questions/${activeFormSlug}/${questionId}-${Date.now()}-${fileName}`
              await uploadBytes(ref(storage, path), imageFile, {
                contentType: imageFile.type,
              })
              imageUrl = await getDownloadURL(ref(storage, path))
            }

            return normalizeQuestion(
              {
                ...question,
                id: question.id || toQuestionId(question.label || `q-${index + 1}`),
                imageUrl,
                options: question.type === 'select' ? parseQuestionOptions(optionsText) : [],
              },
              index,
            )
          },
        ),
      )

      const payload = {
        slug: activeFormSlug,
        title: editorTitle.trim() || (isDefaultForm ? defaultStengeskjema.title : activeFormSlug),
        description: editorDescription.trim() || '',
        includeSubmissionDateTime: editorIncludeSubmissionDateTime,
        enableSelfDeclaration: editorEnableSelfDeclaration,
        selfDeclarationText: editorEnableSelfDeclaration
          ? editorSelfDeclarationText.trim()
          : '',
        questions: preparedQuestions,
        updatedAt: serverTimestamp(),
      }

      const formRef = doc(db, 'forms', formDocId || activeFormSlug)
      const snapshot = await getDoc(formRef)
      if (snapshot.exists()) {
        await updateDoc(formRef, payload)
      } else {
        await setDoc(formRef, payload)
      }

      setFormData({
        ...formData,
        ...payload,
      })
      setEditorQuestions(preparedQuestions.map((question, index) => toEditorQuestion(question, index)))
      setSaveState({
        saving: false,
        message:
          typeof targetIndex === 'number'
            ? `Spørsmål ${targetIndex + 1} lagret.`
            : 'Skjema oppdatert.',
        error: '',
      })
    } catch (error) {
      setSaveState({
        saving: false,
        message: '',
        error: getFormSaveErrorMessage(error),
      })
    }
  }

  async function onSaveDeliverySettings() {
    if (availableLocations.length === 0) {
      setDeliverySettingsState({
        saving: false,
        message: '',
        error: 'Ingen lokasjoner tilgjengelig å lagre innstillinger for.',
      })
      return
    }

    setDeliverySettingsState({
      saving: true,
      message: '',
      error: '',
    })

    try {
      const nextLocations = await Promise.all(
        availableLocations.map(async (location) => {
          const nextFormSettings = deliveryConfigQuestions.reduce((accumulator, question) => {
            const currentSetting = getEditorLocationSetting(location.id, question)

            accumulator[question.id] = {
              targetValue: String(currentSetting.targetValue || '').trim(),
              deliveryUnlimited: Boolean(currentSetting.deliveryUnlimited),
              deliveryMaxUnits:
                Number.parseInt(currentSetting.deliveryMaxUnits, 10) > 0
                  ? Number.parseInt(currentSetting.deliveryMaxUnits, 10)
                  : null,
            }

            return accumulator
          }, {})

          const mergedFormSettings = {
            ...(location.formSettings && typeof location.formSettings === 'object' ? location.formSettings : {}),
            [activeFormSlug]: nextFormSettings,
          }

          await setDoc(
            doc(db, 'locations', location.id),
            {
              formSettings: mergedFormSettings,
              updatedAt: serverTimestamp(),
              updatedBy: user?.email || 'admin',
            },
            { merge: true },
          )

          return {
            ...location,
            formSettings: mergedFormSettings,
          }
        }),
      )

      setAvailableLocations(nextLocations)
      setAvailableLocationsError('')
      setDeliverySettingsState({
        saving: false,
        message: 'Lokasjonsinnstillinger lagret.',
        error: '',
      })
    } catch (error) {
      setDeliverySettingsState({
        saving: false,
        message: '',
        error: getLocationsLoadErrorMessage(error),
      })
    }
  }

  function renderQuestionLead(question) {
    const localizedLabel = translateText(question.label)
    const localizedHelp = translateText(question.placeholder)

    return (
      <>
        <div className="question-copy">
          <span className="question-label">
            {localizedLabel}
            {!question.required ? (
              <span className="question-optional-note">{publicCopy.optionalNote}</span>
            ) : null}
          </span>
        </div>
        {question.imageUrl ? (
          renderQuestionImage(question.imageUrl, localizedLabel, question.imageZoom)
        ) : null}
        {question.placeholder ? (
          <small className="question-help" style={getHelpTextStyle(question)}>
            {localizedHelp}
          </small>
        ) : null}
      </>
    )
  }

  function renderSectionHeading(question) {
    const localizedLabel = translateText(question.label)
    const localizedHelp = translateText(question.placeholder)

    return (
      <div className="form-section-heading">
        <h3>{localizedLabel}</h3>
        {question.imageUrl ? (
          renderQuestionImage(question.imageUrl, localizedLabel, question.imageZoom)
        ) : null}
        {question.placeholder ? (
          <small className="question-help" style={getHelpTextStyle(question)}>
            {localizedHelp}
          </small>
        ) : null}
      </div>
    )
  }

  async function onUpdateSubmissionStatus(submissionId, nextStatus) {
    setStatusUpdateState((previous) => ({
      ...previous,
      [submissionId]: { saving: true, error: '' },
    }))

    try {
      await updateDoc(doc(db, 'formSubmissions', submissionId), {
        status: nextStatus,
        statusUpdatedBy: user?.email || 'admin',
        statusUpdatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
      })

      setSubmissions((previous) =>
        previous.map((submission) =>
          submission.id === submissionId
            ? {
                ...submission,
                status: nextStatus,
                statusUpdatedBy: user?.email || 'admin',
                statusUpdatedAt: new Date(),
              }
            : submission,
        ),
      )

      setStatusUpdateState((previous) => ({
        ...previous,
        [submissionId]: { saving: false, error: '' },
      }))
    } catch (err) {
      console.error('Failed to update submission status', {
        submissionId,
        nextStatus,
        error: err,
      })
      const code = err?.code ? ` (${err.code})` : ''
      const message =
        err?.code === 'permission-denied'
          ? `Kunne ikke oppdatere status${code}. Mangler tilgang i Firestore-regler.`
          : `Kunne ikke oppdatere status${code}.`
      setStatusUpdateState((previous) => ({
        ...previous,
        [submissionId]: { saving: false, error: message },
      }))
    }
  }

  async function onDeleteSubmission(submissionId) {
    const confirmed = window.confirm('Delete this submission permanently?')
    if (!confirmed) {
      return
    }

    setDeleteSubmissionState((previous) => ({
      ...previous,
      [submissionId]: { deleting: true, error: '' },
    }))

    try {
      await deleteDoc(doc(db, 'formSubmissions', submissionId))
      setSubmissions((previous) => previous.filter((submission) => submission.id !== submissionId))
      if (selectedSubmissionId === submissionId) {
        setSelectedSubmissionId('')
      }
      setDeleteSubmissionState((previous) => ({
        ...previous,
        [submissionId]: { deleting: false, error: '' },
      }))
    } catch {
      setDeleteSubmissionState((previous) => ({
        ...previous,
        [submissionId]: { deleting: false, error: 'Could not delete the submission.' },
      }))
    }
  }

  function onViewSubmission(submissionId) {
    setSelectedSubmissionId(submissionId)
  }

  function closeSubmissionModal() {
    setSelectedSubmissionId('')
  }

  const selectedSubmission = submissions.find((submission) => submission.id === selectedSubmissionId)
  const reviewQuestions = formData.questions.filter(
    (question) => !isSectionQuestion(question) && Boolean(question.includeInReview),
  )
  const selectedSubmissionAnswerEntries = selectedSubmission
    ? getOrderedAnswerEntries(selectedSubmission.answers || {}, reviewQuestions, {
        includeRemainingAnswers: false,
      })
    : []
  const hasPendingReviewDecisions = selectedSubmissionAnswerEntries.some(
    ([answerKey]) => !String(reviewDraftStatuses[answerKey] || '').trim(),
  )

  function onSetReviewStatus(answerKey, nextStatus) {
    setReviewDraftStatuses((previous) => ({
      ...previous,
      [answerKey]: nextStatus,
    }))

    if (nextStatus !== 'flagged') {
      setReviewDraftComments((previous) => {
        if (typeof previous[answerKey] === 'undefined') {
          return previous
        }
        const next = { ...previous }
        delete next[answerKey]
        return next
      })
    }
  }

  function onReviewCommentChange(answerKey, value) {
    setReviewDraftComments((previous) => ({
      ...previous,
      [answerKey]: value,
    }))
  }

  async function onSaveSubmissionReview() {
    if (!selectedSubmission) {
      return
    }

    const hasPendingDecisions = selectedSubmissionAnswerEntries.some(
      ([answerKey]) => !String(reviewDraftStatuses[answerKey] || '').trim(),
    )

    if (hasPendingDecisions) {
      setReviewSubmissionState({
        saving: false,
        error: 'Approve or flag every question before setting the submission as reviewed.',
      })
      return
    }

    setReviewSubmissionState({ saving: true, error: '' })

    const flaggedAnswers = selectedSubmissionAnswerEntries
      .filter(([answerKey]) => reviewDraftStatuses[answerKey] === 'flagged')
      .map(([answerKey]) => {
        const value = selectedSubmission.answers?.[answerKey]
        if (!String(value || '').trim()) {
          return null
        }

        return {
          answerKey,
          label: getAnswerDisplayLabel(answerKey, selectedSubmission.answers, formData.questions),
          value: isStorageImagePath(value) ? String(value) : String(value || ''),
          imageUrl: isStorageImagePath(value) ? String(selectedSubmissionImageUrls[value] || '') : '',
          comment: String(reviewDraftComments[answerKey] || '').trim(),
        }
      })
      .filter(Boolean)

    try {
      await updateDoc(doc(db, 'formSubmissions', selectedSubmission.id), {
        flaggedAnswers,
        status: 'reviewed',
        statusUpdatedBy: user?.email || 'admin',
        statusUpdatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
      })

      setSubmissions((previous) =>
        previous.map((submission) =>
          submission.id === selectedSubmission.id
            ? {
                ...submission,
                flaggedAnswers,
                status: 'reviewed',
                statusUpdatedBy: user?.email || 'admin',
                statusUpdatedAt: new Date(),
                reviewedAt: new Date(),
              }
            : submission,
        ),
      )

      setReviewSubmissionState({ saving: false, error: '' })
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setReviewSubmissionState({
        saving: false,
        error:
          error?.code === 'permission-denied'
            ? `Could not save the review${code}. Firestore rules do not allow this action.`
            : `Could not save the review${code}.`,
      })
    }
  }

  function onOpenFlaggedReview(submission) {
    if (!submission?.id) {
      return
    }

    setFlaggedReviewOpenId((previous) => (previous === submission.id ? '' : submission.id))
    setFlaggedActionDrafts((previous) => ({
      ...previous,
      [submission.id]:
        typeof previous[submission.id] === 'string'
          ? previous[submission.id]
          : String(submission.flaggedActionTaken || ''),
    }))
    setFlaggedActionState((previous) => ({
      ...previous,
      [submission.id]: {
        saving: false,
        error: '',
        message: previous[submission.id]?.message || '',
      },
    }))
  }

  function onToggleFlaggedCollapsed(submissionId) {
    if (!submissionId) {
      return
    }

    setFlaggedCollapsedIds((previous) => ({
      ...previous,
      [submissionId]: !previous[submissionId],
    }))
  }

  async function onCompleteFlaggedSubmission(submission) {
    if (!submission?.id) {
      return
    }

    const actionTaken = String(flaggedActionDrafts[submission.id] || '').trim()
    if (!actionTaken) {
      setFlaggedActionState((previous) => ({
        ...previous,
        [submission.id]: {
          saving: false,
          error: 'Beskriv hva som ble gjort før flagget settes til complete.',
          message: '',
        },
      }))
      return
    }

    setFlaggedActionState((previous) => ({
      ...previous,
      [submission.id]: {
        saving: true,
        error: '',
        message: '',
      },
    }))

    try {
      await updateDoc(doc(db, 'formSubmissions', submission.id), {
        flaggedStatus: 'complete',
        flaggedActionTaken: actionTaken,
        flaggedCompletedAt: serverTimestamp(),
        flaggedCompletedBy: user?.email || 'admin',
      })

      setSubmissions((previous) =>
        previous.map((item) =>
          item.id === submission.id
            ? {
                ...item,
                flaggedStatus: 'complete',
                flaggedActionTaken: actionTaken,
                flaggedCompletedAt: new Date(),
                flaggedCompletedBy: user?.email || 'admin',
              }
            : item,
        ),
      )

      setFlaggedActionState((previous) => ({
        ...previous,
        [submission.id]: {
          saving: false,
          error: '',
          message: 'Flagget er satt til complete.',
        },
      }))
      setFlaggedReviewOpenId('')
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setFlaggedActionState((previous) => ({
        ...previous,
        [submission.id]: {
          saving: false,
          error:
            error?.code === 'permission-denied'
              ? `Kunne ikke oppdatere flagget${code}. Mangler tilgang i Firestore-regler.`
              : `Kunne ikke oppdatere flagget${code}.`,
          message: '',
        },
      }))
    }
  }

  async function onSetAnalysisActionEntries(entries, nextType, labels) {
    const normalizedEntries = Array.from(
      new Map(
        (Array.isArray(entries) ? entries : [])
          .filter((entry) => entry?.submissionId && entry?.questionId)
          .map((entry) => [`${entry.submissionId}:${entry.questionId}`, entry]),
      ).values(),
    )

    if (normalizedEntries.length === 0) {
      return
    }

    setAnalysisActionState((previous) => ({
      ...previous,
      ...Object.fromEntries(
        normalizedEntries.map((entry) => [`${entry.submissionId}:${entry.questionId}`, { saving: true, error: '' }]),
      ),
    }))

    try {
      await Promise.all(
        normalizedEntries.map(async (entry) => {
          const submission = submissions.find((item) => item.id === entry.submissionId)
          if (!submission) {
            return
          }

          const nextAnalysisActions = {
            ...(submission.analysisActions && typeof submission.analysisActions === 'object'
              ? submission.analysisActions
              : {}),
          }

          if (nextType) {
            nextAnalysisActions[entry.questionId] = {
              type: nextType,
              markedAt: serverTimestamp(),
              markedBy: user?.email || 'admin',
            }
          } else {
            delete nextAnalysisActions[entry.questionId]
          }

          await updateDoc(doc(db, 'formSubmissions', entry.submissionId), {
            analysisActions: nextAnalysisActions,
          })
        }),
      )

      setSubmissions((previous) =>
        previous.map((item) => {
          const matchingEntries = normalizedEntries.filter((entry) => entry.submissionId === item.id)
          if (matchingEntries.length === 0) {
            return item
          }

          const nextAnalysisActions = {
            ...(item.analysisActions && typeof item.analysisActions === 'object'
              ? item.analysisActions
              : {}),
          }

          matchingEntries.forEach((entry) => {
            if (nextType) {
              nextAnalysisActions[entry.questionId] = {
                type: nextType,
                markedAt: new Date(),
                markedBy: user?.email || 'admin',
              }
            } else {
              delete nextAnalysisActions[entry.questionId]
            }
          })

          return {
            ...item,
            analysisActions: nextAnalysisActions,
          }
        }),
      )

      setAnalysisActionState((previous) => ({
        ...previous,
        ...Object.fromEntries(
          normalizedEntries.map((entry) => [`${entry.submissionId}:${entry.questionId}`, { saving: false, error: '' }]),
        ),
      }))
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      const errorMessage =
        error?.code === 'permission-denied'
          ? `${labels.permission}${code}.`
          : `${labels.generic}${code}.`

      setAnalysisActionState((previous) => ({
        ...previous,
        ...Object.fromEntries(
          normalizedEntries.map((entry) => [
            `${entry.submissionId}:${entry.questionId}`,
            { saving: false, error: errorMessage },
          ]),
        ),
      }))
    }
  }

  async function onMarkAnalysisRefill(submission, question) {
    return onSetAnalysisActionEntries(
      [{ submissionId: submission?.id, questionId: question?.id }],
      'refill',
      {
        permission: 'Kunne ikke lagre påfylling. Mangler tilgang i Firestore-regler',
        generic: 'Kunne ikke lagre påfylling',
      },
    )
  }

  async function onResetAnalysisRefill(submission, question) {
    return onSetAnalysisActionEntries(
      [{ submissionId: submission?.id, questionId: question?.id }],
      '',
      {
        permission: 'Kunne ikke nullstille påfylling. Mangler tilgang i Firestore-regler',
        generic: 'Kunne ikke nullstille påfylling',
      },
    )
  }

  async function onMarkDeliveryOrdered(product) {
    return onSetAnalysisActionEntries(product?.sourceEntries, 'ordered', {
      permission: 'Kunne ikke markere som bestilt. Mangler tilgang i Firestore-regler',
      generic: 'Kunne ikke markere som bestilt',
    })
  }

  async function onResetDeliveryOrdered(product) {
    return onSetAnalysisActionEntries(product?.sourceEntries, '', {
      permission: 'Kunne ikke nullstille bestilling. Mangler tilgang i Firestore-regler',
      generic: 'Kunne ikke nullstille bestilling',
    })
  }

  async function onSaveHistoryDefault() {
    const nextDefault = Math.max(1, Number.parseInt(historySubmissionLimit, 10) || 3)

    setHistoryDefaultState({
      saving: true,
      error: '',
      message: '',
    })

    try {
      await setDoc(
        doc(db, 'forms', formDocId || activeFormSlug),
        {
          slug: activeFormSlug,
          analysisDefaultSubmissionLimit: nextDefault,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      )

      setFormData((previous) => ({
        ...previous,
        analysisDefaultSubmissionLimit: nextDefault,
      }))
      setHistorySubmissionLimit(String(nextDefault))
      setHistoryDefaultState({
        saving: false,
        error: '',
        message: 'Default lagret.',
      })
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : ''
      setHistoryDefaultState({
        saving: false,
        error:
          error?.code === 'permission-denied'
            ? `Kunne ikke lagre default${code}. Mangler tilgang i Firestore-regler.`
            : `Kunne ikke lagre default${code}.`,
        message: '',
      })
    }
  }

  function renderQuestionInput(question) {
    const value = answers[question.id] || ''

    if (question.type === 'textarea') {
      return (
        <textarea
          id={question.id}
          value={value}
          placeholder={getLocalizedInputPlaceholder(question)}
          required={question.required}
          rows={4}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    if (question.type === 'select') {
      const detailValue = selectDetailAnswers[question.id] || ''
      const selectedBehavior = getSelectOptionBehavior(question, value)
      const detailPrompt = selectedBehavior.text.trim()
        ? translateText(selectedBehavior.text)
        : publicCopy.describeMore
      const detailFile = selectDetailFiles[question.id] || null
      const detailPreview = selectDetailPreviews[question.id] || ''
      const detailFileInputId = `${question.id}-detail-camera-input`

      return (
        <>
          <select
            id={question.id}
            value={value}
            required={question.required}
            onChange={(event) => {
              const nextValue = event.target.value
              onAnswerChange(question.id, nextValue)
              if (nextValue !== value) {
                setSelectDetailAnswers((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
                setSelectDetailFiles((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
                setSelectDetailPreviews((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
              }
            }}
          >
            <option value="">{publicCopy.select}</option>
            {(question.options || []).map((option) => (
              <option key={option} value={option}>
                {translateText(option)}
              </option>
            ))}
          </select>
          {selectedBehavior.kind === 'message' && selectedBehavior.text.trim() ? (
            <p
              className="field-help select-detail-message"
              style={getSelectMessageStyle(selectedBehavior)}
            >
              {translateText(selectedBehavior.text)}
            </p>
          ) : null}
          {selectedBehavior.kind === 'input' && value ? (
            <>
              <small className="question-help">{detailPrompt}</small>
              <input
                id={getSelectDetailAnswerKey(question.id)}
                type="text"
                value={detailValue}
                placeholder={publicCopy.writeHere}
                required
                onChange={(event) =>
                  setSelectDetailAnswers((previous) => ({
                    ...previous,
                    [question.id]: event.target.value,
                  }))
                }
              />
            </>
          ) : null}
          {selectedBehavior.kind === 'camera' && value ? (
            <div className="camera-upload-control">
              {selectedBehavior.text.trim() ? (
                <small className="question-help">{selectedBehavior.text}</small>
              ) : null}
              <button
                type="button"
                className="ghost camera-upload-button"
                onClick={() => document.getElementById(detailFileInputId)?.click()}
              >
                {detailFile || detailPreview ? publicCopy.uploadNewPhoto : publicCopy.takePhoto}
              </button>
              <input
                id={detailFileInputId}
                type="file"
                accept="image/*"
                capture="environment"
                className="camera-upload-input"
                onChange={async (event) => {
                  const file = event.target.files?.[0] || null
                  await onSelectDetailCameraFileChange(question.id, file)
                  event.target.value = ''
                }}
              />
              {detailPreview ? (
                <div className="camera-upload-preview">
                  <img
                    src={detailPreview}
                    alt={`${translateText(question.label)} ${displayLanguage === 'en' ? 'image' : 'bilde'}`}
                  />
                </div>
              ) : null}
              {detailFile ? <small>Valgt: {detailFile.name}</small> : null}
            </div>
          ) : null}
        </>
      )
    }

    if (question.type === 'location') {
      const otherValue = locationOtherAnswers[question.id] || ''
      const hasAvailableLocations = availableLocations.length > 0

      return (
        <>
          <select
            id={question.id}
            value={value}
            required={question.required}
            onChange={(event) => {
              const nextValue = event.target.value
              onAnswerChange(question.id, nextValue)
              if (nextValue !== LOCATION_OTHER_VALUE) {
                setLocationOtherAnswers((previous) => {
                  if (typeof previous[question.id] === 'undefined') {
                    return previous
                  }
                  const next = { ...previous }
                  delete next[question.id]
                  return next
                })
              }
            }}
          >
            <option value="">
              {loadingLocations ? publicCopy.loadingLocations : publicCopy.chooseLocation}
            </option>
            {availableLocations.map((location) => {
              const locationName = String(location.name || '').trim()
              if (!locationName) {
                return null
              }
              return (
                <option key={location.id} value={locationName}>
                  {locationName}
                </option>
              )
            })}
            <option value={LOCATION_OTHER_VALUE}>{publicCopy.other}</option>
          </select>
          {!loadingLocations && availableLocationsError ? (
            <small className="question-help forms-error">{availableLocationsError}</small>
          ) : null}
          {!loadingLocations && !availableLocationsError && !hasAvailableLocations ? (
            <small className="question-help">{publicCopy.noLocationsHelp}</small>
          ) : null}
          {value === LOCATION_OTHER_VALUE ? (
            <input
              id={`${question.id}-other`}
              type="text"
              value={otherValue}
              placeholder={getLocalizedInputPlaceholder(question, publicCopy.enterLocation)}
              required={question.required}
              onChange={(event) =>
                setLocationOtherAnswers((previous) => ({
                  ...previous,
                  [question.id]: event.target.value,
                }))
              }
            />
          ) : null}
        </>
      )
    }

    if (question.type === 'camera') {
      const fileInputId = `${question.id}-camera-input`
      const cameraPreview = cameraPreviews[question.id] || ''

      return (
        <div className="camera-upload-control">
          <button
            type="button"
            className="ghost camera-upload-button"
            onClick={() => document.getElementById(fileInputId)?.click()}
          >
            {cameraFiles[question.id] || cameraPreview ? publicCopy.uploadNewPhoto : publicCopy.takePhoto}
          </button>
          <input
            id={fileInputId}
            type="file"
            accept="image/*"
            capture="environment"
            className="camera-upload-input"
            onChange={async (event) => {
              const file = event.target.files?.[0] || null
              await onCameraFileChange(question.id, file)
              event.target.value = ''
            }}
          />
          {cameraPreview ? (
            <div className="camera-upload-preview">
              <img
                src={cameraPreview}
                alt={`${translateText(question.label)} ${displayLanguage === 'en' ? 'image' : 'bilde'}`}
              />
            </div>
          ) : null}
          {cameraFiles[question.id] ? (
            <small>Valgt: {cameraFiles[question.id].name}</small>
          ) : null}
        </div>
      )
    }

    if (question.type === 'name') {
      return (
        <input
          id={question.id}
          type="text"
          value={value}
          placeholder={getLocalizedInputPlaceholder(question, publicCopy.fullName)}
          autoComplete="name"
          required={question.required}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    if (question.type === 'email') {
      return (
        <input
          id={question.id}
          type="email"
          value={value}
          placeholder={getLocalizedInputPlaceholder(question, publicCopy.emailAddress)}
          autoComplete="email"
          required={question.required}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    return (
      <input
        id={question.id}
        type={question.type || 'text'}
        value={value}
        placeholder={getLocalizedInputPlaceholder(question)}
        required={question.required}
        onChange={(event) => onAnswerChange(question.id, event.target.value)}
      />
    )
  }

  function isQuestionAnswered(question) {
    if (isSectionQuestion(question)) {
      return false
    }

    if (question.type === 'camera') {
      return Boolean(cameraFiles[question.id]) || String(answers[question.id] || '').trim().length > 0
    }

    if (question.type === 'select') {
      const hasValue = String(answers[question.id] || '').trim().length > 0
      const selectedBehavior = getSelectOptionBehavior(question, String(answers[question.id] || '').trim())
      if (selectedBehavior.kind === 'camera' && hasValue) {
        return (
          Boolean(selectDetailFiles[question.id]) ||
          String(selectDetailAnswers[question.id] || '').trim().length > 0 ||
          String(selectDetailPreviews[question.id] || '').trim().length > 0
        )
      }
      if (selectedBehavior.kind !== 'input' || !hasValue) {
        return hasValue
      }
      return String(selectDetailAnswers[question.id] || '').trim().length > 0
    }

    if (question.type === 'location') {
      if (answers[question.id] === LOCATION_OTHER_VALUE) {
        return String(locationOtherAnswers[question.id] || '').trim().length > 0
      }
      return String(answers[question.id] || '').trim().length > 0
    }

    return String(answers[question.id] || '').trim().length > 0
  }

  const hasLocationQuestions = formData.questions.some(
    (question) => !isSectionQuestion(question) && question.type === 'location',
  )
  const selectedFormLocation = useMemo(
    () => getSelectedFormLocation(formData.questions, answers, locationOtherAnswers),
    [formData.questions, answers, locationOtherAnswers],
  )
  const visibleFormQuestions = useMemo(
    () => getVisibleFormQuestions(formData.questions, selectedFormLocation),
    [formData.questions, selectedFormLocation],
  )
  const visibleInputQuestions = useMemo(
    () => visibleFormQuestions.filter((question) => !isSectionQuestion(question)),
    [visibleFormQuestions],
  )
  const isPublicFormReady =
    !loadingForm &&
    draftReady &&
    (!hasLocationQuestions || !loadingLocations) &&
    (!isSubmissionEditMode || !loadingReceipt)
  const isReceiptReady = !loadingForm && !loadingReceipt
  const availableSubmissionDays = Array.from(
    new Set(submissions.map((submission) => getSubmissionDayKey(submission.submittedAt)).filter(Boolean)),
  )
  const visibleSubmissions = selectedSubmissionDay
    ? submissions.filter((submission) => getSubmissionDayKey(submission.submittedAt) === selectedSubmissionDay)
    : submissions
  const flaggedSubmissions = useMemo(
    () =>
      submissions.filter(
        (submission) => Array.isArray(submission.flaggedAnswers) && submission.flaggedAnswers.length > 0,
      ),
    [submissions],
  )
  const flaggedImagePaths = useMemo(
    () =>
      Array.from(
        new Set(
          flaggedSubmissions.flatMap((submission) =>
            (submission.flaggedAnswers || [])
              .map((item) => item?.value)
              .filter((value) => isStorageImagePath(value)),
          ),
        ),
      ),
    [flaggedSubmissions],
  )
  const missingFlaggedImagePaths = useMemo(
    () => flaggedImagePaths.filter((path) => !(path in flaggedImageUrls)),
    [flaggedImagePaths, flaggedImageUrls],
  )
  const openFlaggedSubmissions = useMemo(
    () =>
      flaggedSubmissions.filter(
        (submission) => String(submission.flaggedStatus || '').trim().toLowerCase() !== 'complete',
      ),
    [flaggedSubmissions],
  )
  const completedFlaggedSubmissions = useMemo(
    () =>
      flaggedSubmissions.filter(
        (submission) => String(submission.flaggedStatus || '').trim().toLowerCase() === 'complete',
      ),
    [flaggedSubmissions],
  )
  const submissionsByLocation = visibleSubmissions
    .reduce((accumulator, submission) => {
      const location = getSubmissionLocation(submission.answers, formData.questions) || 'Ukjent lokasjon'
      const existingGroup = accumulator.find((group) => group.location === location)
      if (existingGroup) {
        existingGroup.items.push(submission)
      } else {
        accumulator.push({ location, items: [submission] })
      }
      return accumulator
    }, [])
    .sort((a, b) => a.location.localeCompare(b.location, 'nb'))
  const analysisQuestions = formData.questions.filter(
    (question) => !isSectionQuestion(question) && Boolean(question.includeInAnalysis),
  )
  const deliveryConfigQuestions = analysisQuestions.filter((question) => question.type === 'select')
  const visibleHistoryQuestions =
    historyShowAllQuestions
      ? analysisQuestions
      : analysisQuestions.filter((question) => selectedHistoryQuestionIds.includes(question.id))
  const locationOrder = availableLocations.map((location) => String(location.name || '').trim()).filter(Boolean)
  const parsedHistorySubmissionLimit = Math.max(1, Number.parseInt(historySubmissionLimit, 10) || 3)
  const historyByLocation = submissions
    .reduce((accumulator, submission) => {
      const location = getSubmissionLocation(submission.answers, formData.questions) || 'Ukjent lokasjon'
      const entry = accumulator.get(location) || []
      entry.push(submission)
      accumulator.set(location, entry)
      return accumulator
    }, new Map())
  const historyRows = Array.from(historyByLocation.entries())
    .map(([location, items]) => ({
      location,
      items: items
        .sort((a, b) => {
          const aSeconds = a.submittedAt?.seconds || 0
          const bSeconds = b.submittedAt?.seconds || 0
          return bSeconds - aSeconds
        })
        .slice(0, parsedHistorySubmissionLimit),
    }))
    .sort((a, b) => {
      const aIndex = locationOrder.indexOf(a.location)
      const bIndex = locationOrder.indexOf(b.location)
      if (aIndex !== -1 || bIndex !== -1) {
        if (aIndex === -1) {
          return 1
        }
        if (bIndex === -1) {
          return -1
        }
        return aIndex - bIndex
      }
      return a.location.localeCompare(b.location, 'nb')
    })
  const deliveryLocationNames = (() => {
    const namesFromLocations = availableLocations
      .map((location) => String(location.name || '').trim())
      .filter(Boolean)
    const namesFromHistory = historyRows.map((row) => row.location)
    const seen = new Set()

    return [...namesFromLocations, ...namesFromHistory].filter((name) => {
      if (seen.has(name)) {
        return false
      }
      seen.add(name)
      return true
    })
  })()
  const deliveryCards = deliveryLocationNames.map((locationName) => {
    const matchingHistoryRow = historyRows.find((row) => row.location === locationName)
    const latestSubmission = matchingHistoryRow?.items?.[0] || null
    const products = latestSubmission
      ? analysisQuestions
          .map((question) =>
            getDeliveryRecommendation(
              question,
              latestSubmission,
              getLocationDeliverySetting(locationName, availableLocations, activeFormSlug, question),
            ),
          )
          .filter(Boolean)
      : []

    return {
      location: locationName,
      city: getLocationCity(locationName, availableLocations),
      submission: latestSubmission,
      products,
      knownTotalUnits: products.reduce(
        (sum, product) =>
          sum + (typeof product.recommendedUnits === 'number' ? product.recommendedUnits : 0),
        0,
      ),
      hasUnlimitedProducts: products.some((product) => product.unlimited),
    }
  })
  const groupedDeliveryCards = Array.from(
    deliveryCards.reduce((accumulator, card) => {
      const key = card.city
      const existingGroup = accumulator.get(key) || {
        location: key,
        city: key,
        locations: [],
        submission: null,
        productsMap: new Map(),
        knownTotalUnits: 0,
        hasUnlimitedProducts: false,
      }

      existingGroup.locations.push(card.location)
      existingGroup.knownTotalUnits += card.knownTotalUnits
      existingGroup.hasUnlimitedProducts =
        existingGroup.hasUnlimitedProducts || card.hasUnlimitedProducts

      if (
        card.submission &&
        (!existingGroup.submission ||
          (card.submission.submittedAt?.seconds || 0) > (existingGroup.submission.submittedAt?.seconds || 0))
      ) {
        existingGroup.submission = card.submission
      }

      card.products.forEach((product) => {
        const currentProduct = existingGroup.productsMap.get(product.questionId) || {
          ...product,
          locations: [],
          locationEntries: [],
          recommendedUnits: 0,
          hasUnlimitedEntries: false,
          isOrdered: true,
          sourceEntries: [],
        }

        currentProduct.locations.push(card.location)
        currentProduct.locationEntries.push({
          location: card.location,
          currentValue: product.currentValue,
          currentCategory: product.currentCategory,
          targetValue: product.targetValue,
          maxUnits: product.maxUnits,
          unlimited: product.unlimited,
          recommendedUnits: product.recommendedUnits,
          isOrdered: product.isOrdered,
          sourceEntries: Array.isArray(product.sourceEntries) ? product.sourceEntries : [],
        })
        if (typeof product.recommendedUnits === 'number') {
          currentProduct.recommendedUnits += product.recommendedUnits
        } else {
          currentProduct.hasUnlimitedEntries = true
        }
        currentProduct.unlimited = currentProduct.hasUnlimitedEntries
        currentProduct.isOrdered = currentProduct.isOrdered && Boolean(product.isOrdered)
        currentProduct.sourceEntries = [
          ...currentProduct.sourceEntries,
          ...(Array.isArray(product.sourceEntries) ? product.sourceEntries : []),
        ]
        currentProduct.currentCategory =
          currentProduct.currentCategory === 'red' || product.currentCategory === 'red'
            ? 'red'
            : 'orange'

        existingGroup.productsMap.set(product.questionId, currentProduct)
      })

      accumulator.set(key, existingGroup)
      return accumulator
    }, new Map()),
  ).map(([, group]) => ({
    location: group.location,
    city: group.city,
    locations: group.locations.sort((a, b) => a.localeCompare(b, 'nb')),
    submission: group.submission,
    products: Array.from(group.productsMap.values()).map((product) => ({
      ...product,
      locationEntries: sortDeliveryLocationEntries(product.locationEntries),
    })),
    knownTotalUnits: group.knownTotalUnits,
    hasUnlimitedProducts: group.hasUnlimitedProducts,
  }))
  const groupedDeliveryCardsByProduct = groupedDeliveryCards.flatMap((card) =>
    card.products.map((product) => ({
      location: card.location,
      city: card.city,
      locations: card.locations,
      submission: card.submission,
      products: [product],
      knownTotalUnits: typeof product.recommendedUnits === 'number' ? product.recommendedUnits : 0,
      hasUnlimitedProducts: Boolean(product.unlimited),
    })),
  )
  const visibleDeliveryCards = sortDeliveryCards(
    deliveryGroupByNeighborhood
      ? deliveryGroupByProductPerCity
        ? groupedDeliveryCardsByProduct
        : groupedDeliveryCards
      : deliveryCards,
  )
  const deliveryCardRows = deliveryGroupByNeighborhood
    ? Array.from(
        visibleDeliveryCards.reduce((accumulator, card) => {
          const key = card.city || card.location
          const existingRow = accumulator.get(key) || {
            key,
            label: key,
            cards: [],
          }

          existingRow.cards.push(card)
          accumulator.set(key, existingRow)
          return accumulator
        }, new Map()).values(),
      )
    : []
  useEffect(() => {
    if (!deliveryGroupByNeighborhood && deliveryGroupByProductPerCity) {
      setDeliveryGroupByProductPerCity(false)
    }
  }, [deliveryGroupByNeighborhood, deliveryGroupByProductPerCity])

  useEffect(() => {
    const nextDefault = Math.max(1, Number.parseInt(formData.analysisDefaultSubmissionLimit, 10) || 3)
    setHistorySubmissionLimit(String(nextDefault))
  }, [formData.analysisDefaultSubmissionLimit])

  useEffect(() => {
    if (flaggedSubmissions.length === 0) {
      setFlaggedImageUrls({})
      return
    }

    if (missingFlaggedImagePaths.length === 0) {
      return
    }

    let cancelled = false
    Promise.all(
      missingFlaggedImagePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return [path, url]
        } catch {
          return [path, '']
        }
      }),
    ).then((pairs) => {
      if (cancelled) {
        return
      }

      setFlaggedImageUrls((previous) => ({
        ...previous,
        ...Object.fromEntries(pairs),
      }))
    })

    return () => {
      cancelled = true
    }
  }, [flaggedSubmissions, missingFlaggedImagePaths])
  const visibleHistoryRows =
    historyShowAllLocations
      ? historyRows
      : historyRows.filter((row) => selectedHistoryLocations.includes(row.location))
  const historySubmissionSlots = Array.from(
    { length: parsedHistorySubmissionLimit },
    (_, index) => index,
  )
  const receiptAnswerEntries = getOrderedAnswerEntries(receiptSubmission?.answers || {}, formData.questions)
  const receiptEditState = getReceiptEditState(receiptSubmission?.submittedAtIso)
  const heroEyebrow = isReceiptPage ? publicCopy.receiptEyebrow : publicCopy.formEyebrow
  const localizedFormTitle = translateText(formData.title)
  const localizedFormDescription = translateText(formData.description)
  const heroTitle = isReceiptPage
    ? `${publicCopy.receiptTitlePrefix} ${localizedFormTitle} ${publicCopy.receiptTitleSuffix}`
    : localizedFormTitle
  const heroLead = isReceiptPage
    ? publicCopy.receiptLead
    : localizedFormDescription
  const showPublicFacingHeader =
    !isSubmissionsView &&
    !isEditPage &&
    !isHistoryView &&
    !isFlaggedView &&
    !isReviewView &&
    !isDeliverySettingsView &&
    !isDeliveryView

  useEffect(() => {
    const validLocations = new Set(historyRows.map((row) => row.location))
    setSelectedHistoryLocations((previous) =>
      previous.filter((location) => validLocations.has(location)),
    )
  }, [historyRows])

  let publicQuestionOrder = 0

  function renderFlaggedSubmissionCard(submission, options = {}) {
    const flaggedState = flaggedActionState[submission.id] || {
      saving: false,
      error: '',
      message: '',
    }
    const isComplete = String(submission.flaggedStatus || '').trim().toLowerCase() === 'complete'
    const isReviewOpen = flaggedReviewOpenId === submission.id
    const isCollapsed = Boolean(flaggedCollapsedIds[submission.id])
    const isCollapsible = Boolean(options.collapsible)

    return (
      <article key={submission.id} className="response-card flagged-submission-card">
        {isCollapsible ? (
          <button
            type="button"
            className="ghost flagged-collapse-toggle"
            onClick={() => onToggleFlaggedCollapsed(submission.id)}
            aria-expanded={!isCollapsed}
          >
            <span>
              {getSubmissionLocation(submission.answers, formData.questions)} |{' '}
              {getSubmissionName(submission.answers, formData.questions)}
            </span>
            <span>{isCollapsed ? 'Vis ferdig vurdering' : 'Skjul ferdig vurdering'}</span>
          </button>
        ) : null}
        {!isCollapsed ? (
          <div className="flagged-panel-grid">
            <section className="flagged-panel flagged-info-panel">
              <h4>Info</h4>
              <div className="flagged-submission-meta">
                <p>
                  <strong>Vogn:</strong> {getSubmissionLocation(submission.answers, formData.questions)}
                </p>
                <p>
                  <strong>Navn:</strong> {getSubmissionName(submission.answers, formData.questions)}
                </p>
                <p>
                  <strong>Lokasjon:</strong> {getSubmissionPlace(submission.answers)}
                </p>
                <p>
                  <strong>Sendt inn:</strong> {formatTime(submission.submittedAt)}
                </p>
                <p>
                  <strong>Status:</strong>{' '}
                  <span className={`flagged-status-badge ${isComplete ? 'is-complete' : 'is-open'}`}>
                    {getFlaggedStatusLabel(submission.flaggedStatus)}
                  </span>
                </p>
              </div>
              <div className="flagged-action-topbar">
                {submission.receiptToken ? (
                  <a
                    className="ghost"
                    href={`/skjema/${activeFormSlug}/kvittering/${submission.receiptToken}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Vis kvittering
                  </a>
                ) : null}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onOpenFlaggedReview(submission)}
                >
                  Review
                </button>
              </div>
              <h4>Action gjort</h4>
              {submission.flaggedActionTaken ? (
                <div className="flagged-action-summary">
                  <p>
                    <strong>Action gjort:</strong> {submission.flaggedActionTaken}
                  </p>
                  <p>
                    <strong>Fullført av:</strong> {submission.flaggedCompletedBy || '-'}
                  </p>
                  <p>
                    <strong>Fullført:</strong> {formatTime(submission.flaggedCompletedAt)}
                  </p>
                </div>
              ) : (
                <p className="review-answer-value">Ingen action registrert ennå.</p>
              )}
              {isReviewOpen ? (
                <div className="flagged-action-box">
                  <label
                    className="field-block review-comment-field"
                    htmlFor={`flagged-action-${submission.id}`}
                  >
                    <span>Beskriv action gjort</span>
                    <textarea
                      id={`flagged-action-${submission.id}`}
                      rows={4}
                      value={flaggedActionDrafts[submission.id] || ''}
                      onChange={(event) =>
                        setFlaggedActionDrafts((previous) => ({
                          ...previous,
                          [submission.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="submission-table-actions">
                    <button
                      type="button"
                      className="cta"
                      onClick={() => onCompleteFlaggedSubmission(submission)}
                      disabled={flaggedState.saving}
                    >
                      {flaggedState.saving ? 'Lagrer...' : 'Set complete'}
                    </button>
                  </div>
                  {flaggedState.error ? <p className="forms-error">{flaggedState.error}</p> : null}
                  {flaggedState.message ? <p className="forms-success">{flaggedState.message}</p> : null}
                </div>
              ) : null}
            </section>

            <section className="flagged-panel flagged-content-panel">
              <h4>Flagget spørsmål</h4>
              <div className="flagged-answer-list">
                {(submission.flaggedAnswers || []).map((item) => {
                  const hasImagePath = isStorageImagePath(item.value)
                  const imageUrl = hasImagePath
                    ? String(item.imageUrl || flaggedImageUrls[item.value] || '')
                    : undefined

                  return (
                    <article key={`${submission.id}-${item.answerKey}`} className="flagged-answer-row">
                      <p className="review-answer-label">{item.label}</p>
                      {item.comment ? (
                        <p className="flagged-answer-comment">
                          <strong>Kommentar:</strong> {item.comment}
                        </p>
                      ) : null}
                      {hasImagePath ? (
                        imageUrl ? (
                          <img
                            className="flagged-answer-image"
                            src={imageUrl}
                            alt={item.label}
                            loading="lazy"
                          />
                        ) : typeof item.imageUrl === 'string' ||
                          typeof flaggedImageUrls[item.value] !== 'undefined' ? (
                          <p className="review-answer-value">Kunne ikke laste bilde.</p>
                        ) : (
                          <p className="review-answer-value">Laster bilde...</p>
                        )
                      ) : (
                        <p className="review-answer-value">{String(item.value || '-')}</p>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          </div>
        ) : null}
      </article>
    )
  }

  function renderDeliverySettingsPage() {
    return (
      <div className="delivery-settings-page">
        <div className="history-header">
          <div className="history-title-block">
            <h3>Lokasjonsinnstillinger</h3>
            <p className="history-legend">
              Sett mål og maks beholdning per lokasjon for produktene som brukes i leveringslisten.
            </p>
          </div>
          <div className="delivery-settings-actions">
            <a className="ghost" href={`/skjema/${activeFormSlug}/leveringsliste`}>
              Tilbake til leveringsliste
            </a>
            <button
              type="button"
              className="cta"
              onClick={onSaveDeliverySettings}
              disabled={deliverySettingsState.saving || loadingLocations || Boolean(availableLocationsError)}
            >
              {deliverySettingsState.saving ? 'Lagrer...' : 'Lagre innstillinger'}
            </button>
          </div>
        </div>

        {deliverySettingsState.error ? <p className="forms-error">{deliverySettingsState.error}</p> : null}
        {deliverySettingsState.message ? <p className="forms-success">{deliverySettingsState.message}</p> : null}
        {loadingLocations ? <p>Laster lokasjoner...</p> : null}
        {!loadingLocations && availableLocationsError ? (
          <p className="forms-error">{availableLocationsError}</p>
        ) : null}
        {!loadingLocations && !availableLocationsError && availableLocations.length === 0 ? (
          <p>Ingen lokasjoner funnet ennå. Sjekk `/lokasjoner`.</p>
        ) : null}
        {!loadingLocations &&
        !availableLocationsError &&
        availableLocations.length > 0 &&
        deliveryConfigQuestions.length === 0 ? (
          <p>Ingen valgfelt er merket med "Inkluder i analyse" ennå.</p>
        ) : null}

        {!loadingLocations &&
        !availableLocationsError &&
        availableLocations.length > 0 &&
        deliveryConfigQuestions.length > 0 ? (
          <div className="delivery-settings-list">
            {deliveryConfigQuestions.map((question) => (
              <article key={question.id} className="response-card delivery-settings-card">
                <div className="delivery-settings-card-header">
                  <div>
                    <h4>{question.analysisLabel || question.label}</h4>
                    <p>{question.label}</p>
                  </div>
                </div>
                <div className="location-delivery-settings">
                  <div className="location-delivery-settings-list">
                    {availableLocations.map((location) => {
                      const locationSetting = getEditorLocationSetting(location.id, question)

                      return (
                        <div key={`${question.id}-${location.id}`} className="location-delivery-setting-row">
                          <p className="location-delivery-setting-name">{location.name}</p>
                          <label
                            className="field-block"
                            htmlFor={`delivery-settings-target-${question.id}-${location.id}`}
                          >
                            <span>Mål</span>
                            <select
                              id={`delivery-settings-target-${question.id}-${location.id}`}
                              value={locationSetting.targetValue}
                              onChange={(event) =>
                                onEditorLocationSettingChange(
                                  location.id,
                                  question,
                                  'targetValue',
                                  event.target.value,
                                )
                              }
                            >
                              {(question.options || []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label
                            className="checkbox-inline"
                            htmlFor={`delivery-settings-unlimited-${question.id}-${location.id}`}
                          >
                            <input
                              id={`delivery-settings-unlimited-${question.id}-${location.id}`}
                              type="checkbox"
                              checked={Boolean(locationSetting.deliveryUnlimited)}
                              onChange={(event) =>
                                onEditorLocationSettingChange(
                                  location.id,
                                  question,
                                  'deliveryUnlimited',
                                  event.target.checked,
                                )
                              }
                            />
                            Ubegrenset
                          </label>
                          <label
                            className="field-block delivery-max-field"
                            htmlFor={`delivery-settings-max-${question.id}-${location.id}`}
                          >
                            <span>Maks antall</span>
                            <input
                              id={`delivery-settings-max-${question.id}-${location.id}`}
                              type="number"
                              min="1"
                              inputMode="numeric"
                              value={locationSetting.deliveryMaxUnits || ''}
                              disabled={Boolean(locationSetting.deliveryUnlimited)}
                              placeholder="f.eks. 40"
                              onChange={(event) =>
                                onEditorLocationSettingChange(
                                  location.id,
                                  question,
                                  'deliveryMaxUnits',
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={`forms-page stengeskjema-page ${isStandalonePublicForm ? 'public-form-page' : ''} ${
        isHistoryView || isDeliveryView || isDeliverySettingsView ? 'history-page' : ''
      }`}
    >
      {isSubmissionsView || isEditPage || isHistoryView || isFlaggedView || isReviewView || isDeliveryView || isDeliverySettingsView ? (
        <form action="/skjema" method="get">
          <button type="submit" className="admin-login-link">
            Tilbake til hovedmeny
          </button>
        </form>
      ) : !isStandalonePublicForm &&
        !isSubmissionsView &&
        !isEditPage &&
        !isHistoryView &&
        !isFlaggedView &&
        !isReviewView &&
        !isDeliverySettingsView &&
        !isDeliveryView ? (
        <form action="/skjema" method="get">
          <button type="submit" className="admin-login-link">
            Tilbake til alle skjema
          </button>
        </form>
      ) : null}
      {isReceiptPage && !isReceiptReady ? (
        <section className="form-entry">
          <p>{publicCopy.loadingReceipt}</p>
        </section>
      ) : isSubmissionEditMode && loadingReceipt ? (
        <section className="form-entry">
          <p>{publicCopy.loadingReceipt}</p>
        </section>
      ) : isSubmissionEditMode && receiptError ? (
        <section className="form-entry">
          <p className="forms-error">{receiptError}</p>
        </section>
      ) : !isSubmissionsView &&
        !isEditPage &&
        !isHistoryView &&
        !isFlaggedView &&
        !isReviewView &&
        !isReceiptPage &&
        !isPublicFormReady ? (
        <section className="form-entry">
          <p>{publicCopy.loadingForm}</p>
        </section>
      ) : (
        <>
          {showPublicFacingHeader ? (
            <header className="forms-hero">
              <p className="eyebrow">{heroEyebrow}</p>
              <h1>{heroTitle}</h1>
              <p className="lead">{heroLead}</p>
              <div className="public-form-language-bar">
                <span className="public-form-language-label">{publicCopy.languageLabel}</span>
                <div className="public-form-language-toggle" role="group" aria-label={publicCopy.languageLabel}>
                  <button
                    type="button"
                    className={displayLanguage === 'no' ? 'is-active' : ''}
                    onClick={() => setDisplayLanguage('no')}
                  >
                    {publicCopy.norwegian}
                  </button>
                  <button
                    type="button"
                    className={displayLanguage === 'en' ? 'is-active' : ''}
                    onClick={() => setDisplayLanguage('en')}
                  >
                    {publicCopy.english}
                  </button>
                </div>
              </div>
              {translationState.loading ? (
                <div className="public-form-translation-loader" role="status" aria-live="polite">
                  <div className="public-form-translation-spinner" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="public-form-translation-copy">
                    <strong>{publicCopy.translating}</strong>
                    <span>{publicCopy.translatingHint}</span>
                  </div>
                </div>
              ) : null}
              {translationState.error ? (
                <p className="public-form-language-status is-error">{translationState.error}</p>
              ) : null}
            </header>
          ) : null}

          {isReceiptPage ? (
            <section className="form-entry receipt-entry">
              {receiptError ? <p className="forms-error">{receiptError}</p> : null}
              {!receiptError && receiptSubmission ? (
                <>
                  <div className="receipt-meta">
                    <p>
                      <strong>{publicCopy.submissionLabel}:</strong> {receiptSubmission.submissionId || receiptSubmission.id}
                    </p>
                    <p>
                      <strong>{publicCopy.submittedLabel}:</strong>{' '}
                      {receiptSubmission.submittedAtIso
                        ? new Date(receiptSubmission.submittedAtIso).toLocaleString('nb-NO')
                        : '-'}
                    </p>
                    {receiptToken ? (
                      receiptEditState.allowed ? (
                        <p>
                          <a
                            className="ghost"
                            href={`/skjema/${activeFormSlug}?editReceipt=${receiptToken}`}
                          >
                            {publicCopy.editSubmission}
                          </a>
                        </p>
                      ) : (
                        <p>{publicCopy.editWindowExpired}</p>
                      )
                    ) : null}
                  </div>

                  <div className="receipt-answer-list">
                    {receiptAnswerEntries.map(([key, value]) => {
                      const imageUrl = isStorageImagePath(value)
                        ? receiptSubmission.imageUrls?.[value] || receiptImageUrls[value] || ''
                        : ''

                      return (
                        <article key={key} className="receipt-answer-row">
                          <p className="receipt-answer-label">
                            {translateText(
                              getAnswerDisplayLabel(key, receiptSubmission.answers, formData.questions),
                            )}
                          </p>
                          {imageUrl ? (
                            <img
                              className="receipt-answer-image"
                              src={imageUrl}
                              alt={translateText(
                                getAnswerDisplayLabel(
                                  key,
                                  receiptSubmission.answers,
                                  formData.questions,
                                ),
                              )}
                              loading="lazy"
                            />
                          ) : (
                            <p className="receipt-answer-value">
                              {isStorageImagePath(value) ? publicCopy.loadingImage : String(value || '-')}
                            </p>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </section>
          ) : !isSubmissionsView &&
            !isEditPage &&
            !isHistoryView &&
            !isFlaggedView &&
            !isReviewView &&
            !isDeliverySettingsView &&
            !isDeliveryView ? (
            <section className="form-entry">
              {isSubmissionEditMode ? <p className="field-help">{publicCopy.editingSubmission}</p> : null}
              <div className="form-entry-header">
                <button type="button" className="ghost reset-form-button" onClick={resetAllAnswers}>
                  {publicCopy.resetAnswers}
                </button>
              </div>
              <form key={formInstanceKey} onSubmit={onSubmit} className="dynamic-form">
                {visibleFormQuestions.map((question) =>
                  isSectionQuestion(question) ? (
                    <div key={question.id} className="form-section-block">
                      {renderSectionHeading(question)}
                    </div>
                  ) : (() => {
                      const stripeClass =
                        publicQuestionOrder % 2 === 0 ? 'is-striped-light' : 'is-striped-dark'
                      publicQuestionOrder += 1

                      return (
                        <label
                          key={question.id}
                          htmlFor={question.id}
                          className={`field-block form-question-block ${stripeClass} ${
                            isQuestionAnswered(question) ? 'is-answered' : ''
                          }`}
                        >
                          {renderQuestionLead(question)}
                          {renderQuestionInput(question)}
                        </label>
                      )
                    })(),
                )}

                {formData.enableSelfDeclaration ? (
                  <div
                    className={`self-declaration-box ${
                      selfDeclarationAccepted ? 'is-answered' : ''
                    }`}
                  >
                    <p className="self-declaration-text">
                      {translateText(formData.selfDeclarationText) || publicCopy.selfDeclarationFallback}
                    </p>
                    <label
                      className="checkbox-inline self-declaration-check"
                      htmlFor="self-declaration-checkbox"
                    >
                      <input
                        id="self-declaration-checkbox"
                        type="checkbox"
                        checked={selfDeclarationAccepted}
                        onChange={(event) => setSelfDeclarationAccepted(event.target.checked)}
                      />
                      {publicCopy.confirmSelfDeclaration}
                    </label>
                  </div>
                ) : null}

                {submitState.error ? <p className="forms-error">{submitState.error}</p> : null}

                <button
                  type="submit"
                  className="cta"
                  disabled={submitState.submitting || !isPublicFormReady}
                >
                  {submitState.submitting ? publicCopy.sendingForm : publicCopy.sendForm}
                </button>
              </form>
            </section>
          ) : null}

          {submitOverlay.open &&
          !isReceiptPage &&
          !isSubmissionsView &&
          !isEditPage &&
          !isFlaggedView &&
          !isReviewView ? (
            <div className="submit-overlay" role="status" aria-live="polite" aria-busy={submitOverlay.status === 'submitting'}>
              <div className={`submit-overlay-card is-${submitOverlay.status}`}>
                {submitOverlay.status === 'submitting' ? (
                  <>
                    <div className="submit-overlay-spinner" aria-hidden="true" />
                    <p>{publicCopy.sendingForm}</p>
                  </>
                ) : (
                  <>
                    <div className="submit-overlay-check" aria-hidden="true">
                      ✓
                    </div>
                    <p>{publicCopy.formSent}</p>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      {(isEditPage ||
        isSubmissionsView ||
        isHistoryView ||
        isFlaggedView ||
        isReviewView ||
        isDeliveryView ||
        isDeliverySettingsView) &&
      !isAdmin &&
      !loading ? (
        <section className="admin-login-line">
          <p className="forms-error">Kun admin har tilgang til denne siden.</p>
        </section>
      ) : null}

      {isAdmin && (isSubmissionsView || isEditPage || isHistoryView || isFlaggedView || isReviewView || isDeliveryView || isDeliverySettingsView) ? (
        <section className={isEditPage || isSubmissionsView || isHistoryView || isFlaggedView || isReviewView || isDeliveryView || isDeliverySettingsView ? 'admin-edit-shell' : 'admin-box'}>
          {loading ? <p>Kontrollerer innlogging...</p> : null}
          {error ? <p className="forms-error">{error}</p> : null}

            {isDeliverySettingsView ? (
              renderDeliverySettingsPage()
            ) : isEditPage ? (
              <div className="admin-editor">
                <h3>Rediger skjema</h3>
                <label className="field-block" htmlFor="editor-title">
                  <span>Tittel</span>
                  <input
                    id="editor-title"
                    type="text"
                    value={editorTitle}
                    onChange={(event) => setEditorTitle(event.target.value)}
                  />
                </label>

                <label className="field-block" htmlFor="editor-description">
                  <span>Beskrivelse</span>
                  <textarea
                    id="editor-description"
                    rows={3}
                    value={editorDescription}
                    onChange={(event) => setEditorDescription(event.target.value)}
                  />
                </label>

                <label className="checkbox-inline" htmlFor="editor-include-submission-datetime">
                  <input
                    id="editor-include-submission-datetime"
                    type="checkbox"
                    checked={editorIncludeSubmissionDateTime}
                    onChange={(event) => setEditorIncludeSubmissionDateTime(event.target.checked)}
                  />
                  Send med innsendingstidspunkt (dag og tid)
                </label>

                <label className="checkbox-inline" htmlFor="editor-enable-self-declaration">
                  <input
                    id="editor-enable-self-declaration"
                    type="checkbox"
                    checked={editorEnableSelfDeclaration}
                    onChange={(event) => setEditorEnableSelfDeclaration(event.target.checked)}
                  />
                  Legg til egenerklæring nederst i skjemaet
                </label>

                {editorEnableSelfDeclaration ? (
                  <label className="field-block" htmlFor="editor-self-declaration-text">
                    <span>Egenerklæringstekst</span>
                    <textarea
                      id="editor-self-declaration-text"
                      rows={3}
                      value={editorSelfDeclarationText}
                      onChange={(event) => setEditorSelfDeclarationText(event.target.value)}
                    />
                  </label>
                ) : null}

                <div className="admin-actions">
                  <button
                    type="button"
                    className="cta"
                    onClick={onSaveForm}
                    disabled={saveState.saving}
                  >
                    {saveState.saving ? 'Lagrer...' : 'Lagre skjema'}
                  </button>
                </div>

                <div className="editor-questions">
                  {editorQuestions.map((question, index) => (
                    <article key={`${question.id}-${index}`} className="editor-question-card">
                      <p>Spørsmål {index + 1}</p>
                      <div className="editor-question-layout">
                        <div className="editor-question-content">
                          <div
                            className={`editor-question-row editor-question-main-row${
                              isSectionQuestion(question) ? ' is-section-question' : ''
                            }`}
                          >
                            <label className="field-block" htmlFor={`q-label-${index}`}>
                              <span>Tekst</span>
                              <input
                                id={`q-label-${index}`}
                                type="text"
                                value={question.label}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'label', event.target.value)
                                }
                              />
                            </label>

                            <label className="field-block" htmlFor={`q-type-${index}`}>
                              <span>Type</span>
                              <select
                                id={`q-type-${index}`}
                                value={question.type}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'type', event.target.value)
                                }
                              >
                                <option value="text">Tekst</option>
                                <option value="textarea">Lang tekst</option>
                                <option value="select">Valg</option>
                                <option value="location">Lokasjon</option>
                                <option value="number">Tall</option>
                                <option value="date">Dato</option>
                                <option value="camera">Ta bilde fra kamera</option>
                                <option value="name">User's name</option>
                                <option value="email">E-post</option>
                                <option value="section">Kategori</option>
                              </select>
                            </label>
                            <label className="field-block" htmlFor={`q-image-${index}`}>
                              <span>Bilde (valgfritt)</span>
                              <input
                                id={`q-image-${index}`}
                                type="file"
                                accept="image/*"
                                onChange={async (event) => {
                                  const file = event.target.files?.[0] || null
                                  try {
                                    await onEditorQuestionImageChange(index, file)
                                  } catch {
                                    setSaveState({
                                      saving: false,
                                      message: '',
                                      error: 'Kunne ikke lese bildet. Prøv en annen fil.',
                                    })
                                  } finally {
                                    event.target.value = ''
                                  }
                                }}
                              />
                            </label>

                            <label className="field-block" htmlFor={`q-placeholder-${index}`}>
                              <span>
                                {isSectionQuestion(question) ? 'Hjelpetekst under kategori' : 'Hjelpetekst'}
                              </span>
                              <input
                                id={`q-placeholder-${index}`}
                                type="text"
                                value={question.placeholder || ''}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'placeholder', event.target.value)
                                }
                              />
                            </label>

                            {isSectionQuestion(question) ? (
                              <>
                                <label className="field-block" htmlFor={`q-helptext-color-${index}`}>
                                  <span>Hjelpetekst-farge</span>
                                  <input
                                    id={`q-helptext-color-${index}`}
                                    type="color"
                                    value={question.helpTextColor || '#5f4c3f'}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'helpTextColor', event.target.value)
                                    }
                                  />
                                </label>

                                <label
                                  className="checkbox-inline editor-main-row-checkbox"
                                  htmlFor={`q-helptext-bold-${index}`}
                                >
                                  <input
                                    id={`q-helptext-bold-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.helpTextBold)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'helpTextBold', event.target.checked)
                                    }
                                  />
                                  Hjelpetekst i bold
                                </label>
                              </>
                            ) : null}
                          </div>

                          {question.type === 'select' ? (
                            <>
                              <label className="field-block" htmlFor={`q-options-${index}`}>
                                <span>Valg (kommaseparert)</span>
                                <input
                                  id={`q-options-${index}`}
                                  type="text"
                                  value={question.optionsText || ''}
                                  onChange={(event) =>
                                    onEditorQuestionChange(index, 'options', event.target.value)
                                  }
                                />
                              </label>
                              <div className="select-option-detail-list">
                                {(question.options || []).map((option) => {
                                  const optionDetail = getSelectOptionBehavior(question, option)
                                  const hasDetail = optionDetail.kind !== 'none'

                                  return (
                                    <div key={`${question.id}-${option}`} className="select-option-detail-row">
                                      <div className="select-option-detail-head">
                                        <p className="select-option-detail-label">{option}</p>
                                        <label
                                          className="select-option-category-inline"
                                          htmlFor={`q-select-category-${index}-${option}`}
                                        >
                                          <span>Kategori:</span>
                                          <select
                                            id={`q-select-category-${index}-${option}`}
                                            value={optionDetail.historyCategory || 'normal'}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'historyCategory',
                                                event.target.value,
                                              )
                                            }
                                          >
                                            <option value="normal">Vanlig</option>
                                            <option value="orange">Oransje</option>
                                            <option value="red">Rød</option>
                                          </select>
                                        </label>
                                        <label
                                          className="checkbox-inline select-option-detail-toggle"
                                          htmlFor={`q-select-detail-toggle-${index}-${option}`}
                                        >
                                          <input
                                            id={`q-select-detail-toggle-${index}-${option}`}
                                            type="checkbox"
                                            checked={hasDetail}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'kind',
                                                event.target.checked ? 'input' : 'none',
                                              )
                                            }
                                          />
                                          Utdypning
                                        </label>
                                      </div>
                                      {hasDetail ? (
                                        <label
                                          className="field-block"
                                          htmlFor={`q-select-detail-kind-${index}-${option}`}
                                        >
                                          <span>Type</span>
                                          <select
                                            id={`q-select-detail-kind-${index}-${option}`}
                                            value={optionDetail.kind}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'kind',
                                                event.target.value,
                                              )
                                            }
                                          >
                                            <option value="input">Inputfelt</option>
                                            <option value="message">Beskjed</option>
                                            <option value="camera">Bilde</option>
                                          </select>
                                        </label>
                                      ) : null}
                                      {hasDetail ? (
                                        <label
                                          className="field-block"
                                          htmlFor={`q-select-detail-text-${index}-${option}`}
                                        >
                                          <span>
                                            {optionDetail.kind === 'input'
                                              ? 'Prompt'
                                              : optionDetail.kind === 'camera'
                                                ? 'Beskrivelse'
                                                : 'Beskjed'}
                                          </span>
                                          <input
                                            id={`q-select-detail-text-${index}-${option}`}
                                            type="text"
                                            value={optionDetail.text}
                                            onChange={(event) =>
                                              onEditorSelectOptionDetailChange(
                                                index,
                                                option,
                                                'text',
                                                event.target.value,
                                              )
                                            }
                                          />
                                        </label>
                                      ) : null}
                                      {hasDetail && optionDetail.kind === 'message' ? (
                                        <div className="editor-question-row helptext-style-row">
                                          <label
                                            className="field-block"
                                            htmlFor={`q-select-detail-color-${index}-${option}`}
                                          >
                                            <span>Farge</span>
                                            <input
                                              id={`q-select-detail-color-${index}-${option}`}
                                              type="color"
                                              value={optionDetail.messageColor || '#5f4c3f'}
                                              onChange={(event) =>
                                                onEditorSelectOptionDetailChange(
                                                  index,
                                                  option,
                                                  'messageColor',
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </label>

                                          <label
                                            className="checkbox-inline"
                                            htmlFor={`q-select-detail-bold-${index}-${option}`}
                                          >
                                            <input
                                              id={`q-select-detail-bold-${index}-${option}`}
                                              type="checkbox"
                                              checked={Boolean(optionDetail.messageBold)}
                                              onChange={(event) =>
                                                onEditorSelectOptionDetailChange(
                                                  index,
                                                  option,
                                                  'messageBold',
                                                  event.target.checked,
                                                )
                                              }
                                            />
                                            Beskjed i bold
                                          </label>
                                        </div>
                                      ) : null}
                                    </div>
                                  )
                                })}
                              </div>
                            </>
                          ) : null}

                          {!isSectionQuestion(question) ? (
                            <div className="editor-settings-table">
                              <div className="editor-settings-toggle-row">
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-required-${index}`}
                                >
                                  <input
                                    id={`q-required-${index}`}
                                    type="checkbox"
                                    checked={question.required}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'required', event.target.checked)
                                    }
                                  />
                                  Obligatorisk
                                </label>
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-analysis-${index}`}
                                >
                                  <input
                                    id={`q-analysis-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.includeInAnalysis)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'includeInAnalysis', event.target.checked)
                                    }
                                  />
                                  Inkluder i analyse
                                </label>
                                <label
                                  className="checkbox-inline editor-settings-toggle-cell"
                                  htmlFor={`q-review-${index}`}
                                >
                                  <input
                                    id={`q-review-${index}`}
                                    type="checkbox"
                                    checked={Boolean(question.includeInReview)}
                                    onChange={(event) =>
                                      onEditorQuestionChange(index, 'includeInReview', event.target.checked)
                                    }
                                  />
                                  Skal vurderes
                                </label>
                              </div>
                              <div className="editor-settings-detail-row">
                                <div
                                  className={`editor-settings-detail-cell${
                                    question.type === 'location' ? ' editor-settings-detail-empty' : ''
                                  }`}
                                >
                                  {question.type !== 'location' ? (
                                    <div className="question-location-visibility-settings">
                                      <p className="question-location-visibility-title">
                                        Vis kun for lokasjoner
                                      </p>
                                      {loadingLocations ? (
                                        <p className="field-help">Laster lokasjoner...</p>
                                      ) : availableLocationsError ? (
                                        <p className="field-help forms-error">{availableLocationsError}</p>
                                      ) : availableLocations.length > 0 ? (
                                        <div className="question-location-visibility-list">
                                          {availableLocations.map((location) => {
                                            const locationName = String(location.name || '').trim()
                                            if (!locationName) {
                                              return null
                                            }

                                            return (
                                              <label
                                                key={`${question.id}-visible-location-${location.id}`}
                                                className="checkbox-inline question-location-visibility-option"
                                                htmlFor={`q-visible-location-${index}-${location.id}`}
                                              >
                                                <input
                                                  id={`q-visible-location-${index}-${location.id}`}
                                                  type="checkbox"
                                                  checked={normalizeVisibleForLocations(
                                                    question.visibleForLocations,
                                                  ).includes(locationName)}
                                                  onChange={(event) =>
                                                    onEditorQuestionVisibleLocationChange(
                                                      index,
                                                      locationName,
                                                      event.target.checked,
                                                    )
                                                  }
                                                />
                                                {locationName}
                                              </label>
                                            )
                                          })}
                                        </div>
                                      ) : (
                                        <p className="field-help">
                                          Ingen lokasjoner funnet ennå. Sjekk /lokasjoner.
                                        </p>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="field-help">Lokasjonsspørsmålet vises alltid.</p>
                                  )}
                                </div>
                                <div className="editor-settings-detail-cell">
                                  {question.includeInAnalysis ? (
                                    <div className="editor-settings-detail-stack">
                                      <label
                                        className="field-block analysis-label-field"
                                        htmlFor={`q-analysis-label-${index}`}
                                      >
                                        <span>Kort tekst i analyse</span>
                                        <input
                                          id={`q-analysis-label-${index}`}
                                          type="text"
                                          value={question.analysisLabel || ''}
                                          placeholder={question.label}
                                          onChange={(event) =>
                                            onEditorQuestionChange(index, 'analysisLabel', event.target.value)
                                          }
                                        />
                                      </label>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="editor-settings-detail-cell">
                                  {question.includeInReview ? (
                                    <label
                                      className="field-block"
                                      htmlFor={`q-review-help-${index}`}
                                    >
                                      <span>Info til vurdering</span>
                                      <input
                                        id={`q-review-help-${index}`}
                                        type="text"
                                        value={question.reviewHelpText || ''}
                                        onChange={(event) =>
                                          onEditorQuestionChange(index, 'reviewHelpText', event.target.value)
                                        }
                                      />
                                    </label>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <p className="field-help">
                              Kategorien vises som en overskrift mellom spørsmålsboksene i skjemaet.
                            </p>
                          )}

                          <div className="question-action-row">
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => removeQuestion(index)}
                              disabled={editorQuestions.length <= 1}
                            >
                              Fjern spørsmål
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => duplicateQuestion(index)}
                            >
                              Dupliser spørsmål
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => insertQuestionAfter(index)}
                            >
                              Legg til spørsmål under
                            </button>
                            <button
                              type="button"
                              className="cta save-question-button"
                              onClick={() => onSaveForm(index)}
                              disabled={saveState.saving}
                            >
                              {saveState.saving ? 'Lagrer...' : 'Lagre spørsmål'}
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => moveQuestion(index, 'up')}
                              disabled={index === 0}
                            >
                              Opp
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => moveQuestion(index, 'down')}
                              disabled={index === editorQuestions.length - 1}
                            >
                              Ned
                            </button>
                            <label className="field-block" htmlFor={`q-move-target-${index}`}>
                              <input
                                id={`q-move-target-${index}`}
                                type="number"
                                min="1"
                                max={editorQuestions.length}
                                inputMode="numeric"
                                placeholder={`Flytt til spørsmål (1-${editorQuestions.length})`}
                                value={question.moveTarget || ''}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'moveTarget', event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key !== 'Enter') {
                                    return
                                  }
                                  event.preventDefault()
                                  moveQuestionToNumber(index, question.moveTarget)
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => moveQuestionToNumber(index, question.moveTarget)}
                              disabled={!String(question.moveTarget || '').trim()}
                            >
                              Flytt
                            </button>
                          </div>
                        </div>

                        <aside className="editor-question-sidebar">
                          {question.imagePreviewUrl ? (
                            <div className="question-image-preview editor-question-preview-panel">
                              {renderQuestionImage(
                                question.imagePreviewUrl,
                                question.label,
                                question.imageZoom,
                                true,
                              )}
                              <label
                                className="field-block image-zoom-field"
                                htmlFor={`q-image-zoom-${index}`}
                              >
                                <span>Bildezoom ({normalizeImageZoom(question.imageZoom).toFixed(2)}x)</span>
                                <input
                                  id={`q-image-zoom-${index}`}
                                  type="range"
                                  min="0.5"
                                  max="2.5"
                                  step="0.05"
                                  value={normalizeImageZoom(question.imageZoom)}
                                  onChange={(event) =>
                                    onEditorQuestionChange(index, 'imageZoom', event.target.value)
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => removeEditorQuestionImage(index)}
                              >
                                Fjern bilde
                              </button>
                            </div>
                          ) : (
                            <div className="editor-question-preview-panel editor-question-preview-empty">
                              <p className="field-help">
                                {isSectionQuestion(question)
                                  ? 'Ingen bilde valgt for denne kategorien.'
                                  : 'Ingen bilde valgt for dette spørsmålet.'}
                              </p>
                            </div>
                          )}
                        </aside>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="admin-actions">
                  <button type="button" className="ghost" onClick={addQuestion}>
                    Legg til spørsmål
                  </button>
                  <button type="button" className="ghost" onClick={addSection}>
                    Legg til kategori
                  </button>
                </div>

                {saveState.error ? <p className="forms-error">{saveState.error}</p> : null}
                {saveState.message ? <p className="forms-success">{saveState.message}</p> : null}
              </div>
            ) : null}

            {isSubmissionsView ? (
              <div className="responses-box submissions-overview" id="submissions-section">
                <h3>Submissions</h3>
                {loadingSubmissions ? <p>Loading submissions...</p> : null}
                {!loadingSubmissions && availableSubmissionDays.length > 0 ? (
                  <div className="submissions-filter-bar">
                    <label className="field-block" htmlFor="submission-day-filter">
                      <span>Day</span>
                      <select
                        id="submission-day-filter"
                        value={selectedSubmissionDay}
                        onChange={(event) => setSelectedSubmissionDay(event.target.value)}
                      >
                        {availableSubmissionDays.map((dayKey) => (
                          <option key={dayKey} value={dayKey}>
                            {formatSubmissionDayLabel(dayKey)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                {!loadingSubmissions && submissions.length === 0 ? (
                  <p>No submissions yet.</p>
                ) : null}
                {!loadingSubmissions && submissions.length > 0 && visibleSubmissions.length === 0 ? (
                  <p>No submissions for the selected day.</p>
                ) : null}
                {!loadingSubmissions && visibleSubmissions.length > 0 ? (
                  <div className="submissions-table-wrap">
                    <table className="submissions-table">
                      <thead>
                        <tr>
                          <th>Submitted</th>
                          <th>Location</th>
                          <th>Name</th>
                          <th>Receipt</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSubmissions.map((submission) => {
                          const deleteState = deleteSubmissionState[submission.id] || {}
                          const flaggedCount = Array.isArray(submission.flaggedAnswers)
                            ? submission.flaggedAnswers.length
                            : 0

                          return (
                            <tr key={submission.id}>
                              <td>
                                <strong>{getClockPart(submission.submittedAt)}</strong>
                                <br />
                                <small>
                                  {formatSubmissionDayLabel(
                                    getSubmissionDayKey(submission.submittedAt),
                                  )}
                                </small>
                              </td>
                              <td>{getSubmissionLocation(submission.answers, formData.questions)}</td>
                              <td>{getSubmissionName(submission.answers, formData.questions)}</td>
                              <td>
                                {submission.receiptToken ? (
                                  <a
                                    className="ghost"
                                    href={`/skjema/${activeFormSlug}/kvittering/${submission.receiptToken}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    View receipt
                                  </a>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td>
                                <div className="submission-status-row">
                                  <span
                                    className={`submission-status-badge is-${String(
                                      submission.status || 'awaiting-review',
                                    )
                                      .replace(/\s+/g, '-')
                                      .toLowerCase()}`}
                                  >
                                    {getSubmissionStatusLabel(submission.status)}
                                  </span>
                                  {flaggedCount > 0 ? (
                                    <span className="submission-status-badge is-flagged">
                                      Flagged
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td>
                                <div className="submission-table-actions">
                                  <a
                                    className="ghost"
                                    href={`/skjema/${activeFormSlug}/review/${submission.id}`}
                                  >
                                    Review
                                  </a>
                                  <button
                                    type="button"
                                    className="ghost danger-button"
                                    onClick={() => onDeleteSubmission(submission.id)}
                                    disabled={deleteState.deleting}
                                  >
                                    {deleteState.deleting ? 'Deleting...' : 'Delete'}
                                  </button>
                                  {deleteState.error ? (
                                    <small className="forms-error">{deleteState.error}</small>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

              </div>
            ) : null}

            {isFlaggedView ? (
              <div className="responses-box submissions-overview" id="flagged-section">
                <h3>Flagget</h3>
                {loadingSubmissions ? <p>Laster flaggede svar...</p> : null}
                {!loadingSubmissions && flaggedSubmissions.length === 0 ? (
                  <p>Ingen flaggede svar ennå.</p>
                ) : null}
                {!loadingSubmissions && flaggedSubmissions.length > 0 && openFlaggedSubmissions.length === 0 ? (
                  <p className="flagged-empty-note">Ingen venter oppfølging. Alle flaggede saker er ferdig vurdert.</p>
                ) : null}
                {!loadingSubmissions && flaggedSubmissions.length > 0 ? (
                  <div className="flagged-submission-list">
                    {openFlaggedSubmissions.map((submission) => renderFlaggedSubmissionCard(submission))}
                    {completedFlaggedSubmissions.map((submission) =>
                      renderFlaggedSubmissionCard(submission, { collapsible: true }),
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isHistoryView ? (
              <div className="history-overview" id="history-section">
                <div className="history-header">
                  <div className="history-title-block">
                    <h3>Analyse</h3>
                    <p className="history-legend">
                      <strong>Oransje:</strong> Bestill opp mer.{' '}
                      <strong>Rød:</strong> Nesten helt tomt.
                    </p>
                  </div>
                  <div className="history-controls">
                    <label className="field-block history-days-field history-days-inline" htmlFor="history-submission-limit">
                      <span>Vis siste innsendinger</span>
                      <input
                        id="history-submission-limit"
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={historySubmissionLimit}
                        onChange={(event) => setHistorySubmissionLimit(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="ghost"
                      onClick={onSaveHistoryDefault}
                      disabled={historyDefaultState.saving}
                    >
                      {historyDefaultState.saving ? 'Lagrer...' : 'Lagre default'}
                    </button>
                    {historyRows.length > 0 ? (
                      <div className="history-filter-bar">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setHistoryLocationFilterOpen((previous) => !previous)}
                          aria-expanded={historyLocationFilterOpen}
                          aria-controls="history-location-filter"
                        >
                          Filtrer lokasjoner
                          {!historyShowAllLocations && selectedHistoryLocations.length > 0
                            ? ` (${selectedHistoryLocations.length})`
                            : ''}
                        </button>
                        {historyLocationFilterOpen ? (
                          <div className="history-filter-panel" id="history-location-filter">
                            <div className="history-filter-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllLocations(true)
                                  setSelectedHistoryLocations([])
                                }}
                              >
                                Vis alle
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllLocations(false)
                                  setSelectedHistoryLocations([])
                                }}
                              >
                                Fjern alle
                              </button>
                            </div>
                            {historyRows.map((row) => (
                              <label
                                key={`history-location-filter-${row.location}`}
                                className="checkbox-inline history-filter-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    historyShowAllLocations ||
                                    selectedHistoryLocations.includes(row.location)
                                  }
                                  onChange={(event) => {
                                    setSelectedHistoryLocations((previous) => {
                                      const allLocations = historyRows.map((item) => item.location)
                                      const base = historyShowAllLocations ? allLocations : previous

                                      if (event.target.checked) {
                                        const next = base.includes(row.location)
                                          ? base
                                          : [...base, row.location]
                                        setHistoryShowAllLocations(next.length === allLocations.length)
                                        return next
                                      }

                                      const next = base.filter((location) => location !== row.location)
                                      setHistoryShowAllLocations(false)
                                      return next
                                    })
                                  }}
                                />
                                {row.location}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {analysisQuestions.length > 0 ? (
                      <div className="history-filter-bar">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setHistoryQuestionFilterOpen((previous) => !previous)}
                          aria-expanded={historyQuestionFilterOpen}
                          aria-controls="history-question-filter"
                        >
                          Filtrer spørsmål
                          {!historyShowAllQuestions && selectedHistoryQuestionIds.length > 0
                            ? ` (${selectedHistoryQuestionIds.length})`
                            : ''}
                        </button>
                        {historyQuestionFilterOpen ? (
                          <div className="history-filter-panel" id="history-question-filter">
                            <div className="history-filter-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllQuestions(true)
                                  setSelectedHistoryQuestionIds([])
                                }}
                              >
                                Vis alle
                              </button>
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setHistoryShowAllQuestions(false)
                                  setSelectedHistoryQuestionIds([])
                                }}
                              >
                                Fjern alle
                              </button>
                            </div>
                            {analysisQuestions.map((question) => (
                              <label
                                key={`history-filter-${question.id}`}
                                className="checkbox-inline history-filter-option"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    historyShowAllQuestions ||
                                    selectedHistoryQuestionIds.includes(question.id)
                                  }
                                  onChange={(event) => {
                                    setSelectedHistoryQuestionIds((previous) => {
                                      const allIds = analysisQuestions.map((item) => item.id)
                                      const base = historyShowAllQuestions ? allIds : previous

                                      if (event.target.checked) {
                                        const next = base.includes(question.id)
                                          ? base
                                          : [...base, question.id]
                                        setHistoryShowAllQuestions(next.length === allIds.length)
                                        return next
                                      }

                                      const next = base.filter((questionId) => questionId !== question.id)
                                      setHistoryShowAllQuestions(false)
                                      return next
                                    })
                                  }}
                                />
                                {question.analysisLabel || question.label}
                              </label>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                {historyDefaultState.error ? <p className="forms-error">{historyDefaultState.error}</p> : null}
                {historyDefaultState.message ? <p className="forms-success">{historyDefaultState.message}</p> : null}
                {loadingSubmissions ? <p>Laster analyse...</p> : null}
                {!loadingSubmissions && analysisQuestions.length === 0 ? (
                  <p>Ingen spørsmål er merket med "Inkluder i analyse" ennå.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && historyRows.length === 0 ? (
                  <p>Ingen innsendinger ennå.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && visibleHistoryRows.length > 0 ? (
                  <div className="history-table-wrap">
                    <table className="history-table">
                      <thead>
                        <tr>
                          <th rowSpan={2}>Spørsmål</th>
                          {visibleHistoryRows.map((row) => (
                            <th
                              key={`history-location-${row.location}`}
                              colSpan={historySubmissionSlots.length}
                              className="history-location-heading"
                            >
                              {row.location}
                            </th>
                          ))}
                        </tr>
                        <tr>
                          {visibleHistoryRows.flatMap((row) =>
                            historySubmissionSlots.map((slotIndex) => {
                              const submission = row.items[slotIndex]
                              return (
                                <th
                                  key={`${row.location}-slot-${slotIndex}`}
                                  className={slotIndex === 0 ? 'history-current-column' : ''}
                                >
                                  <div className="history-cell-meta">
                                    <strong>{slotIndex === 0 ? 'Nyeste' : `${slotIndex + 1}`}</strong>
                                    <small>
                                      {submission ? getDatePart(submission.submittedAt) : '-'}
                                    </small>
                                    <small>
                                      {submission ? getClockPart(submission.submittedAt) : '-'}
                                    </small>
                                  </div>
                                </th>
                              )
                            }),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleHistoryQuestions.map((question) => (
                          <tr key={`history-question-${question.id}`}>
                            <th scope="row">{question.analysisLabel || question.label}</th>
                            {visibleHistoryRows.flatMap((row) =>
                              historySubmissionSlots.map((slotIndex) => {
                                const submission = row.items[slotIndex]
                                const values = submission
                                  ? getHistoryAnswerValues(submission, question)
                                  : []
                                const historyCellCategory = submission
                                  ? getHistoryCellCategory(question, submission)
                                  : ''
                                const analysisStateKey =
                                  submission?.id && question?.id
                                    ? `${submission.id}:${question.id}`
                                    : ''
                                const analysisCellState = analysisStateKey
                                  ? analysisActionState[analysisStateKey] || {
                                      saving: false,
                                      error: '',
                                    }
                                  : { saving: false, error: '' }
                                const hasRefillAction = submission
                                  ? hasAnalysisRefillAction(submission, question.id)
                                  : false
                                const showRefillAction =
                                  Boolean(submission) &&
                                  slotIndex === 0 &&
                                  (
                                    historyCellCategory === 'orange' ||
                                    historyCellCategory === 'red' ||
                                    hasRefillAction
                                  )

                                return (
                                  <td
                                    key={`${row.location}-${question.id}-${slotIndex}`}
                                    className={`history-cell ${
                                      slotIndex === 0 ? 'history-current-column' : ''
                                    } ${
                                      slotIndex === 0 && historyCellCategory === 'red'
                                        ? 'history-current-column-red'
                                        : ''
                                    }`}
                                  >
                                    <div className="history-cell-content">
                                      {values.length > 0 ? (
                                        <span
                                          className={`history-cell-value ${
                                            historyCellCategory
                                              ? `history-cell-value-${historyCellCategory}`
                                              : ''
                                          }`}
                                        >
                                          {values.join(' | ')}
                                        </span>
                                      ) : (
                                        <span className="history-empty-cell">-</span>
                                      )}
                                      {showRefillAction ? (
                                        hasRefillAction ? (
                                          <label
                                            className="history-cell-checkbox-wrap"
                                            aria-label="Nullstill påfylling"
                                            title="Nullstill påfylling"
                                          >
                                            <input
                                              type="checkbox"
                                              className="history-cell-checkbox"
                                              checked
                                              disabled={analysisCellState.saving}
                                              onChange={() => onResetAnalysisRefill(submission, question)}
                                            />
                                          </label>
                                        ) : (
                                          <button
                                            type="button"
                                            className="ghost history-cell-action"
                                            onClick={() => onMarkAnalysisRefill(submission, question)}
                                            disabled={analysisCellState.saving}
                                            aria-label="Marker påfylling"
                                            title="Marker påfylling"
                                          >
                                            {analysisCellState.saving ? '...' : '+'}
                                          </button>
                                        )
                                      ) : null}
                                    </div>
                                    {analysisCellState.error ? (
                                      <p className="history-cell-error">{analysisCellState.error}</p>
                                    ) : null}
                                  </td>
                                )
                              }),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {!loadingSubmissions &&
                analysisQuestions.length > 0 &&
                historyRows.length > 0 &&
                visibleHistoryRows.length === 0 ? (
                  <p>Ingen lokasjoner er valgt i filteret.</p>
                ) : null}
                {!loadingSubmissions &&
                analysisQuestions.length > 0 &&
                visibleHistoryRows.length > 0 &&
                visibleHistoryQuestions.length === 0 ? (
                  <p>Ingen spørsmål er valgt i filteret.</p>
                ) : null}
              </div>
            ) : null}

            {isDeliveryView ? (
              <div className="delivery-overview" id="delivery-section">
                <div className="history-header">
                  <div className="history-title-block">
                    <h3>Leverings-/bestillingsliste</h3>
                    <p className="history-legend">
                      Basert på siste innsending per lokasjon og første normale nivå for hvert produkt.
                    </p>
                  </div>
                  <div className="delivery-controls">
                    <a
                      className="ghost"
                      href={`/skjema/${activeFormSlug}/leveringsliste/innstillinger`}
                    >
                      Lokasjonsinnstillinger
                    </a>
                    <div className="delivery-toggle-row">
                      <label className="checkbox-inline delivery-group-toggle">
                        <input
                          type="checkbox"
                          checked={deliveryGroupByNeighborhood}
                          onChange={(event) => {
                            const isChecked = event.target.checked
                            setDeliveryGroupByNeighborhood(isChecked)
                            if (!isChecked) {
                              setDeliveryGroupByProductPerCity(false)
                            }
                          }}
                        />
                        Samle per by
                      </label>
                      <label className="checkbox-inline delivery-group-toggle">
                        <input
                          type="checkbox"
                          checked={deliveryGroupByProductPerCity}
                          onChange={(event) => {
                            const isChecked = event.target.checked
                            setDeliveryGroupByProductPerCity(isChecked)
                            if (isChecked) {
                              setDeliveryGroupByNeighborhood(true)
                            }
                          }}
                        />
                        Samle per produkt per by
                      </label>
                    </div>
                  </div>
                </div>
                {loadingSubmissions ? <p>Laster leveringsliste...</p> : null}
                {!loadingSubmissions && analysisQuestions.length === 0 ? (
                  <p>Ingen spørsmål er merket med "Inkluder i analyse" ennå.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && historyRows.length === 0 ? (
                  <p>Ingen innsendinger ennå.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && historyRows.length > 0 ? (
                  <>
                    {deliveryGroupByNeighborhood ? (
                      <div className="delivery-city-rows">
                        {deliveryCardRows.map((row) => (
                          <section key={row.key} className="delivery-city-row">
                            <div className="delivery-city-label">
                              <h4>{row.label}</h4>
                            </div>
                            <div className="delivery-city-cards-scroll">
                              <div
                                className={`delivery-city-cards${
                                  deliveryGroupByProductPerCity ? '' : ' delivery-city-cards-fullwidth'
                                }`}
                              >
                                {row.cards.map((card, cardIndex) => (
                                  <article
                                    key={`${row.key}-${cardIndex}-${card.products
                                      .map((product) => product.questionId)
                                      .join('-') || 'empty'}`}
                                    className="response-card delivery-card"
                                  >
                                    <div className="delivery-card-header">
                                      <div>
                                        <p>
                                          <strong>Sist sendt inn:</strong>{' '}
                                          {formatTime(card.submission?.submittedAt)}
                                        </p>
                                      </div>
                                    </div>
                                    {card.products.length > 0 ? (
                                      <div className="delivery-item-list delivery-item-list-horizontal">
                                        {card.products.map((product) => (
                                          <article
                                            key={`${card.location}-${product.questionId}`}
                                            className="delivery-item"
                                          >
                                            {(() => {
                                              const sourceEntries = Array.isArray(product.sourceEntries)
                                                ? product.sourceEntries
                                                : []
                                              const productActionStates = sourceEntries.map((entry) =>
                                                analysisActionState[
                                                  `${entry.submissionId}:${entry.questionId}`
                                                ] || {
                                                  saving: false,
                                                  error: '',
                                                },
                                              )
                                              const isSaving = productActionStates.some((state) => state.saving)
                                              const actionError =
                                                productActionStates.find((state) => state.error)?.error || ''

                                              return (
                                                <>
                                                  <div className="delivery-item-header">
                                                    <h5>{product.label}</h5>
                                                    <div className="delivery-item-header-right">
                                                      <span
                                                        className={`delivery-item-status is-${product.currentCategory}`}
                                                      >
                                                        {product.currentCategory === 'red'
                                                          ? 'Kritisk'
                                                          : 'Snart tomt'}
                                                      </span>
                                                      {product.isOrdered ? (
                                                        <label
                                                          className="history-cell-checkbox-wrap"
                                                          aria-label="Nullstill bestilling"
                                                          title="Nullstill bestilling"
                                                        >
                                                          <input
                                                            type="checkbox"
                                                            className="history-cell-checkbox"
                                                            checked
                                                            disabled={isSaving}
                                                            onChange={() => onResetDeliveryOrdered(product)}
                                                          />
                                                        </label>
                                                      ) : (
                                                        <button
                                                          type="button"
                                                          className="ghost history-cell-action"
                                                          onClick={() => onMarkDeliveryOrdered(product)}
                                                          disabled={isSaving}
                                                          aria-label="Marker som bestilt"
                                                          title="Marker som bestilt"
                                                        >
                                                          {isSaving ? '...' : '+'}
                                                        </button>
                                                      )}
                                                    </div>
                                                  </div>
                                                  {actionError ? (
                                                    <p className="delivery-item-error">{actionError}</p>
                                                  ) : null}
                                                  {Array.isArray(product.locationEntries) &&
                                                  product.locationEntries.length > 0 ? (
                                                    <>
                                                      <div className="delivery-location-list">
                                                        {product.locationEntries.map((entry) => (
                                                          <article
                                                            key={`${product.questionId}-${entry.location}`}
                                                            className="delivery-location-entry"
                                                          >
                                                            <div className="delivery-location-entry-header">
                                                              <p className="delivery-location-name">
                                                                {entry.location}
                                                              </p>
                                                              <span
                                                                className={`delivery-item-status is-${entry.currentCategory}`}
                                                              >
                                                                {entry.currentCategory === 'red'
                                                                  ? 'Kritisk'
                                                                  : 'Snart tomt'}
                                                              </span>
                                                            </div>
                                                            <p className="delivery-item-values">
                                                              <span
                                                                className={`delivery-current-value is-${entry.currentCategory}`}
                                                              >
                                                                <strong>Nå:</strong> {entry.currentValue}
                                                              </span>
                                                              <span>
                                                                <strong>Mål:</strong> {entry.targetValue}
                                                              </span>
                                                            </p>
                                                            <p>
                                                              <strong>Behov:</strong>{' '}
                                                              {formatDeliveryPurchaseLabel(entry)}
                                                            </p>
                                                          </article>
                                                        ))}
                                                      </div>
                                                      <p className="delivery-product-total">
                                                        <strong>Totalt behov:</strong>{' '}
                                                        {formatDeliveryPurchaseLabel(product)}
                                                      </p>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <p className="delivery-item-values">
                                                        <span
                                                          className={`delivery-current-value is-${product.currentCategory}`}
                                                        >
                                                          <strong>Nå:</strong> {product.currentValue}
                                                        </span>
                                                        <span>
                                                          <strong>Mål:</strong> {product.targetValue}
                                                        </span>
                                                      </p>
                                                      <p>
                                                        <strong>Maks:</strong>{' '}
                                                        {product.unlimited
                                                          ? 'Ubegrenset'
                                                          : `${product.maxUnits} stk`}
                                                      </p>
                                                      <p>
                                                        <strong>Anbefalt innkjøp:</strong>{' '}
                                                        {formatDeliveryPurchaseLabel(product)}
                                                      </p>
                                                    </>
                                                  )}
                                                </>
                                              )
                                            })()}
                                          </article>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="delivery-empty">Alle produkter er på normalt nivå.</p>
                                    )}
                                  </article>
                                ))}
                              </div>
                            </div>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <div className="delivery-card-scroll">
                        <div className="delivery-card-grid">
                          {visibleDeliveryCards.map((card) => (
                            <article key={card.location} className="response-card delivery-card">
                              <div className="delivery-card-header">
                                <div>
                                  <h4>{card.location}</h4>
                                  <p>
                                    <strong>By:</strong> {card.city}
                                  </p>
                                  <p>
                                    <strong>Sist sendt inn:</strong> {formatTime(card.submission?.submittedAt)}
                                  </p>
                                </div>
                              </div>
                              {card.products.length > 0 ? (
                                <div className="delivery-item-list">
                                  {card.products.map((product) => (
                                    <article
                                      key={`${card.location}-${product.questionId}`}
                                      className="delivery-item"
                                    >
                                      {(() => {
                                        const sourceEntries = Array.isArray(product.sourceEntries)
                                          ? product.sourceEntries
                                          : []
                                        const productActionStates = sourceEntries.map((entry) =>
                                          analysisActionState[`${entry.submissionId}:${entry.questionId}`] || {
                                            saving: false,
                                            error: '',
                                          },
                                        )
                                        const isSaving = productActionStates.some((state) => state.saving)
                                        const actionError =
                                          productActionStates.find((state) => state.error)?.error || ''

                                        return (
                                          <>
                                            <div className="delivery-item-header">
                                              <h5>{product.label}</h5>
                                              <div className="delivery-item-header-right">
                                                <span
                                                  className={`delivery-item-status is-${product.currentCategory}`}
                                                >
                                                  {product.currentCategory === 'red'
                                                    ? 'Kritisk'
                                                    : 'Snart tomt'}
                                                </span>
                                                {product.isOrdered ? (
                                                  <label
                                                    className="history-cell-checkbox-wrap"
                                                    aria-label="Nullstill bestilling"
                                                    title="Nullstill bestilling"
                                                  >
                                                    <input
                                                      type="checkbox"
                                                      className="history-cell-checkbox"
                                                      checked
                                                      disabled={isSaving}
                                                      onChange={() => onResetDeliveryOrdered(product)}
                                                    />
                                                  </label>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    className="ghost history-cell-action"
                                                    onClick={() => onMarkDeliveryOrdered(product)}
                                                    disabled={isSaving}
                                                    aria-label="Marker som bestilt"
                                                    title="Marker som bestilt"
                                                  >
                                                    {isSaving ? '...' : '+'}
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                            <p className="delivery-item-values">
                                              <span
                                                className={`delivery-current-value is-${product.currentCategory}`}
                                              >
                                                <strong>Nå:</strong> {product.currentValue}
                                              </span>
                                              <span>
                                                <strong>Mål:</strong> {product.targetValue}
                                              </span>
                                            </p>
                                            <p>
                                              <strong>Maks:</strong>{' '}
                                              {product.unlimited ? 'Ubegrenset' : `${product.maxUnits} stk`}
                                            </p>
                                            <p>
                                              <strong>Anbefalt innkjøp:</strong>{' '}
                                              {formatDeliveryPurchaseLabel(product)}
                                            </p>
                                            {actionError ? (
                                              <p className="delivery-item-error">{actionError}</p>
                                            ) : null}
                                          </>
                                        )
                                      })()}
                                    </article>
                                  ))}
                                </div>
                              ) : (
                                <p className="delivery-empty">Alle produkter er på normalt nivå.</p>
                              )}
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}

            {isReviewView ? (
              <div className="responses-box review-page" id="review-section">
                <div className="review-page-header">
                  <div>
                    <h3>Review submission</h3>
                    {selectedSubmission ? (
                      <p>
                        {getSubmissionLocation(selectedSubmission.answers, formData.questions)} |{' '}
                        {getSubmissionName(selectedSubmission.answers, formData.questions)}
                      </p>
                    ) : null}
                  </div>
                  <div className="submission-modal-actions">
                    <form action={`/skjema/${activeFormSlug}/submissions`} method="get">
                      <button type="submit" className="ghost">
                        Back to submissions
                      </button>
                    </form>
                    {selectedSubmission ? (
                      <button
                        type="button"
                        className="cta"
                        onClick={onSaveSubmissionReview}
                        disabled={
                          reviewSubmissionState.saving ||
                          selectedSubmissionAnswerEntries.length === 0 ||
                          hasPendingReviewDecisions
                        }
                      >
                        {reviewSubmissionState.saving ? 'Saving...' : 'Set as reviewed'}
                      </button>
                    ) : null}
                  </div>
                </div>

                {loadingSubmissions ? <p>Loading submission...</p> : null}
                {!loadingSubmissions && !selectedSubmission ? (
                  <p>Could not find the submission.</p>
                ) : null}
                {selectedSubmission ? (
                  <>
                    <div className="receipt-meta review-meta-grid">
                      <p>
                        <strong>Submission:</strong> {selectedSubmission.id}
                      </p>
                      <p>
                        <strong>Submitted:</strong> {formatTime(selectedSubmission.submittedAt)}
                      </p>
                      <p>
                        <strong>Status:</strong> {getSubmissionStatusLabel(selectedSubmission.status)}
                      </p>
                    </div>

                    {reviewSubmissionState.error ? (
                      <p className="forms-error">{reviewSubmissionState.error}</p>
                    ) : null}

                    {reviewQuestions.length === 0 ? (
                      <p>No questions are marked with "Should be reviewed" in this form.</p>
                    ) : null}

                    {reviewQuestions.length > 0 && selectedSubmissionAnswerEntries.length === 0 ? (
                      <p>No review questions have answers in this submission.</p>
                    ) : null}

                    {selectedSubmissionAnswerEntries.length > 0 && hasPendingReviewDecisions ? (
                      <p className="review-pending-note">
                        Choose Approve or Flag for every question before setting the submission as reviewed.
                      </p>
                    ) : null}

                    <div className="review-comparison-list">
                      {selectedSubmissionAnswerEntries.map(([answerKey, value]) => {
                        const imageUrl = isStorageImagePath(value)
                          ? selectedSubmissionImageUrls[value] || ''
                          : ''
                        const question = getQuestionForAnswerKey(answerKey, formData.questions)
                        const reviewStatus = reviewDraftStatuses[answerKey] || ''
                        const isApproved = reviewStatus === 'approved'
                        const isFlagged = reviewStatus === 'flagged'

                        return (
                          <article key={`${selectedSubmission.id}-${answerKey}`} className="review-comparison-row">
                            <div className="review-comparison-panel">
                              <p className="review-answer-label">
                                {translateText(
                                  getAnswerDisplayLabel(
                                    answerKey,
                                    selectedSubmission.answers,
                                    formData.questions,
                                  ),
                                )}
                              </p>
                              <p className="review-panel-title">User answer</p>
                              {imageUrl ? (
                                <img
                                  className="review-answer-image"
                                  src={imageUrl}
                                  alt={translateText(
                                    getAnswerDisplayLabel(
                                      answerKey,
                                      selectedSubmission.answers,
                                      formData.questions,
                                    ),
                                  )}
                                  loading="lazy"
                                />
                              ) : (
                                <p className="review-answer-value">
                                  {isStorageImagePath(value)
                                    ? 'Loading image...'
                                    : getReviewDisplayValue(
                                        answerKey,
                                        value,
                                        question,
                                        translateText,
                                      )}
                                </p>
                              )}
                            </div>

                            <div className="review-comparison-panel">
                              <p className="review-panel-title">Reference image</p>
                              {question?.imageUrl ? (
                                renderQuestionImage(
                                  question.imageUrl,
                                  `${translateText(question.label)} reference`,
                                  question.imageZoom,
                                )
                              ) : (
                                <p className="review-answer-value">No reference image</p>
                              )}
                            </div>

                            <div className="review-flag-panel">
                              {question?.reviewHelpText ? (
                                <p className="review-help-text">{translateText(question.reviewHelpText)}</p>
                              ) : null}
                              <p className="review-panel-title">Review</p>
                              <div className="review-action-row">
                                <button
                                  type="button"
                                  className={`review-status-button is-approve ${
                                    isApproved ? 'is-active' : ''
                                  }`}
                                  onClick={() => onSetReviewStatus(answerKey, 'approved')}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  className={`review-status-button is-flag ${
                                    isFlagged ? 'is-active' : ''
                                  }`}
                                  onClick={() => onSetReviewStatus(answerKey, 'flagged')}
                                >
                                  Flag
                                </button>
                              </div>
                              {isFlagged ? (
                                <label
                                  className="field-block review-comment-field"
                                  htmlFor={`review-comment-${answerKey}`}
                                >
                                  <span>Comment</span>
                                  <textarea
                                    id={`review-comment-${answerKey}`}
                                    rows={4}
                                    value={reviewDraftComments[answerKey] || ''}
                                    onChange={(event) =>
                                      onReviewCommentChange(answerKey, event.target.value)
                                    }
                                  />
                                </label>
                              ) : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
        </section>
      ) : null}
    </div>
  )
}

export default FormPage
