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
const SUBMISSION_DATE_KEY = 'Innsendt dato'
const SUBMISSION_TIME_KEY = 'Innsendt tid'
const SELECT_DETAIL_SUFFIX = '__details'
const SELF_DECLARATION_ACCEPTED_KEY = 'Egenerklæring bekreftet'

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

function getDatePart(timestamp) {
  if (!timestamp) {
    return '-'
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : timestamp
  if (!(date instanceof Date)) {
    return '-'
  }
  return date.toLocaleDateString('nb-NO')
}

function getClockPart(timestamp) {
  if (!timestamp) {
    return '-'
  }
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : timestamp
  if (!(date instanceof Date)) {
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

function getOrderedAnswerEntries(answers, questions = []) {
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

  Object.entries(answers || {}).forEach(([key, value]) => {
    if (usedKeys.has(key)) {
      return
    }
    if (!String(value || '').trim()) {
      return
    }
    entries.push([key, value])
  })

  return entries
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
  const { formSlug = STENGESKJEMA_ID, receiptToken = '' } = useParams()
  const location = useLocation()
  const activeFormSlug = String(formSlug || STENGESKJEMA_ID).trim().toLowerCase()
  const isDefaultForm = activeFormSlug === STENGESKJEMA_ID
  const isSubmissionsView = location.pathname.endsWith('/submissions')
  const isHistoryView = location.pathname.endsWith('/historikk')
  const isEditPage = location.pathname.endsWith('/edit')
  const isReceiptPage = location.pathname.includes('/kvittering/')
  const isStandalonePublicForm = !isSubmissionsView && !isEditPage && !isHistoryView

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
  const [selectedSubmissionImageUrls, setSelectedSubmissionImageUrls] = useState([])
  const [selectedSubmissionImagesLoading, setSelectedSubmissionImagesLoading] = useState(false)
  const [selectedSubmissionDay, setSelectedSubmissionDay] = useState('')
  const [receiptSubmission, setReceiptSubmission] = useState(null)
  const [loadingReceipt, setLoadingReceipt] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [receiptImageUrls, setReceiptImageUrls] = useState({})

  const { user, isAdmin, loading, error } = useAdminSession()

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
    if (loadingForm || !draftReady || isEditPage || isSubmissionsView || isReceiptPage) {
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
    isReceiptPage,
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
    setSelectedSubmissionId('')
  }, [activeFormSlug, isSubmissionsView])

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
      setSelectedSubmissionImageUrls([])
      setSelectedSubmissionImagesLoading(false)
      return
    }

    const selectedSubmission = submissions.find((item) => item.id === selectedSubmissionId)
    if (!selectedSubmission) {
      setSelectedSubmissionImageUrls([])
      setSelectedSubmissionImagesLoading(false)
      return
    }

    let cancelled = false
    setSelectedSubmissionImagesLoading(true)

    const allPaths = [
      ...(Array.isArray(selectedSubmission.imagePaths) ? selectedSubmission.imagePaths : []),
      ...Object.values(selectedSubmission.answers || {}).filter((value) => isStorageImagePath(value)),
    ]
    const uniquePaths = Array.from(new Set(allPaths))

    Promise.all(
      uniquePaths.map(async (path) => {
        try {
          const url = await getDownloadURL(ref(storage, path))
          return url
        } catch {
          return ''
        }
      }),
    )
      .then((urls) => {
        if (cancelled) {
          return
        }
        setSelectedSubmissionImageUrls(urls.filter((url) => url.length > 0))
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedSubmissionImagesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedSubmissionId, submissions])

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
    const confirmed = window.confirm('Nullstill alle svar i skjemaet?')
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
        error: 'Du må bekrefte egenerklæringen.',
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
        error: `Manglende svar: ${missingRequired.label}`,
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
        message: 'Takk! Skjemaet er sendt inn.',
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
                  }

                  return accumulator
                }, {})
              : {}

          return {
            ...question,
            type: value,
            required: value === 'section' ? false : question.required,
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
    return (
      <>
        <div className="question-copy">
          <span className="question-label">
            {question.label}
            {!question.required ? (
              <span className="question-optional-note"> (ikke obligatorisk)</span>
            ) : null}
          </span>
        </div>
        {question.imageUrl ? (
          renderQuestionImage(question.imageUrl, question.label, question.imageZoom)
        ) : null}
        {question.placeholder ? (
          <small className="question-help" style={getHelpTextStyle(question)}>
            {question.placeholder}
          </small>
        ) : null}
      </>
    )
  }

  function renderSectionHeading(question) {
    return (
      <div className="form-section-heading">
        <h3>{question.label}</h3>
        {question.imageUrl ? (
          renderQuestionImage(question.imageUrl, question.label, question.imageZoom)
        ) : null}
        {question.placeholder ? (
          <small className="question-help" style={getHelpTextStyle(question)}>
            {question.placeholder}
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

  function renderQuestionInput(question) {
    const value = answers[question.id] || ''

    if (question.type === 'textarea') {
      return (
        <textarea
          id={question.id}
          value={value}
          placeholder={getInputPlaceholder(question)}
          required={question.required}
          rows={4}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    if (question.type === 'select') {
      const detailValue = selectDetailAnswers[question.id] || ''
      const selectedBehavior = getSelectOptionBehavior(question, value)
      const detailPrompt = selectedBehavior.text.trim() || 'Beskriv nærmere'
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
            <option value="">Velg</option>
            {(question.options || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {selectedBehavior.kind === 'message' && selectedBehavior.text.trim() ? (
            <p
              className="field-help select-detail-message"
              style={getSelectMessageStyle(selectedBehavior)}
            >
              {selectedBehavior.text}
            </p>
          ) : null}
          {selectedBehavior.kind === 'input' && value ? (
            <>
              <small className="question-help">{detailPrompt}</small>
              <input
                id={getSelectDetailAnswerKey(question.id)}
                type="text"
                value={detailValue}
                placeholder="Skriv her"
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
                {detailFile ? 'Last opp nytt bilde' : 'Ta bilde'}
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
                  <img src={detailPreview} alt={`${question.label} bilde`} />
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
            <option value="">{loadingLocations ? 'Laster lokasjoner...' : 'Velg lokasjon'}</option>
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
            <option value={LOCATION_OTHER_VALUE}>Annet</option>
          </select>
          {!loadingLocations && !hasAvailableLocations ? (
            <small className="question-help">
              Ingen lagrede lokasjoner funnet. Velg &quot;Annet&quot; for å skrive inn manuelt.
            </small>
          ) : null}
          {value === LOCATION_OTHER_VALUE ? (
            <input
              id={`${question.id}-other`}
              type="text"
              value={otherValue}
              placeholder={getInputPlaceholder(question, 'Skriv inn lokasjon')}
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
            {cameraFiles[question.id] ? 'Last opp nytt bilde' : 'Ta bilde'}
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
              <img src={cameraPreview} alt={`${question.label} bilde`} />
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
          placeholder={getInputPlaceholder(question, 'Fullt navn')}
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
          placeholder={getInputPlaceholder(question, 'E-postadresse')}
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
        placeholder={getInputPlaceholder(question)}
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
  const locationOrder = availableLocations.map((location) => String(location.name || '').trim()).filter(Boolean)
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
      items: items.sort((a, b) => {
        const aSeconds = a.submittedAt?.seconds || 0
        const bSeconds = b.submittedAt?.seconds || 0
        return bSeconds - aSeconds
      }),
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
  const receiptAnswerEntries = getOrderedAnswerEntries(receiptSubmission?.answers || {}, formData.questions)
  const heroEyebrow = isReceiptPage ? 'Kvittering' : 'Skjema'
  const heroTitle = isReceiptPage ? `Takk, ${formData.title} er sendt inn` : formData.title
  const heroLead = isReceiptPage
    ? 'Her er en kopi av akkurat denne innsendingen.'
    : formData.description
  const showPublicFacingHeader = !isSubmissionsView && !isEditPage && !isHistoryView

  let publicQuestionOrder = 0

  return (
    <div
      className={`forms-page stengeskjema-page ${isStandalonePublicForm ? 'public-form-page' : ''} ${
        isHistoryView ? 'history-page' : ''
      }`}
    >
      {!isStandalonePublicForm && !isSubmissionsView && !isEditPage && !isHistoryView ? (
        <Link className="admin-login-link" to="/skjema">
          Tilbake til alle skjema
        </Link>
      ) : null}
      {isReceiptPage && !isReceiptReady ? (
        <section className="form-entry">
          <p>Laster kvittering...</p>
        </section>
      ) : !isSubmissionsView && !isEditPage && !isHistoryView && !isReceiptPage && !isPublicFormReady ? (
        <section className="form-entry">
          <p>Laster skjema...</p>
        </section>
      ) : (
        <>
          {showPublicFacingHeader ? (
            <header className="forms-hero">
              <p className="eyebrow">{heroEyebrow}</p>
              <h1>{heroTitle}</h1>
              <p className="lead">{heroLead}</p>
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
          ) : !isSubmissionsView && !isEditPage && !isHistoryView ? (
            <section className="form-entry">
              <div className="form-entry-header">
                <button type="button" className="ghost reset-form-button" onClick={resetAllAnswers}>
                  Nullstill alle svar
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
                      {formData.selfDeclarationText || 'Jeg bekrefter opplysningene i skjemaet.'}
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
                      Jeg bekrefter egenerklæringen
                    </label>
                  </div>
                ) : null}

                {submitState.error ? <p className="forms-error">{submitState.error}</p> : null}

                <button
                  type="submit"
                  className="cta"
                  disabled={submitState.submitting || !isPublicFormReady}
                >
                  {submitState.submitting ? 'Sender...' : 'Send skjema'}
                </button>
              </form>
            </section>
          ) : null}

          {submitOverlay.open && !isReceiptPage && !isSubmissionsView && !isEditPage ? (
            <div className="submit-overlay" role="status" aria-live="polite" aria-busy={submitOverlay.status === 'submitting'}>
              <div className={`submit-overlay-card is-${submitOverlay.status}`}>
                {submitOverlay.status === 'submitting' ? (
                  <>
                    <div className="submit-overlay-spinner" aria-hidden="true" />
                    <p>Sender skjema...</p>
                  </>
                ) : (
                  <>
                    <div className="submit-overlay-check" aria-hidden="true">
                      ✓
                    </div>
                    <p>Skjema sendt inn</p>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </>
      )}

      {(isEditPage || isSubmissionsView || isHistoryView) && !isAdmin && !loading ? (
        <section className="admin-login-line">
          <p className="forms-error">Kun admin har tilgang til denne siden.</p>
        </section>
      ) : null}

      {isAdmin && (isSubmissionsView || isEditPage || isHistoryView) ? (
        <section className={isEditPage || isSubmissionsView || isHistoryView ? 'admin-edit-shell' : 'admin-box'}>
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
                            <label className="field-block analysis-label-field" htmlFor={`q-analysis-label-${index}`}>
                              <span>Kort tekst i historikk</span>
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
                {!loadingSubmissions && submissionsByLocation.length > 0 ? (
                  <div className="location-submission-groups">
                    {submissionsByLocation.map((group) => (
                      <section key={group.location} className="location-submission-group">
                        <div className="location-submission-header">
                          <div>
                            <h4>{group.location}</h4>
                            <p>{group.items.length} innsendinger</p>
                          </div>
                        </div>

                        <div className="location-submission-list">
                          {group.items.map((submission) => {
                            const deleteState = deleteSubmissionState[submission.id] || {}

                            return (
                              <article
                                key={submission.id}
                                className="response-card submission-answer-card"
                              >
                                <div className="submission-answer-meta">
                                  <div>
                                    <strong>{getClockPart(submission.submittedAt)}</strong>
                                    <p>{getSubmissionName(submission.answers, formData.questions)}</p>
                                  </div>
                                  <div className="submission-answer-actions">
                                    <small>
                                      {formatSubmissionDayLabel(
                                        getSubmissionDayKey(submission.submittedAt),
                                      )}
                                    </small>
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
                                    <button
                                      type="button"
                                      className="ghost danger-button"
                                      onClick={() => onDeleteSubmission(submission.id)}
                                      disabled={deleteState.deleting}
                                    >
                                      {deleteState.deleting ? 'Sletter...' : 'Slett innsending'}
                                    </button>
                                  </div>
                                </div>

                                {deleteState.error ? (
                                  <p className="forms-error">{deleteState.error}</p>
                                ) : null}

                                <div className="response-grid submission-answer-grid">
                                  {Object.entries(submission.answers || {}).map(([key, value]) => (
                                    <p key={`${submission.id}-${key}`}>
                                      <strong>
                                        {getAnswerDisplayLabel(
                                          key,
                                          submission.answers,
                                          formData.questions,
                                        )}
                                        :
                                      </strong>{' '}
                                      {isStorageImagePath(value) ? 'Bilde vedlagt' : String(value || '-')}
                                    </p>
                                  ))}
                                </div>
                              </article>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isHistoryView ? (
              <div className="history-overview" id="history-section">
                <h3>Historikk</h3>
                {loadingSubmissions ? <p>Laster historikk...</p> : null}
                {!loadingSubmissions && analysisQuestions.length === 0 ? (
                  <p>Ingen spørsmål er merket med "Inkluder i analyse" ennå.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && historyRows.length === 0 ? (
                  <p>Ingen innsendinger enda.</p>
                ) : null}
                {!loadingSubmissions && analysisQuestions.length > 0 && historyRows.length > 0 ? (
                  <div className="history-location-list">
                    {historyRows.map((row) => (
                      <section key={row.location} className="history-location-group">
                        <h4>{row.location}</h4>
                        <div className="history-table-wrap">
                          <table className="history-table">
                            <thead>
                              <tr>
                                <th>Spørsmål</th>
                                {row.items.map((submission, index) => (
                                  <th
                                    key={`${row.location}-${submission.id}`}
                                    className={index === 0 ? 'history-current-column' : ''}
                                  >
                                    <div className="history-cell-meta">
                                      <strong>{index === 0 ? 'Nyeste' : `${index + 1}`}</strong>
                                      <small>{getDatePart(submission.submittedAt)}</small>
                                      <small>{getClockPart(submission.submittedAt)}</small>
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {analysisQuestions.map((question) => (
                                <tr key={`${row.location}-${question.id}`}>
                                  <th scope="row">{question.analysisLabel || question.label}</th>
                                  {row.items.map((submission, submissionIndex) => {
                                    const values = getHistoryAnswerValues(submission, question)

                                    return (
                                      <td
                                        key={`${submission.id}-${question.id}`}
                                        className={`history-cell ${
                                          submissionIndex === 0 ? 'history-current-column' : ''
                                        }`}
                                      >
                                        {values.length > 0 ? values.join(' | ') : '-'}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
        </section>
      ) : null}
    </div>
  )
}

export default FormPage
