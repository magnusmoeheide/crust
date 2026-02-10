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

function normalizeQuestion(question, index) {
  const label = String(question?.label || '').trim()
  const fallbackLabel = `Spørsmål ${index + 1}`
  const type = ['text', 'textarea', 'select', 'number', 'date', 'camera', 'name'].includes(
    question?.type,
  )
    ? question.type
    : 'text'

  return {
    id: question?.id ? toQuestionId(question.id) : toQuestionId(label || `q-${index + 1}`),
    label: label || fallbackLabel,
    type,
    required: Boolean(question?.required),
    placeholder: String(question?.placeholder || ''),
    options:
      type === 'select' && Array.isArray(question?.options)
        ? question.options
            .map((option) => String(option || '').trim())
            .filter((option) => option.length > 0)
        : [],
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

function getSubmissionPlace(answers) {
  const candidates = ['sted', 'location', 'lokasjon', 'place']
  for (const key of candidates) {
    if (answers?.[key] && String(answers[key]).trim()) {
      return String(answers[key]).trim()
    }
  }
  return '-'
}

function isStorageImagePath(value) {
  return typeof value === 'string' && value.startsWith('forms/images/')
}

function FormPage() {
  const { formSlug = STENGESKJEMA_ID } = useParams()
  const location = useLocation()
  const activeFormSlug = String(formSlug || STENGESKJEMA_ID).trim().toLowerCase()
  const isDefaultForm = activeFormSlug === STENGESKJEMA_ID
  const isSubmissionsView = location.pathname.endsWith('/submissions')
  const isEditPage = location.pathname.endsWith('/edit')

  const [formData, setFormData] = useState(defaultStengeskjema)
  const [formDocId, setFormDocId] = useState(STENGESKJEMA_ID)
  const [answers, setAnswers] = useState({})
  const [cameraFiles, setCameraFiles] = useState({})
  const [images, setImages] = useState([])
  const [loadingForm, setLoadingForm] = useState(true)
  const [submitState, setSubmitState] = useState({ submitting: false, message: '', error: '' })

  const [editorTitle, setEditorTitle] = useState(defaultStengeskjema.title)
  const [editorDescription, setEditorDescription] = useState(defaultStengeskjema.description)
  const [editorQuestions, setEditorQuestions] = useState(
    defaultStengeskjema.questions.map((item, index) => normalizeQuestion(item, index)),
  )
  const [saveState, setSaveState] = useState({ saving: false, message: '', error: '' })

  const [submissions, setSubmissions] = useState([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [statusUpdateState, setStatusUpdateState] = useState({})
  const [deleteSubmissionState, setDeleteSubmissionState] = useState({})
  const [selectedSubmissionId, setSelectedSubmissionId] = useState('')
  const [selectedSubmissionImageUrls, setSelectedSubmissionImageUrls] = useState([])
  const [selectedSubmissionImagesLoading, setSelectedSubmissionImagesLoading] = useState(false)

  const { user, isAdmin, loading, error } = useAdminSession()

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
            questions: normalizedQuestions,
          }

          setFormData(normalized)
          setFormDocId(matching?.id || activeFormSlug)
          setEditorTitle(normalized.title || defaultStengeskjema.title)
          setEditorDescription(normalized.description || defaultStengeskjema.description)
          setEditorQuestions(normalizedQuestions)
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
    setAnswers((previous) => {
      const next = { ...previous }
      formData.questions.forEach((question) => {
        if (typeof next[question.id] === 'undefined') {
          next[question.id] = ''
        }
      })
      return next
    })
  }, [formData.questions])

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
    setSelectedSubmissionId('')
  }, [activeFormSlug, isSubmissionsView])

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

  async function onSubmit(event) {
    event.preventDefault()
    setSubmitState({ submitting: false, message: '', error: '' })

    const missingRequired = formData.questions.find(
      (question) =>
        question.required &&
        (question.type === 'camera'
          ? !cameraFiles[question.id] && !String(answers[question.id] || '').trim()
          : !String(answers[question.id] || '').trim()),
    )

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
      const imagePaths = []
      const submissionAnswers = { ...answers }

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
          imagePaths.push(path)
          submissionAnswers[question.id] = path
        }),
      )

      if (images.length > 0) {
        await Promise.all(
          images.map(async (file, index) => {
            const fileName = sanitizeFileName(file.name)
            const path = `forms/images/${activeFormSlug}/${submissionRef.id}-${index}-${fileName}`
            await uploadBytes(ref(storage, path), file, {
              contentType: file.type,
            })
            imagePaths.push(path)
          }),
        )
      }

      await setDoc(submissionRef, {
        formId: formDocId,
        formSlug: activeFormSlug,
        answers: submissionAnswers,
        imagePaths,
        status: 'awaiting review',
        statusUpdatedBy: 'system',
        statusUpdatedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
      })

      const clearedAnswers = formData.questions.reduce((accumulator, question) => {
        accumulator[question.id] = ''
        return accumulator
      }, {})

      setAnswers(clearedAnswers)
      setCameraFiles({})
      setImages([])
      setSubmitState({
        submitting: false,
        message: 'Takk! Skjemaet er sendt inn.',
        error: '',
      })
    } catch {
      setSubmitState({
        submitting: false,
        message: '',
        error: 'Noe gikk galt ved innsending. Prøv igjen.',
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
          return {
            ...question,
            options: String(value)
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item.length > 0),
          }
        }

        if (key === 'type') {
          return {
            ...question,
            type: value,
            options: value === 'select' ? question.options || ['Ja', 'Nei'] : [],
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

  function addQuestion() {
    setEditorQuestions((previous) => [
      ...previous,
      {
        id: toQuestionId(`new-question-${previous.length + 1}`),
        label: `Nytt spørsmål ${previous.length + 1}`,
        type: 'text',
        required: false,
        placeholder: '',
        options: [],
      },
    ])
  }

  function removeQuestion(index) {
    setEditorQuestions((previous) => previous.filter((_, questionIndex) => questionIndex !== index))
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

  async function onSaveForm() {
    setSaveState({ saving: true, message: '', error: '' })

    const preparedQuestions = editorQuestions.map((question, index) =>
      normalizeQuestion(
        {
          ...question,
          id: question.id || toQuestionId(question.label || `q-${index + 1}`),
        },
        index,
      ),
    )

    try {
      const payload = {
        slug: activeFormSlug,
        title: editorTitle.trim() || (isDefaultForm ? defaultStengeskjema.title : activeFormSlug),
        description: editorDescription.trim() || '',
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
      setEditorQuestions(preparedQuestions)
      setSaveState({ saving: false, message: 'Skjema oppdatert.', error: '' })
    } catch {
      setSaveState({
        saving: false,
        message: '',
        error: 'Kunne ikke lagre skjema. Prøv igjen.',
      })
    }
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
          placeholder={question.placeholder || ''}
          required={question.required}
          rows={4}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        />
      )
    }

    if (question.type === 'select') {
      return (
        <select
          id={question.id}
          value={value}
          required={question.required}
          onChange={(event) => onAnswerChange(question.id, event.target.value)}
        >
          <option value="">Velg</option>
          {(question.options || []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
    }

    if (question.type === 'camera') {
      return (
        <>
          <input
            id={question.id}
            type="file"
            accept="image/*"
            capture="environment"
            required={question.required}
            onChange={(event) => {
              const file = event.target.files?.[0] || null
              setCameraFiles((previous) => ({
                ...previous,
                [question.id]: file,
              }))
              onAnswerChange(question.id, file ? file.name : '')
            }}
          />
          {cameraFiles[question.id] ? (
            <small>Valgt: {cameraFiles[question.id].name}</small>
          ) : null}
        </>
      )
    }

    if (question.type === 'name') {
      return (
        <input
          id={question.id}
          type="text"
          value={value}
          placeholder={question.placeholder || 'Fullt navn'}
          autoComplete="name"
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
        placeholder={question.placeholder || ''}
        required={question.required}
        onChange={(event) => onAnswerChange(question.id, event.target.value)}
      />
    )
  }

  return (
    <div className="forms-page stengeskjema-page">
      <Link className="admin-login-link" to="/skjema">
        Tilbake til alle skjema
      </Link>
      <header className="forms-hero">
        <p className="eyebrow">Skjema</p>
        <h1>{formData.title}</h1>
        <p className="lead">{formData.description}</p>
      </header>

      {!isSubmissionsView && !isEditPage ? (
        <section className="form-entry">
          <h2>Send inn skjema</h2>
          {loadingForm ? <p>Laster skjema...</p> : null}
          <form onSubmit={onSubmit} className="dynamic-form">
            {formData.questions.map((question) => (
              <label key={question.id} htmlFor={question.id} className="field-block">
                <span>
                  {question.label}
                  {question.required ? ' *' : ''}
                </span>
                {renderQuestionInput(question)}
              </label>
            ))}

            <label htmlFor="form-images" className="field-block">
              <span>Legg ved bilder (valgfritt)</span>
              <input
                id="form-images"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(event) => setImages(Array.from(event.target.files || []))}
              />
            </label>

            {images.length > 0 ? (
              <p className="image-count">Valgte bilder: {images.length}</p>
            ) : null}

            {submitState.error ? <p className="forms-error">{submitState.error}</p> : null}
            {submitState.message ? <p className="forms-success">{submitState.message}</p> : null}

            <button type="submit" className="cta" disabled={submitState.submitting || loadingForm}>
              {submitState.submitting ? 'Sender...' : 'Send skjema'}
            </button>
          </form>
        </section>
      ) : null}

      {isEditPage && !isAdmin && !loading ? (
        <section className="admin-login-line">
          <p className="forms-error">Kun admin kan redigere skjema.</p>
        </section>
      ) : null}

      {isAdmin && (isSubmissionsView || isEditPage) ? (
        <section className={isEditPage || isSubmissionsView ? 'admin-edit-shell' : 'admin-box'}>
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

                <div className="editor-questions">
                  {editorQuestions.map((question, index) => (
                    <article key={`${question.id}-${index}`} className="editor-question-card">
                      <p>Spørsmål {index + 1}</p>
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
                          <option value="number">Tall</option>
                          <option value="date">Dato</option>
                          <option value="camera">Ta bilde fra kamera</option>
                          <option value="name">User's name</option>
                        </select>
                      </label>

                      {question.type === 'select' ? (
                        <label className="field-block" htmlFor={`q-options-${index}`}>
                          <span>Valg (kommaseparert)</span>
                          <input
                            id={`q-options-${index}`}
                            type="text"
                            value={(question.options || []).join(', ')}
                            onChange={(event) =>
                              onEditorQuestionChange(index, 'options', event.target.value)
                            }
                          />
                        </label>
                      ) : null}

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

                      <button
                        type="button"
                        className="ghost"
                        onClick={() => removeQuestion(index)}
                        disabled={editorQuestions.length <= 1}
                      >
                        Fjern spørsmål
                      </button>
                      <div className="question-order-actions">
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
                      </div>
                    </article>
                  ))}
                </div>

                <div className="admin-actions">
                  <button type="button" className="ghost" onClick={addQuestion}>
                    Legg til spørsmål
                  </button>
                  <button
                    type="button"
                    className="cta"
                    onClick={onSaveForm}
                    disabled={saveState.saving}
                  >
                    {saveState.saving ? 'Lagrer...' : 'Lagre skjema'}
                  </button>
                </div>

                {saveState.error ? <p className="forms-error">{saveState.error}</p> : null}
                {saveState.message ? <p className="forms-success">{saveState.message}</p> : null}
              </div>
            ) : null}

            {isSubmissionsView ? (
              <div className="responses-box" id="submissions-section">
                <h3>Innsendinger</h3>
                {loadingSubmissions ? <p>Laster innsendinger...</p> : null}
                {!loadingSubmissions && submissions.length === 0 ? (
                  <p>Ingen innsendinger enda.</p>
                ) : null}

                {!loadingSubmissions && submissions.length > 0 ? (
                  <div className="submissions-table-wrap">
                    <table className="submissions-table">
                      <thead>
                        <tr>
                          <th>Submitted</th>
                          <th>Name</th>
                          <th>Time</th>
                          <th>Location</th>
                          <th>View submission</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submissions.map((submission) => {
                          const rowState = statusUpdateState[submission.id] || {}
                          const currentStatus = submission.status || 'awaiting review'
                          return (
                            <tr key={submission.id}>
                              <td>{getDatePart(submission.submittedAt)}</td>
                              <td>{getSubmissionName(submission.answers, formData.questions)}</td>
                              <td>{getClockPart(submission.submittedAt)}</td>
                              <td>{getSubmissionPlace(submission.answers)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() => onViewSubmission(submission.id)}
                                >
                                  View submission
                                </button>
                              </td>
                              <td>
                                <div className="submission-status-cell">
                                  <select
                                    value={currentStatus}
                                    onChange={(event) =>
                                      onUpdateSubmissionStatus(submission.id, event.target.value)
                                    }
                                    disabled={rowState.saving}
                                  >
                                    <option value="awaiting review">awaiting review</option>
                                    <option value="completed">completed</option>
                                    <option value="needs follow-up">needs follow-up</option>
                                  </select>
                                  <small>
                                    [{currentStatus}] updated by{' '}
                                    {submission.statusUpdatedBy || 'system'} on{' '}
                                    {formatTime(submission.statusUpdatedAt || submission.submittedAt)}
                                  </small>
                                  {rowState.error ? (
                                    <small className="forms-error">{rowState.error}</small>
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

              {selectedSubmission ? (
                  <div className="submission-modal-backdrop" onClick={closeSubmissionModal}>
                    <div
                      className="submission-modal"
                      role="dialog"
                      aria-modal="true"
                      aria-label="Submission details"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="submission-modal-header">
                        <h4>Submission details</h4>
                        <div className="submission-modal-actions">
                          <button
                            type="button"
                            className="ghost danger-button"
                            onClick={() => onDeleteSubmission(selectedSubmission.id)}
                            disabled={deleteSubmissionState[selectedSubmission.id]?.deleting}
                          >
                            {deleteSubmissionState[selectedSubmission.id]?.deleting
                              ? 'Deleting...'
                              : 'Delete submission'}
                          </button>
                          <button type="button" className="ghost" onClick={closeSubmissionModal}>
                            Lukk
                          </button>
                        </div>
                      </div>
                      <div className="submission-modal-content">
                        <p>
                          <strong>ID:</strong> {selectedSubmission.id}
                        </p>
                        <p>
                          <strong>Submitted:</strong> {formatTime(selectedSubmission.submittedAt)}
                        </p>
                        <div className="response-grid">
                          {Object.entries(selectedSubmission.answers || {}).map(([key, value]) => (
                            <p key={`${selectedSubmission.id}-${key}`}>
                              <strong>{key}:</strong>{' '}
                              {isStorageImagePath(value) ? 'Bilde vedlagt' : String(value || '-')}
                            </p>
                          ))}
                        </div>

                        <div className="submission-modal-images">
                          <h5>Bilder</h5>
                          {deleteSubmissionState[selectedSubmission.id]?.error ? (
                            <p className="forms-error">
                              {deleteSubmissionState[selectedSubmission.id]?.error}
                            </p>
                          ) : null}
                          {selectedSubmissionImagesLoading ? <p>Laster bilder...</p> : null}
                          {!selectedSubmissionImagesLoading && selectedSubmissionImageUrls.length === 0 ? (
                            <p>Ingen bilder i innsendingen.</p>
                          ) : null}
                          {!selectedSubmissionImagesLoading && selectedSubmissionImageUrls.length > 0 ? (
                            <div className="response-images">
                              {selectedSubmissionImageUrls.map((url) => (
                                <img key={url} src={url} alt="Innsendt bilde" loading="lazy" />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
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
