import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
    loadingForm: 'Laster skjema...',
    loadingReceipt: 'Laster kvittering...',
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
    loadingForm: 'Loading form...',
    loadingReceipt: 'Loading receipt...',
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
    helpTextColor: String(question?.helpTextColor || '').trim(),
    helpTextBold: Boolean(question?.helpTextBold),
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

  const selectedValue = String(submission?.answers?.[question.id] || '').trim()
  if (!selectedValue) {
    return ''
  }

  const historyCategory = getSelectOptionBehavior(question, selectedValue).historyCategory
  return historyCategory === 'orange' || historyCategory === 'red' ? historyCategory : ''
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
    helpTextColor: '',
    helpTextBold: false,
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

function FormPage() {
  const { formSlug = STENGESKJEMA_ID, receiptToken = '', submissionId = '' } = useParams()
  const location = useLocation()
  const activeFormSlug = String(formSlug || STENGESKJEMA_ID).trim().toLowerCase()
  const isDefaultForm = activeFormSlug === STENGESKJEMA_ID
  const isSubmissionsView = location.pathname.endsWith('/submissions')
  const isReviewView = location.pathname.includes('/review/')
  const isFlaggedView = location.pathname.endsWith('/flagget')
  const isHistoryView =
    location.pathname.endsWith('/analyse') || location.pathname.endsWith('/historikk')
  const isEditPage = location.pathname.endsWith('/edit')
  const isReceiptPage = location.pathname.includes('/kvittering/')
  const isStandalonePublicForm =
    !isSubmissionsView && !isEditPage && !isHistoryView && !isFlaggedView && !isReviewView

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
    if ((!isStandalonePublicForm && !isReviewView) || isReceiptPage || loadingForm || !shouldTranslateToEnglish) {
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
    isReceiptPage,
    isReviewView,
    isStandalonePublicForm,
    loadingForm,
    publicCopy.translationError,
    shouldTranslateToEnglish,
  ])

  useEffect(() => {
    if (loadingForm) {
      setDraftReady(false)
      return
    }

    if (isReceiptPage) {
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
  }, [activeFormSlug, formData.enableSelfDeclaration, formData.questions, isReceiptPage, loadingForm])

  useEffect(() => {
    if (
      loadingForm ||
      !draftReady ||
      isEditPage ||
      isSubmissionsView ||
      isReceiptPage ||
      isHistoryView ||
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
    let cancelled = false

    async function loadLocations() {
      setLoadingLocations(true)
      try {
        const snapshot = await getDocs(query(collection(db, 'locations')))
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

        if (!cancelled) {
          setAvailableLocations(rows)
        }
      } finally {
        if (!cancelled) {
          setLoadingLocations(false)
        }
      }
    }

    loadLocations()

    return () => {
      cancelled = true
    }
  }, [])

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
    if (!isReceiptPage || !receiptToken) {
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
        const snapshot = await getDoc(doc(db, 'formSubmissionReceipts', receiptToken))

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
  }, [activeFormSlug, isReceiptPage, receiptToken])

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

    const missingRequired = formData.questions.find((question) => {
      if (isSectionQuestion(question)) {
        return false
      }

      const answerValue = String(answers[question.id] || '').trim()
      const selectedBehavior = getSelectOptionBehavior(question, answerValue)

      if (question.type === 'select' && selectedBehavior.kind === 'input' && answerValue) {
        return !String(selectDetailAnswers[question.id] || '').trim()
      }

      if (question.type === 'select' && selectedBehavior.kind === 'camera' && answerValue) {
        return !selectDetailFiles[question.id]
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

    setSubmitState({ submitting: true, message: '', error: '' })

    try {
      const submissionRef = doc(collection(db, 'formSubmissions'))
      const receiptRef = doc(collection(db, 'formSubmissionReceipts'))
      const imagePaths = []
      const receiptImageMap = {}
      const submissionAnswers = { ...answers }

      formData.questions.forEach((question) => {
        if (isSectionQuestion(question)) {
          return
        }

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
        formData.questions.map(async (question) => {
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

      const submitterEmail = getSubmissionEmail(submissionAnswers, formData.questions)
      const submittedAtIso = new Date().toISOString()

      let receiptTokenValue = ''

      try {
        await setDoc(receiptRef, {
          formSlug: activeFormSlug,
          formTitle: formData.title || activeFormSlug,
          submissionId: submissionRef.id,
          submitterEmail,
          submittedAtIso,
          answers: submissionAnswers,
          imagePaths,
          imageUrls: receiptImageMap,
          createdAt: serverTimestamp(),
        })
        receiptTokenValue = receiptRef.id
      } catch (receiptError) {
        console.error('Failed to create submission receipt', {
          formSlug: activeFormSlug,
          submissionId: submissionRef.id,
          error: receiptError,
        })
      }

      await setDoc(submissionRef, {
        formId: formDocId,
        formSlug: activeFormSlug,
        formTitle: formData.title || activeFormSlug,
        answers: submissionAnswers,
        imagePaths,
        ...(receiptTokenValue ? { receiptToken: receiptTokenValue } : {}),
        submitterEmail,
        status: 'awaiting review',
        statusUpdatedBy: 'system',
        statusUpdatedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
      })

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
          displayLanguage === 'en' ? 'Thanks! The form has been submitted.' : 'Takk! Skjemaet er sendt inn.',
        error: '',
      })
    } catch (error) {
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
            imageUrl: question.imageUrl,
            imagePreviewUrl: question.imagePreviewUrl,
            imageFile: question.imageFile,
            removeImage: question.removeImage,
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
        helpTextColor: '',
        helpTextBold: false,
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
    const confirmed = window.confirm('Slette denne innsendingen permanent?')
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
        [submissionId]: { deleting: false, error: 'Kunne ikke slette innsending.' },
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
                {detailFile ? publicCopy.uploadNewPhoto : publicCopy.takePhoto}
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
          {!loadingLocations && !hasAvailableLocations ? (
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
            {cameraFiles[question.id] ? publicCopy.uploadNewPhoto : publicCopy.takePhoto}
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
        return Boolean(selectDetailFiles[question.id])
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
  const isPublicFormReady =
    !loadingForm && draftReady && (!hasLocationQuestions || !loadingLocations)
  const isReceiptReady = !loadingForm && !loadingReceipt
  const availableSubmissionDays = Array.from(
    new Set(submissions.map((submission) => getSubmissionDayKey(submission.submittedAt)).filter(Boolean)),
  )
  const visibleSubmissions = selectedSubmissionDay
    ? submissions.filter((submission) => getSubmissionDayKey(submission.submittedAt) === selectedSubmissionDay)
    : submissions
  const flaggedSubmissions = submissions.filter(
    (submission) => Array.isArray(submission.flaggedAnswers) && submission.flaggedAnswers.length > 0,
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
  const visibleHistoryRows =
    historyShowAllLocations
      ? historyRows
      : historyRows.filter((row) => selectedHistoryLocations.includes(row.location))
  const historySubmissionSlots = Array.from(
    { length: parsedHistorySubmissionLimit },
    (_, index) => index,
  )
  const receiptAnswerEntries = getOrderedAnswerEntries(receiptSubmission?.answers || {}, formData.questions)
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
    !isSubmissionsView && !isEditPage && !isHistoryView && !isFlaggedView && !isReviewView

  useEffect(() => {
    const validLocations = new Set(historyRows.map((row) => row.location))
    setSelectedHistoryLocations((previous) =>
      previous.filter((location) => validLocations.has(location)),
    )
  }, [historyRows])

  let publicQuestionOrder = 0

  return (
    <div
      className={`forms-page stengeskjema-page ${isStandalonePublicForm ? 'public-form-page' : ''} ${
        isHistoryView ? 'history-page' : ''
      }`}
    >
      {isSubmissionsView || isEditPage || isHistoryView || isFlaggedView || isReviewView ? (
        <Link className="admin-login-link" to="/skjema">
          Tilbake til hovedmeny
        </Link>
      ) : !isStandalonePublicForm &&
        !isSubmissionsView &&
        !isEditPage &&
        !isHistoryView &&
        !isFlaggedView &&
        !isReviewView ? (
        <Link className="admin-login-link" to="/skjema">
          Tilbake til alle skjema
        </Link>
      ) : null}
      {isReceiptPage && !isReceiptReady ? (
        <section className="form-entry">
          <p>{publicCopy.loadingReceipt}</p>
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
              {!isReceiptPage ? (
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
              ) : null}
              {!isReceiptPage && translationState.loading ? (
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
              {!isReceiptPage && translationState.error ? (
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
                      <strong>Innsending:</strong> {receiptSubmission.submissionId || receiptSubmission.id}
                    </p>
                    <p>
                      <strong>Sendt inn:</strong>{' '}
                      {receiptSubmission.submittedAtIso
                        ? new Date(receiptSubmission.submittedAtIso).toLocaleString('nb-NO')
                        : '-'}
                    </p>
                  </div>

                  <div className="receipt-answer-list">
                    {receiptAnswerEntries.map(([key, value]) => {
                      const imageUrl = isStorageImagePath(value)
                        ? receiptSubmission.imageUrls?.[value] || receiptImageUrls[value] || ''
                        : ''

                      return (
                        <article key={key} className="receipt-answer-row">
                          <p className="receipt-answer-label">
                            {getAnswerDisplayLabel(key, receiptSubmission.answers, formData.questions)}
                          </p>
                          {imageUrl ? (
                            <img
                              className="receipt-answer-image"
                              src={imageUrl}
                              alt={getAnswerDisplayLabel(
                                key,
                                receiptSubmission.answers,
                                formData.questions,
                              )}
                              loading="lazy"
                            />
                          ) : (
                            <p className="receipt-answer-value">
                              {isStorageImagePath(value) ? 'Laster bilde...' : String(value || '-')}
                            </p>
                          )}
                        </article>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </section>
          ) : !isSubmissionsView && !isEditPage && !isHistoryView && !isFlaggedView && !isReviewView ? (
            <section className="form-entry">
              <div className="form-entry-header">
                <button type="button" className="ghost reset-form-button" onClick={resetAllAnswers}>
                  {publicCopy.resetAnswers}
                </button>
              </div>
              <form key={formInstanceKey} onSubmit={onSubmit} className="dynamic-form">
                {formData.questions.map((question) =>
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

      {(isEditPage || isSubmissionsView || isHistoryView || isFlaggedView || isReviewView) && !isAdmin && !loading ? (
        <section className="admin-login-line">
          <p className="forms-error">Kun admin har tilgang til denne siden.</p>
        </section>
      ) : null}

      {isAdmin && (isSubmissionsView || isEditPage || isHistoryView || isFlaggedView || isReviewView) ? (
        <section className={isEditPage || isSubmissionsView || isHistoryView || isFlaggedView || isReviewView ? 'admin-edit-shell' : 'admin-box'}>
          {loading ? <p>Kontrollerer innlogging...</p> : null}
          {error ? <p className="forms-error">{error}</p> : null}

            {isEditPage ? (
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
                      <div className="editor-question-row">
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
                        </>
                      ) : null}

                      {!isSectionQuestion(question) ? (
                        <>
                          <div className="editor-question-row">
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
                              <span>Hjelpetekst</span>
                              <input
                                id={`q-placeholder-${index}`}
                                type="text"
                                value={question.placeholder || ''}
                                onChange={(event) =>
                                  onEditorQuestionChange(index, 'placeholder', event.target.value)
                                }
                              />
                            </label>
                          </div>

                          {question.imagePreviewUrl ? (
                            <div className="question-image-preview">
                              {renderQuestionImage(
                                question.imagePreviewUrl,
                                question.label,
                                question.imageZoom,
                                true,
                              )}
                              <label className="field-block image-zoom-field" htmlFor={`q-image-zoom-${index}`}>
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
                            <p className="field-help">Ingen bilde valgt for dette spørsmålet.</p>
                          )}

                          <label className="checkbox-inline" htmlFor={`q-required-${index}`}>
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
                          <div className="editor-inline-setting-row">
                            <label className="checkbox-inline" htmlFor={`q-analysis-${index}`}>
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
                            {question.includeInAnalysis ? (
                              <label
                                className="field-block analysis-label-field inline-setting-field"
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
                            ) : null}
                          </div>
                          <div className="editor-inline-setting-row">
                            <label className="checkbox-inline" htmlFor={`q-review-${index}`}>
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
                            {question.includeInReview ? (
                              <label
                                className="field-block inline-setting-field"
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
                        </>
                      ) : (
                        <>
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
                          {question.imagePreviewUrl ? (
                            <div className="question-image-preview">
                              {renderQuestionImage(
                                question.imagePreviewUrl,
                                question.label,
                                question.imageZoom,
                                true,
                              )}
                              <label className="field-block image-zoom-field" htmlFor={`q-image-zoom-${index}`}>
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
                            <p className="field-help">Ingen bilde valgt for denne kategorien.</p>
                          )}
                          <label className="field-block" htmlFor={`q-placeholder-${index}`}>
                            <span>Hjelpetekst under kategori</span>
                            <input
                              id={`q-placeholder-${index}`}
                              type="text"
                              value={question.placeholder || ''}
                              onChange={(event) =>
                                onEditorQuestionChange(index, 'placeholder', event.target.value)
                              }
                            />
                          </label>
                          <div className="editor-question-row helptext-style-row">
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

                            <label className="checkbox-inline" htmlFor={`q-helptext-bold-${index}`}>
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
                          </div>
                          <p className="field-help">
                            Kategorien vises som en overskrift mellom spørsmålsboksene i skjemaet.
                          </p>
                        </>
                      )}

                      <div className="question-order-actions">
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
                      </div>
                      <div className="question-move-direct">
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
                          <span>Flytt til spørsmål</span>
                          <input
                            id={`q-move-target-${index}`}
                            type="number"
                            min="1"
                            max={editorQuestions.length}
                            inputMode="numeric"
                            placeholder={`1-${editorQuestions.length}`}
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
                <h3>Innsendinger</h3>
                {loadingSubmissions ? <p>Laster innsendinger...</p> : null}
                {!loadingSubmissions && availableSubmissionDays.length > 0 ? (
                  <div className="submissions-filter-bar">
                    <label className="field-block" htmlFor="submission-day-filter">
                      <span>Dag</span>
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
                  <p>Ingen innsendinger enda.</p>
                ) : null}
                {!loadingSubmissions && submissions.length > 0 && visibleSubmissions.length === 0 ? (
                  <p>Ingen innsendinger for valgt dag.</p>
                ) : null}
                {!loadingSubmissions && visibleSubmissions.length > 0 ? (
                  <div className="submissions-table-wrap">
                    <table className="submissions-table">
                      <thead>
                        <tr>
                          <th>Sendt inn</th>
                          <th>Lokasjon</th>
                          <th>Navn</th>
                          <th>Kvittering</th>
                          <th>Status</th>
                          <th>Handlinger</th>
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
                                  <Link
                                    className="ghost"
                                    to={`/skjema/${activeFormSlug}/kvittering/${submission.receiptToken}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Vis kvittering
                                  </Link>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td>
                                <span className={`submission-status-badge is-${String(submission.status || 'awaiting-review').replace(/\s+/g, '-').toLowerCase()}`}>
                                  {getSubmissionStatusLabel(submission.status)}
                                </span>
                                {flaggedCount > 0 ? (
                                  <small className="submission-flag-note">
                                    {flaggedCount} flagget
                                  </small>
                                ) : null}
                              </td>
                              <td>
                                <div className="submission-table-actions">
                                  <Link
                                    className="ghost"
                                    to={`/skjema/${activeFormSlug}/review/${submission.id}`}
                                  >
                                    Review
                                  </Link>
                                  <button
                                    type="button"
                                    className="ghost danger-button"
                                    onClick={() => onDeleteSubmission(submission.id)}
                                    disabled={deleteState.deleting}
                                  >
                                    {deleteState.deleting ? 'Sletter...' : 'Slett'}
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
                {!loadingSubmissions && flaggedSubmissions.length > 0 ? (
                  <div className="flagged-submission-list">
                    {flaggedSubmissions.map((submission) => (
                      <article key={submission.id} className="response-card flagged-submission-card">
                        <div className="flagged-submission-header">
                          <div>
                            <h4>{getSubmissionLocation(submission.answers, formData.questions)}</h4>
                            <p>
                              {getSubmissionName(submission.answers, formData.questions)} |{' '}
                              {formatTime(submission.submittedAt)}
                            </p>
                          </div>
                          <div className="submission-table-actions">
                            {submission.receiptToken ? (
                              <Link
                                className="ghost"
                                to={`/skjema/${activeFormSlug}/kvittering/${submission.receiptToken}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Vis kvittering
                              </Link>
                            ) : null}
                            <Link
                              className="ghost"
                              to={`/skjema/${activeFormSlug}/review/${submission.id}`}
                            >
                              Review
                            </Link>
                          </div>
                        </div>
                        <div className="flagged-answer-list">
                          {(submission.flaggedAnswers || []).map((item) => (
                            <p key={`${submission.id}-${item.answerKey}`}>
                              <strong>{item.label}:</strong>{' '}
                              {isStorageImagePath(item.value) ? 'Bilde vedlagt' : String(item.value || '-')}
                              {item.comment ? (
                                <small className="flagged-answer-comment">
                                  Kommentar: {item.comment}
                                </small>
                              ) : null}
                            </p>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isHistoryView ? (
              <div className="history-overview" id="history-section">
                <div className="history-header">
                  <h3>Analyse</h3>
                  <div className="history-controls">
                    <label className="field-block history-days-field" htmlFor="history-submission-limit">
                      <span>Vis siste [x] innsendinger</span>
                      <input
                        id="history-submission-limit"
                        type="number"
                        min="1"
                        inputMode="numeric"
                        value={historySubmissionLimit}
                        onChange={(event) => setHistorySubmissionLimit(event.target.value)}
                      />
                    </label>
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

                                return (
                                  <td
                                    key={`${row.location}-${question.id}-${slotIndex}`}
                                    className={`history-cell ${
                                      slotIndex === 0 ? 'history-current-column' : ''
                                    } ${
                                      historyCellCategory
                                        ? `history-cell-${historyCellCategory}`
                                        : ''
                                    }`}
                                  >
                                    {values.length > 0 ? values.join(' | ') : '-'}
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
                    <Link className="ghost" to={`/skjema/${activeFormSlug}/submissions`}>
                      Back to submissions
                    </Link>
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
