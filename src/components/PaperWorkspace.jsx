import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Columns2, Eraser, ExternalLink, FileCheck2, FileText, GripVertical, Hand, Maximize2, Minimize2, Minus, NotebookPen, NotebookText, PenTool, Plus, Save, Trash2 } from 'lucide-react'
import { getExamPaperProfile } from '../data/examStructure'
import { paperQuestionMarkingMetadata } from '../data/questionBank'
import { deletePaperEvidence, getPaperEvidence, putPaperEvidence } from '../lib/evidenceStorage'
import { buildSharedMarkingSubmission, completedMarksByQuestion, createSharedMarkingSubmission, loadQuestionAsset, paperSubmissionMarkingSummary, retrySharedMarkingSubmission, waitForSharedMarkingSubmission } from '../lib/paperMarking'
import { AiCoach } from './AiCoach'
import { PaperAnswerSheet, SelfMarkSummary } from './PaperAnswerSheet'
import { PdfViewer } from './PdfViewer'

function formatTime(totalSec) {
  const minutes = Math.floor(totalSec / 60)
  return `${minutes}:${String(totalSec % 60).padStart(2, '0')}`
}

function hasResponse(profile, answer = {}) {
  if (profile.mode === 'mcq') return Boolean(answer.choice)
  return Boolean(String(answer.response || answer.finalAnswer || answer.working || '').trim() || answer.image)
}

function responseText(answer = {}) {
  return String(answer.response || [answer.working, answer.finalAnswer].filter(Boolean).join('\n\n') || '')
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The saved handwriting image could not be read.'))
    reader.readAsDataURL(blob)
  })
}

function cleanAnswers(answers) {
  return Object.fromEntries(Object.entries(answers).map(([questionNumber, answer]) => {
    if (!answer.image) return [questionNumber, answer]
    const { previewUrl: _previewUrl, dataUrl: _dataUrl, ...image } = answer.image
    return [questionNumber, { ...answer, image }]
  }))
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const sourceUrl = URL.createObjectURL(file)
    image.onload = () => {
      const maxSide = 1600
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      const canvas = window.document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d', { alpha: false }).drawImage(image, 0, 0, width, height)
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(sourceUrl)
        if (blob) resolve({ blob, width, height })
        else reject(new Error('Image compression failed'))
      }, 'image/jpeg', 0.8)
    }
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl)
      reject(new Error('This image could not be read'))
    }
    image.src = sourceUrl
  })
}

const ANSWER_PANE_STORAGE_KEY = 'alevel-paper-answer-pane-width'
const DEFAULT_ANSWER_PANE_WIDTH = 450
const MIN_ANSWER_PANE_WIDTH = 360
const MIN_PDF_PANE_WIDTH = 480

function storedAnswerPaneWidth() {
  const value = Number(window.localStorage.getItem(ANSWER_PANE_STORAGE_KEY))
  return Number.isFinite(value) ? Math.max(MIN_ANSWER_PANE_WIDTH, value) : DEFAULT_ANSWER_PANE_WIDTH
}

function defaultQuestionCount(profile) {
  if (profile.defaultQuestionCount) return profile.defaultQuestionCount
  if (profile.subject === 'bpho') return profile.questionCountRange?.[0] || 1
  if (profile.mode === 'practical') return 2
  return 12
}

export function PaperWorkspace({ paper, catalog, draft, sharedIdentityToken = '', onBack, onSaveDraft, onFinish, onFinishReview }) {
  const itemById = useMemo(() => new Map((catalog?.items || []).map((item) => [item.id, item])), [catalog])
  const questionPaper = itemById.get(paper.questionPaperId) || (paper.kind === 'qp' ? paper : null)
  const markScheme = itemById.get(paper.markSchemeId)
  const examinerReport = useMemo(
    () => (catalog?.items || []).find((item) => item.subject === paper.subject && item.sessionCode === paper.sessionCode && item.kind === 'er'),
    [catalog, paper.sessionCode, paper.subject],
  )
  const sourcePaper = questionPaper || paper
  const profile = useMemo(() => sourcePaper.examProfile || getExamPaperProfile(sourcePaper.subject, sourcePaper.variant, sourcePaper.year) || {
    code: `${sourcePaper.subject}/${sourcePaper.variant || ''}`,
    title: 'Structured paper',
    mode: 'structured',
    durationMinutes: null,
    maxMarks: null,
    defaultQuestionCount: null,
    questionCountRange: [1, 30],
    stages: [],
  }, [sourcePaper])
  const questionMetadataByNumber = useMemo(() => paperQuestionMarkingMetadata({ paperId: sourcePaper.id, routeId: sourcePaper.routeId }), [sourcePaper.id, sourcePaper.routeId])
  const reviewedMaxMarks = useMemo(() => Object.fromEntries(Object.entries(questionMetadataByNumber).map(([number, metadata]) => [number, metadata.maxMarks])), [questionMetadataByNumber])
  const [attemptId] = useState(() => draft?.attemptId || `paper-attempt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`)
  const [elapsedSec, setElapsedSec] = useState(draft?.elapsedSec || 0)
  const [notes, setNotes] = useState(draft?.notes || '')
  const [answers, setAnswers] = useState(draft?.answers || {})
  const [submitted, setSubmitted] = useState(Boolean(draft?.submitted))
  const [selfMarks, setSelfMarks] = useState(draft?.selfMarks || {})
  const [maxMarksByQuestion, setMaxMarksByQuestion] = useState(() => ({ ...reviewedMaxMarks, ...(draft?.maxMarksByQuestion || {}) }))
  const [lastSavedReview, setLastSavedReview] = useState(draft?.lastSavedReview || null)
  const [aiMarks, setAiMarks] = useState(draft?.aiMarks || {})
  const [focusedQuestion, setFocusedQuestion] = useState(draft?.focusedQuestion || 1)
  const [coachRequest, setCoachRequest] = useState(0)
  const [questionCount, setQuestionCount] = useState(draft?.questionCount || defaultQuestionCount(profile))
  const [documentMode, setDocumentMode] = useState(paper.kind === 'ms' ? 'mark' : paper.kind === 'er' ? 'report' : 'question')
  const [pdfWritingEnabled, setPdfWritingEnabled] = useState(() => Boolean(draft?.pdfWritingEnabled) && profile.mode !== 'mcq' && !draft?.submitted)
  const [pdfInkTool, setPdfInkTool] = useState('pen')
  const [pdfInkByPage, setPdfInkByPage] = useState(draft?.pdfInkByPage || {})
  // Older drafts inferred a question from whichever answer slot had focus. That
  // makes cover-page ink look like a Q1 response, so only explicit v2 links are
  // eligible for completion or marking.
  const [pdfInkQuestionMap, setPdfInkQuestionMap] = useState(() => draft?.pdfInkMapVersion === 2 ? (draft?.pdfInkQuestionMap || {}) : {})
  const [lastPdfInkPage, setLastPdfInkPage] = useState(null)
  const [mobilePane, setMobilePane] = useState('paper')
  const [immersive, setImmersive] = useState(false)
  const [answerPaneWidth, setAnswerPaneWidth] = useState(storedAnswerPaneWidth)
  const [saveStatus, setSaveStatus] = useState(draft ? 'Restored' : 'Ready')
  const [showSubmitCheck, setShowSubmitCheck] = useState(false)
  const [evidenceStatus, setEvidenceStatus] = useState('')
  const initialAnswers = useRef(draft?.answers || {})
  const objectUrls = useRef(new Set())
  const imageSaveVersion = useRef({})
  const saveVersion = useRef(0)
  const latestDraft = useRef(null)
  const paperDeskRef = useRef(null)
  const resizeState = useRef(null)
  const isAttempt = paper.kind === 'qp'
  const canReview = !isAttempt || submitted
  const pdfInkQuestionNumbers = useMemo(() => [...new Set(Object.values(pdfInkQuestionMap).flat().map(Number).filter(Number.isFinite))], [pdfInkQuestionMap])
  const responseQuestionNumbers = useMemo(() => [...new Set([
    ...Object.entries(answers).filter(([, answer]) => hasResponse(profile, answer)).map(([number]) => Number(number)),
    ...pdfInkQuestionNumbers,
  ])].filter(Number.isFinite), [answers, pdfInkQuestionNumbers, profile])
  const markingSummary = paperSubmissionMarkingSummary({ submitted, aiMarks, responseQuestionNumbers })
  const answeredCount = Array.from({ length: questionCount }, (_, index) => index + 1).filter((questionNumber) => hasResponse(profile, answers[questionNumber]) || pdfInkQuestionNumbers.includes(questionNumber)).length
  const displayPaper = documentMode === 'mark' ? markScheme : documentMode === 'report' ? examinerReport : questionPaper || paper
  const title = documentMode === 'compare' ? `${questionPaper?.file} + ${markScheme?.file}` : displayPaper?.file || paper.file
  const [minimumQuestions, maximumQuestions] = profile.questionCountRange || [1, 30]
  const questionCountFixed = minimumQuestions === maximumQuestions
  const componentLabel = profile.paperNumber ? `P${profile.paperNumber}` : profile.title || sourcePaper.subject.toUpperCase()

  latestDraft.current = {
    schemaVersion: 2,
    attemptId,
    paperId: sourcePaper.id,
    pairKey: sourcePaper.pairKey,
    retestOf: paper.retestOf || null,
    paperRef: { subject: sourcePaper.subject, file: sourcePaper.file, sha256: sourcePaper.sha256, sessionCode: sourcePaper.sessionCode, variant: sourcePaper.variant, questionPaperId: sourcePaper.id, markSchemeId: markScheme?.id || null },
    profile,
    questionCount,
    answers,
    focusedQuestion,
    pdfInkByPage,
    pdfInkQuestionMap,
    pdfInkMapVersion: 2,
    pdfWritingEnabled,
    submitted,
    selfMarks,
    maxMarksByQuestion,
    lastSavedReview,
    aiMarks,
    elapsedSec,
    notes,
  }

  function persistLatestDraft() {
    const snapshot = latestDraft.current
    if (!snapshot) return
    onSaveDraft({ ...snapshot, answers: cleanAnswers(snapshot.answers), updatedAt: new Date().toISOString() })
  }

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSec((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    async function hydrateEvidence() {
      const hydrated = await Promise.all(Object.entries(initialAnswers.current).map(async ([questionNumber, answer]) => {
        if (!answer.image?.id || answer.image.previewUrl) return [questionNumber, answer]
        const stored = await getPaperEvidence(answer.image.id)
        if (!stored?.blob || !active) return [questionNumber, answer]
        const previewUrl = URL.createObjectURL(stored.blob)
        objectUrls.current.add(previewUrl)
        return [questionNumber, { ...answer, image: { ...answer.image, previewUrl } }]
      }))
      if (active) setAnswers(Object.fromEntries(hydrated))
    }
    hydrateEvidence().catch(() => active && setEvidenceStatus('One saved notebook image could not be restored.'))
    return () => { active = false }
  }, [attemptId])

  useEffect(() => {
    setMaxMarksByQuestion((current) => ({ ...reviewedMaxMarks, ...current }))
  }, [reviewedMaxMarks])

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }, [])

  useEffect(() => {
    const version = saveVersion.current + 1
    saveVersion.current = version
    setSaveStatus('Saving...')
    const timeout = window.setTimeout(() => {
      persistLatestDraft()
      if (saveVersion.current === version) setSaveStatus('Autosaved')
    }, 420)
    return () => window.clearTimeout(timeout)
    // Timer checkpoints are saved separately without changing the visible status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMarks, answers, attemptId, focusedQuestion, markScheme?.id, maxMarksByQuestion, notes, onSaveDraft, paper.retestOf, pdfInkByPage, pdfInkQuestionMap, profile, questionCount, selfMarks, sourcePaper, submitted])

  useEffect(() => {
    const checkpoint = window.setInterval(persistLatestDraft, 15000)
    function saveWhenHidden() {
      if (document.visibilityState === 'hidden') persistLatestDraft()
    }
    window.addEventListener('pagehide', persistLatestDraft)
    document.addEventListener('visibilitychange', saveWhenHidden)
    return () => {
      window.clearInterval(checkpoint)
      window.removeEventListener('pagehide', persistLatestDraft)
      document.removeEventListener('visibilitychange', saveWhenHidden)
    }
    // The latest draft is read from a ref so this checkpoint stays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSaveDraft])

  function answerPaneBounds() {
    const deskWidth = paperDeskRef.current?.clientWidth || window.innerWidth
    return {
      min: MIN_ANSWER_PANE_WIDTH,
      max: Math.max(MIN_ANSWER_PANE_WIDTH, deskWidth - MIN_PDF_PANE_WIDTH - 16),
    }
  }

  function resizeAnswerPane(nextWidth, persist = false) {
    const bounds = answerPaneBounds()
    const width = Math.round(Math.min(bounds.max, Math.max(bounds.min, nextWidth)))
    setAnswerPaneWidth(width)
    if (persist) window.localStorage.setItem(ANSWER_PANE_STORAGE_KEY, String(width))
    return width
  }

  function startPaneResize(event) {
    if (window.matchMedia('(max-width: 1040px)').matches) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    resizeState.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: answerPaneWidth, currentWidth: answerPaneWidth }
  }

  function movePaneResize(event) {
    const resize = resizeState.current
    if (!resize || resize.pointerId !== event.pointerId) return
    event.preventDefault()
    resize.currentWidth = resizeAnswerPane(resize.startWidth + resize.startX - event.clientX)
  }

  function finishPaneResize(event) {
    const resize = resizeState.current
    if (!resize || resize.pointerId !== event.pointerId) return
    const finalWidth = resize.currentWidth
    resizeState.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    resizeAnswerPane(finalWidth, true)
  }

  function resizePaneWithKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') resizeAnswerPane(DEFAULT_ANSWER_PANE_WIDTH, true)
    else resizeAnswerPane(answerPaneWidth + (event.key === 'ArrowLeft' ? 24 : -24), true)
  }

  function updateAnswer(questionNumber, nextAnswer) {
    setAnswers((current) => ({ ...current, [questionNumber]: nextAnswer }))
  }

  function updatePdfInk(pageNumber, ink) {
    setPdfInkByPage((current) => ({ ...current, [pageNumber]: ink }))
    setLastPdfInkPage(Number(pageNumber))
  }

  function linkPdfInkToQuestion(questionNumber) {
    if (!Number.isFinite(lastPdfInkPage) || !pdfInkByPage[lastPdfInkPage]) {
      setEvidenceStatus('Write on a PDF page first, then link that page to this answer slot.')
      return
    }
    setPdfInkQuestionMap((current) => ({
      ...current,
      [lastPdfInkPage]: [...new Set([...(current[lastPdfInkPage] || []), Number(questionNumber)])],
    }))
    setEvidenceStatus(`PDF page ${lastPdfInkPage} linked to question ${questionNumber}.`)
  }

  function clearPdfInk() {
    setPdfInkByPage({})
    setPdfInkQuestionMap({})
  }

  async function updateImage(questionNumber, file) {
    const version = (imageSaveVersion.current[questionNumber] || 0) + 1
    imageSaveVersion.current[questionNumber] = version
    const currentImage = answers[questionNumber]?.image
    if (!file) {
      if (currentImage?.id) await deletePaperEvidence(currentImage.id)
      if (currentImage?.previewUrl) {
        URL.revokeObjectURL(currentImage.previewUrl)
        objectUrls.current.delete(currentImage.previewUrl)
      }
      updateAnswer(questionNumber, { ...answers[questionNumber], image: null })
      return
    }
    if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) {
      setEvidenceStatus('Choose an image under 12 MB from Photos, Camera or Files.')
      return
    }
    setEvidenceStatus('Preparing notebook image...')
    try {
      const { blob, width, height } = await compressImage(file)
      const id = `${attemptId}-q${questionNumber}-${Date.now()}`
      await putPaperEvidence({ id, attemptId, questionNumber, blob, name: file.name, width, height, pages: file.answerPages || 1, createdAt: new Date().toISOString() })
      if (imageSaveVersion.current[questionNumber] !== version) {
        await deletePaperEvidence(id)
        return
      }
      const previewUrl = URL.createObjectURL(blob)
      objectUrls.current.add(previewUrl)
      if (currentImage?.id) await deletePaperEvidence(currentImage.id)
      setAnswers((current) => ({ ...current, [questionNumber]: {
        ...current[questionNumber],
        image: { id, name: file.name, type: blob.type, bytes: blob.size, width, height, pages: file.answerPages || 1, previewUrl, recognitionStatus: 'visual-review-required' },
      } }))
      setEvidenceStatus('Notebook image saved locally for visual review.')
    } catch {
      setEvidenceStatus('The notebook image could not be saved. Try a smaller image.')
    }
  }

  function setCount(nextCount) {
    setQuestionCount(Math.min(maximumQuestions, Math.max(minimumQuestions, Number(nextCount) || minimumQuestions)))
  }

  function openDocument(mode) {
    setDocumentMode(mode)
    setMobilePane('paper')
  }

  function requestSubmit() {
    if (answeredCount < questionCount) setShowSubmitCheck(true)
    else submitPaper()
  }

  async function responseForSharedMarking(questionNumber) {
    const answer = answers[questionNumber] || {}
    const questionMetadata = questionMetadataByNumber[questionNumber]
    const inkPage = Object.entries(pdfInkQuestionMap).find(([, questions]) => questions.map(Number).includes(Number(questionNumber)))?.[0]
    const pdfInk = inkPage ? pdfInkByPage[inkPage] : null
    let handwritingImageDataUrl = answer.image?.dataUrl || pdfInk?.inkDataUrl || pdfInk?.dataUrl || ''
    if (!handwritingImageDataUrl && answer.image?.id) {
      const stored = await getPaperEvidence(answer.image.id)
      if (stored?.blob) handwritingImageDataUrl = await blobToDataUrl(stored.blob)
    }
    if (!handwritingImageDataUrl && answer.image?.previewUrl) {
      const response = await fetch(answer.image.previewUrl)
      handwritingImageDataUrl = await blobToDataUrl(await response.blob())
    }
    return {
      questionNumber,
      questionMetadata,
      typedText: responseText(answer),
      handwritingImageDataUrl,
      questionAsset: await loadQuestionAsset({ sourceRef: questionMetadata?.sourceRef }),
    }
  }

  async function markAllResponses() {
    const questionNumbers = responseQuestionNumbers
    if (!questionNumbers.length) return
    try {
      const responses = await Promise.all(questionNumbers.map(responseForSharedMarking))
      const contract = buildSharedMarkingSubmission({
        attemptId,
        routeId: sourcePaper.routeId,
        specificationVersion: profile.title,
        paperId: sourcePaper.id,
        responses,
      })
      if (contract.missingQuestionNumbers.length) {
        setAiMarks((current) => ({ ...current, ...Object.fromEntries(contract.missingQuestionNumbers.map((number) => [number, { status: 'missing_metadata', code: 'question_metadata_missing' }])) }))
      }
      const queuedQuestionNumbers = [...new Set(Object.values(contract.questionNumberByPartId))]
      if (!contract.ok) return
      if (!sharedIdentityToken) {
        setAiMarks((current) => ({ ...current, ...Object.fromEntries(queuedQuestionNumbers.map((number) => [number, { status: 'failed', failureCode: 'identity_required', loginRequired: true }])) }))
        return
      }
      setAiMarks((current) => ({ ...current, ...Object.fromEntries(queuedQuestionNumbers.map((number) => [number, { status: 'queued', submissionId: contract.payload.submissionId }])) }))
      let submission = await createSharedMarkingSubmission({ token: sharedIdentityToken, submission: contract.payload })
      if (submission.status === 'queued' || submission.status === 'processing') {
        setAiMarks((current) => ({ ...current, ...Object.fromEntries(queuedQuestionNumbers.map((number) => [number, { status: submission.status, submissionId: contract.payload.submissionId }])) }))
        submission = await waitForSharedMarkingSubmission({
          token: sharedIdentityToken,
          submissionId: contract.payload.submissionId,
          onStatus: (nextSubmission) => {
            if (!['queued', 'processing'].includes(nextSubmission.status)) return
            setAiMarks((current) => ({ ...current, ...Object.fromEntries(queuedQuestionNumbers.map((number) => [number, { status: nextSubmission.status, submissionId: contract.payload.submissionId }])) }))
          },
        })
      }
      if (submission.status === 'completed') {
        const results = completedMarksByQuestion(submission, contract.questionNumberByPartId)
        setAiMarks((current) => ({ ...current, ...results }))
        setSelfMarks((current) => ({ ...current, ...Object.fromEntries(Object.entries(results).map(([number, result]) => [number, result.rawMarks])) }))
        setMaxMarksByQuestion((current) => ({ ...current, ...Object.fromEntries(Object.entries(results).map(([number, result]) => [number, result.maxMarks])) }))
        return
      }
      const terminal = submission.status === 'missing_metadata'
        ? { status: 'missing_metadata', metadataIssues: submission.metadataIssues || [] }
        : { status: 'failed', submissionId: contract.payload.submissionId, failureCode: submission.failureCode || 'provider_unavailable', retryable: Boolean(submission.retryable) }
      setAiMarks((current) => ({ ...current, ...Object.fromEntries(queuedQuestionNumbers.map((number) => [number, terminal])) }))
    } catch (error) {
      setAiMarks((current) => ({ ...current, ...Object.fromEntries(questionNumbers.filter((number) => questionMetadataByNumber[number]).map((number) => [number, { status: 'failed', failureCode: error.code || 'service_unavailable', retryable: Boolean(error.retryable), loginRequired: Boolean(error.loginRequired) }])) }))
    }
  }

  async function retryMarking(questionNumber) {
    const current = aiMarks[questionNumber]
    if (current?.status !== 'failed' || !current.submissionId || !sharedIdentityToken) return
    const submissionId = current.submissionId
    setAiMarks((value) => ({ ...value, [questionNumber]: { ...current, status: 'queued', retryable: false } }))
    try {
      let submission = await retrySharedMarkingSubmission({ token: sharedIdentityToken, submissionId })
      if (submission.status === 'queued' || submission.status === 'processing') {
        setAiMarks((value) => ({ ...value, [questionNumber]: { ...value[questionNumber], status: submission.status, submissionId } }))
        submission = await waitForSharedMarkingSubmission({
          token: sharedIdentityToken,
          submissionId,
          onStatus: (next) => {
            if (next.status === 'queued' || next.status === 'processing') setAiMarks((value) => ({ ...value, [questionNumber]: { ...value[questionNumber], status: next.status, submissionId } }))
          },
        })
      }
      if (submission.status === 'completed') {
        const metadata = questionMetadataByNumber[questionNumber]
        const partIds = Object.fromEntries((metadata?.parts || []).map((part) => [part.id, questionNumber]))
        const result = completedMarksByQuestion(submission, partIds)[questionNumber]
        if (result) {
          setAiMarks((value) => ({ ...value, [questionNumber]: result }))
          setSelfMarks((value) => ({ ...value, [questionNumber]: result.rawMarks }))
          setMaxMarksByQuestion((value) => ({ ...value, [questionNumber]: result.maxMarks }))
          return
        }
      }
      const terminal = submission.status === 'missing_metadata'
        ? { status: 'missing_metadata', metadataIssues: submission.metadataIssues || [] }
        : { status: 'failed', submissionId, failureCode: submission.failureCode || 'provider_unavailable', retryable: Boolean(submission.retryable) }
      setAiMarks((value) => ({ ...value, [questionNumber]: terminal }))
    } catch (error) {
      setAiMarks((value) => ({ ...value, [questionNumber]: { status: 'failed', submissionId, failureCode: error.code || 'service_unavailable', retryable: Boolean(error.retryable), loginRequired: Boolean(error.loginRequired) } }))
    }
  }

  function submitPaper() {
    if (submitted) return
    const submittedAt = new Date().toISOString()
    const snapshot = cleanAnswers(answers)
    setSubmitted(true)
    setShowSubmitCheck(false)
    if (markScheme) {
      setDocumentMode('compare')
      setMobilePane('paper')
    }
    onFinish({
      attemptId,
      paperId: sourcePaper.id,
      pairKey: sourcePaper.pairKey,
      subject: sourcePaper.subject,
      file: sourcePaper.file,
      profile,
      questionCount,
      answeredCount,
      answers: snapshot,
      pdfInkByPage,
      pdfInkQuestionMap,
      elapsedSec,
      notes,
      retestOf: paper.retestOf || null,
      submittedAt,
    })
    setAiMarks((current) => ({ ...current, ...Object.fromEntries(responseQuestionNumbers.map((questionNumber) => [questionNumber, questionMetadataByNumber[questionNumber] ? { status: 'queued' } : { status: 'missing_metadata', code: 'question_metadata_missing' }])) }))
    void markAllResponses()
  }

  function finishReview() {
    const completedQuestionNumbers = responseQuestionNumbers.filter((questionNumber) => {
      const awarded = selfMarks[questionNumber]
      const available = maxMarksByQuestion[questionNumber]
      const awardedNumber = Number(awarded)
      const availableNumber = Number(available)
      return awarded !== '' && awarded != null && available !== '' && available != null
        && Number.isFinite(awardedNumber) && Number.isFinite(availableNumber)
        && awardedNumber >= 0 && availableNumber >= 0 && awardedNumber <= availableNumber
    })
    const marks = completedQuestionNumbers.map((questionNumber) => Number(selfMarks[questionNumber]))
    const available = completedQuestionNumbers.map((questionNumber) => Number(maxMarksByQuestion[questionNumber]))
    const review = {
      attemptId,
      paperId: sourcePaper.id,
      selfMarks,
      maxMarksByQuestion,
      aiMarks,
      rawMarks: marks.reduce((sum, value) => sum + value, 0),
      maxMarks: profile.mode === 'mcq' ? questionCount : available.reduce((sum, value) => sum + value, 0),
      reviewedAt: new Date().toISOString(),
      officialResult: false,
    }
    const signature = JSON.stringify({
      scoredQuestionNumbers: completedQuestionNumbers,
      selfMarks: Object.fromEntries(completedQuestionNumbers.map((questionNumber) => [questionNumber, selfMarks[questionNumber]])),
      maxMarksByQuestion: Object.fromEntries(completedQuestionNumbers.map((questionNumber) => [questionNumber, maxMarksByQuestion[questionNumber]])),
    })
    if (lastSavedReview?.signature === signature) return
    setLastSavedReview({ savedAt: review.reviewedAt, rawMarks: review.rawMarks, maxMarks: review.maxMarks, signature })
    onFinishReview(review)
  }

  return (
    <section className={`paper-workspace ${immersive ? 'paper-workspace--immersive' : ''}`}>
      <header className="paper-workspace-header">
        <button type="button" className="icon-button" onClick={() => { persistLatestDraft(); onBack() }} aria-label="Back to paper library"><ArrowLeft size={19} /></button>
        <div className="workspace-title"><strong>{title}</strong><small>{profile.title} · {paper.season} {paper.year} · verified local PDF</small></div>
        <div className="paper-workspace-actions">
          <span className="timer"><Clock3 size={16} />{formatTime(elapsedSec)}</span>
          <span className="save-state" aria-live="polite"><Save size={16} /><span>{saveStatus}</span></span>
          <a className="icon-button" href={(displayPaper || paper).localUrl} target="_blank" rel="noreferrer" aria-label="Open PDF in a new tab"><ExternalLink size={18} /></a>
          <button type="button" className="paper-focus-button" onClick={() => setImmersive((value) => !value)} aria-label={immersive ? 'Exit paper focus mode' : 'Enter paper focus mode'} aria-pressed={immersive} title={immersive ? 'Exit paper focus mode' : 'Enter paper focus mode'}>{immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
          {isAttempt && <button type="button" className="submit-button" onClick={requestSubmit} disabled={submitted}>{submitted ? 'Submitted' : 'Submit paper'}</button>}
        </div>
      </header>

      <div className="paper-document-tabs" role="tablist" aria-label="Paper documents">
        <button type="button" className={documentMode === 'question' ? 'active' : ''} disabled={!questionPaper} onClick={() => openDocument('question')}><FileText size={17} />Question paper</button>
        {isAttempt && profile.mode !== 'mcq' && <button type="button" className={pdfWritingEnabled ? 'active' : ''} aria-pressed={pdfWritingEnabled} disabled={submitted || documentMode !== 'question'} onClick={() => setPdfWritingEnabled((value) => !value)}><NotebookPen size={17} />Write on PDF</button>}
        {isAttempt && profile.mode !== 'mcq' && pdfWritingEnabled && <><button type="button" className={pdfInkTool === 'pen' ? 'active' : ''} disabled={submitted} onClick={() => setPdfInkTool('pen')} title="Write on the PDF" aria-label="PDF pen"><PenTool size={17} /></button><button type="button" className={pdfInkTool === 'eraser' ? 'active' : ''} disabled={submitted} onClick={() => setPdfInkTool('eraser')} title="Erase PDF handwriting" aria-label="PDF eraser"><Eraser size={17} /></button><button type="button" className={pdfInkTool === 'hand' ? 'active' : ''} disabled={submitted} onClick={() => setPdfInkTool('hand')} title="Drag to scroll the PDF" aria-label="PDF hand"><Hand size={17} /></button></>}
        {isAttempt && profile.mode !== 'mcq' && Object.keys(pdfInkByPage).length > 0 && <button type="button" disabled={submitted} onClick={clearPdfInk} title="Clear all handwriting placed on the PDF" aria-label="Clear PDF handwriting"><Trash2 size={17} /></button>}
        <button type="button" className={documentMode === 'mark' ? 'active' : ''} disabled={!markScheme || !canReview} title={!canReview ? 'Submit your answer sheet before opening the mark scheme' : 'Open the exact mark scheme'} onClick={() => openDocument('mark')}><FileCheck2 size={17} />Mark scheme</button>
        <button type="button" className={documentMode === 'compare' ? 'active' : ''} disabled={!questionPaper || !markScheme || !canReview} title={!canReview ? 'Submit before comparing answers' : 'Review question paper and mark scheme side by side'} onClick={() => openDocument('compare')}><Columns2 size={17} />Compare</button>
        {examinerReport && <button type="button" className={documentMode === 'report' ? 'active' : ''} disabled={!canReview} onClick={() => openDocument('report')}><NotebookText size={17} />Examiner report</button>}
        <span>{componentLabel} · {profile.durationMinutes ? `${profile.durationMinutes} min` : 'paper timing'} · {profile.maxMarks ? `${profile.maxMarks} marks` : 'source marks'}</span>
      </div>

      <div className="paper-pane-switch" role="tablist" aria-label="Mobile paper workspace">
        <button type="button" role="tab" aria-selected={mobilePane === 'paper'} aria-controls="paper-document-pane" className={mobilePane === 'paper' ? 'active' : ''} onClick={() => setMobilePane('paper')}><FileText size={17} />Paper</button>
        <button type="button" role="tab" aria-selected={mobilePane === 'answer'} aria-controls="paper-answer-pane" className={mobilePane === 'answer' ? 'active' : ''} disabled={!isAttempt} onClick={() => setMobilePane('answer')}><NotebookPen size={17} />Answer sheet <span>{answeredCount}/{questionCount}</span></button>
      </div>

      {questionPaper && !markScheme && <div className="missing-mark-scheme"><AlertTriangle size={18} /><div><strong>No exact mark scheme is present for {questionPaper.file}</strong><span>Another paper's mark scheme will not be substituted.</span></div></div>}
      {paper.agentNotice && <div className="session-complete"><CheckCircle2 size={18} />{paper.agentNotice}</div>}
      {markingSummary && <div className={`session-complete session-complete--${markingSummary.tone}`}><CheckCircle2 size={18} />{markingSummary.text}</div>}
      <div ref={paperDeskRef} className={`paper-desk ${documentMode === 'compare' ? 'compare-mode' : ''} ${!isAttempt ? 'reference-mode' : ''}`} style={{ '--answer-pane-width': `${answerPaneWidth}px` }}>
        <div id="paper-document-pane" role="tabpanel" className={`pdf-stage ${documentMode === 'compare' ? 'pdf-stage-compare' : ''} ${mobilePane !== 'paper' ? 'mobile-pane-hidden' : ''}`}>
          {documentMode === 'compare' ? <div className="pdf-compare"><section><header>Question paper</header><PdfViewer file={questionPaper} annotate={isAttempt && Object.keys(pdfInkByPage).length > 0} readOnly inkByPage={pdfInkByPage} /></section><section><header>Mark scheme</header><PdfViewer file={markScheme} /></section></div> : <PdfViewer file={displayPaper || paper} annotate={isAttempt && documentMode === 'question' && pdfWritingEnabled} inkByPage={pdfInkByPage} inkTool={pdfInkTool} questionNumber={focusedQuestion} onInkChange={updatePdfInk} />}
        </div>
        {isAttempt && <div
          className="paper-splitter"
          role="separator"
          aria-label="Resize paper and answer panes"
          aria-orientation="vertical"
          aria-valuemin={MIN_ANSWER_PANE_WIDTH}
          aria-valuemax={Math.round(answerPaneBounds().max)}
          aria-valuenow={answerPaneWidth}
          tabIndex="0"
          title="Drag to resize the answer pane"
          onDoubleClick={() => resizeAnswerPane(DEFAULT_ANSWER_PANE_WIDTH, true)}
          onKeyDown={resizePaneWithKeyboard}
          onPointerDown={startPaneResize}
          onPointerMove={movePaneResize}
          onPointerUp={finishPaneResize}
          onPointerCancel={finishPaneResize}
        ><GripVertical size={16} /></div>}
        {isAttempt && <aside id="paper-answer-pane" role="tabpanel" className={`paper-response-panel ${mobilePane !== 'answer' ? 'mobile-pane-hidden' : ''}`}>
          {submitted && <SelfMarkSummary
            responseQuestionNumbers={responseQuestionNumbers}
            selfMarks={selfMarks}
            maxMarksByQuestion={maxMarksByQuestion}
            lastSavedReview={lastSavedReview}
            onOpenMarkScheme={() => {
              openDocument('mark')
              setMobilePane('paper')
            }}
            onReviewSubmit={finishReview}
          />}
          {!questionCountFixed && <div className="paper-question-count"><div><strong>Answer slots</strong><span>Match the question numbers printed in this paper.</span></div><div><button type="button" onClick={() => setCount(questionCount - 1)} aria-label="Remove answer slot"><Minus size={16} /></button><input type="number" min={minimumQuestions} max={maximumQuestions} value={questionCount} onChange={(event) => setCount(event.target.value)} aria-label="Number of answer slots" /><button type="button" onClick={() => setCount(questionCount + 1)} aria-label="Add answer slot"><Plus size={16} /></button></div></div>}
          <label className="paper-session-notes"><span>Session notes</span><textarea rows="2" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Formula checks, timing notes, questions to revisit..." /></label>
          {evidenceStatus && <div className="paper-evidence-status" aria-live="polite">{evidenceStatus}</div>}
          <PaperAnswerSheet
            profile={profile}
            questionCount={questionCount}
            activeQuestion={focusedQuestion}
            draftAnswers={answers}
            pdfInkActive={pdfWritingEnabled && profile.mode !== 'mcq'}
            pdfInkQuestionNumbers={pdfInkQuestionNumbers}
            submitted={submitted}
            selfMarks={selfMarks}
            maxMarksByQuestion={maxMarksByQuestion}
            aiMarks={aiMarks}
            questionMetadataByNumber={questionMetadataByNumber}
            onRetryMarking={retryMarking}
            disabled={!isAttempt}
            onAnswerChange={updateAnswer}
            onQuestionFocus={setFocusedQuestion}
            onLinkPdfInkQuestion={linkPdfInkToQuestion}
            onAskCoach={submitted ? (questionNumber) => {
              setFocusedQuestion(questionNumber)
              setCoachRequest((value) => value + 1)
            } : undefined}
            onImageChange={updateImage}
            onSelfMarkChange={(questionNumber, mark) => setSelfMarks((current) => ({ ...current, [questionNumber]: mark }))}
            onMaxMarkChange={(questionNumber, mark) => setMaxMarksByQuestion((current) => ({ ...current, [questionNumber]: mark }))}
            onSubmit={requestSubmit}
            onReviewSubmit={finishReview}
          />
        </aside>}
      </div>

      {showSubmitCheck && <div className="submit-dialog-backdrop" role="presentation" onMouseDown={() => setShowSubmitCheck(false)}><div className="submit-dialog" role="dialog" aria-modal="true" aria-labelledby="paper-submit-title" onMouseDown={(event) => event.stopPropagation()}><AlertTriangle size={24} /><h2 id="paper-submit-title">{questionCount - answeredCount} questions are unanswered</h2><p>Return to the paper or submit the current answer sheet. Blank responses remain unmarked.</p><div><button type="button" className="secondary-action" onClick={() => setShowSubmitCheck(false)}>Keep working</button><button type="button" className="submit-button" onClick={submitPaper}>Submit anyway</button></div></div></div>}
      {submitted && <AiCoach
        key={`${attemptId}:${focusedQuestion}`}
        openRequest={coachRequest}
        showTrigger={false}
        context={{
          attemptId,
          view: 'full-paper',
          subject: { code: sourcePaper.subject, title: profile.title },
          stage: profile.stages?.join(' / ') || 'Cambridge paper',
          component: profile.paperNumber ? `Paper ${profile.paperNumber}` : profile.title,
          paper: { questionFile: questionPaper?.file, markSchemeFile: markScheme?.file },
          question: { number: focusedQuestion, label: `Question ${focusedQuestion}`, prompt: `Question ${focusedQuestion} in ${questionPaper?.file || sourcePaper.file}` },
          response: responseText(answers[focusedQuestion]),
          handwritingAttached: Boolean(answers[focusedQuestion]?.image),
          submitted,
        }}
      />}
    </section>
  )
}
