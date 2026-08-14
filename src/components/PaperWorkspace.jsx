import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Columns2, Eraser, ExternalLink, FileCheck2, FileText, GripVertical, Hand, Maximize2, Minimize2, Minus, NotebookPen, NotebookText, PenTool, Plus, Save, Trash2 } from 'lucide-react'
import { getExamPaperProfile } from '../data/examStructure'
import { paperQuestionMarkingMetadata } from '../lib/verifiedPracticeCatalog'
import { deletePaperEvidence, getPaperEvidence, putPaperEvidence } from '../lib/evidenceStorage'
import { buildSharedMarkingSubmission, completedMarksByQuestion, createSharedMarkingSubmission, loadQuestionAssets, paperSubmissionMarkingSummary, readSharedMarkingAvailability, retrySharedMarkingSubmission, scorePaperMultipleChoice, sharedMarkingIsAvailable, waitForSharedMarkingSubmission } from '../lib/paperMarking'
import { requestMarkingCapabilities } from '../lib/markingCapabilityClient'
import { normalizePaperStudyMode, paperStudyModeLabel } from '../lib/paperStudyMode'
import { AiCoach } from './AiCoach'
import { PaperAnswerSheet, SelfMarkSummary } from './PaperAnswerSheet'

// pdf.js and its worker are only useful after a student opens a full paper.
// Keeping this boundary inside the paper desk preserves the answer-sheet and
// Pencil workflows while keeping PDF parsing out of the initial app payload.
const PdfViewer = lazy(() =>
  import('./PdfViewer').then((module) => ({ default: module.PdfViewer })),
)

function PdfViewerLoading() {
  return <div className="pdf-viewer-loading" role="status" aria-live="polite">Preparing secure paper viewer...</div>
}

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

const REVIEWED_0580_MARKING_CONTRACT = Object.freeze({
  paperId: 'cie-0580-0580_m25_qp_12',
  routeId: 'cie-0580-igcse-mathematics',
  qualification: 'IGCSE',
  specificationVersion: 'cambridge-0580-2025-2027',
  answerSlots: 26,
})
const SHARED_MARKING_BATCH_SIZE = 4
const SHARED_MARKING_CONCURRENCY = 2

function migratePaperDraftForOfficialSlots(draft, officialAnswerSlots) {
  if (!draft || typeof draft !== 'object') return draft
  const official = Number(officialAnswerSlots)
  if (!Number.isInteger(official) || official <= 0) return draft
  if (Number(draft.questionCount) === official) return draft
  // Keep every saved response and evidence field. Only the view contract is
  // expanded so an older draft cannot hide official answer slots.
  return { ...draft, questionCount: official }
}

function sharedMarkingContractForPaper(paper) {
  return paper?.id === REVIEWED_0580_MARKING_CONTRACT.paperId
    ? REVIEWED_0580_MARKING_CONTRACT
    : null
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

function highestReviewedQuestionNumber(metadataByNumber) {
  return Object.keys(metadataByNumber || {})
    .map((number) => Number(number))
    .filter((number) => Number.isInteger(number) && number > 0)
    .reduce((highest, number) => Math.max(highest, number), 0)
}

function defaultQuestionCount(profile, paperId, reviewedCount = 0) {
  if (paperId === REVIEWED_0580_MARKING_CONTRACT.paperId) return REVIEWED_0580_MARKING_CONTRACT.answerSlots
  if (profile.defaultQuestionCount) return profile.defaultQuestionCount
  if (reviewedCount > 0) return reviewedCount
  if (profile.subject === 'bpho') return profile.questionCountRange?.[0] || 1
  if (profile.mode === 'practical') return 2
  return 12
}

function questionBatches(questionNumbers, size = SHARED_MARKING_BATCH_SIZE) {
  const batches = []
  for (let index = 0; index < questionNumbers.length; index += size) batches.push(questionNumbers.slice(index, index + size))
  return batches
}

export function PaperWorkspace({ paper, catalog, draft, assignmentContext = null, sharedIdentityToken = '', stateOwnerId = '', onBack, onSaveDraft, onFinish, onFinishReview, onOpenAccount, onAttemptReady, immersive = false, onToggleImmersive = () => {} }) {
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
  const reviewedQuestionCount = useMemo(() => highestReviewedQuestionNumber(questionMetadataByNumber), [questionMetadataByNumber])
  const sharedMarkingContract = useMemo(() => sharedMarkingContractForPaper({ id: sourcePaper.id }), [sourcePaper.id])
  const officialQuestionSlots = sharedMarkingContract?.answerSlots || (profile.mode === 'mcq' ? profile.defaultQuestionCount : reviewedQuestionCount)
  const paperDraft = useMemo(() => migratePaperDraftForOfficialSlots(draft, officialQuestionSlots), [draft, officialQuestionSlots])
  const reviewedMaxMarks = useMemo(() => Object.fromEntries(Object.entries(questionMetadataByNumber).map(([number, metadata]) => [number, metadata.maxMarks])), [questionMetadataByNumber])
  const [attemptId] = useState(() => paper.attemptId || paperDraft?.attemptId || `paper-attempt-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`)
  const [elapsedSec, setElapsedSec] = useState(paperDraft?.elapsedSec || 0)
  const [timeUp, setTimeUp] = useState(Boolean(paperDraft?.timeUp))
  const [notes, setNotes] = useState(paperDraft?.notes || '')
  const [answers, setAnswers] = useState(paperDraft?.answers || {})
  const [submitted, setSubmitted] = useState(Boolean(paperDraft?.submitted))
  const [selfMarks, setSelfMarks] = useState(paperDraft?.selfMarks || {})
  const [maxMarksByQuestion, setMaxMarksByQuestion] = useState(() => ({ ...reviewedMaxMarks, ...(paperDraft?.maxMarksByQuestion || {}) }))
  const [lastSavedReview, setLastSavedReview] = useState(paperDraft?.lastSavedReview || null)
  const [aiMarks, setAiMarks] = useState(paperDraft?.aiMarks || {})
  const [aiMarkingInProgress, setAiMarkingInProgress] = useState(false)
  const [focusedQuestion, setFocusedQuestion] = useState(paperDraft?.focusedQuestion || 1)
  const [coachRequest, setCoachRequest] = useState(0)
  const [questionCount, setQuestionCount] = useState(() => paperDraft?.questionCount || defaultQuestionCount(profile, sourcePaper.id, reviewedQuestionCount))
  const [documentMode, setDocumentMode] = useState(paper.kind === 'ms' ? 'mark' : paper.kind === 'er' ? 'report' : 'question')
  const [pdfWritingEnabled, setPdfWritingEnabled] = useState(() => Boolean(paperDraft?.pdfWritingEnabled) && profile.mode !== 'mcq' && !paperDraft?.submitted)
  const [pdfInkTool, setPdfInkTool] = useState('pen')
  const [pdfInkByPage, setPdfInkByPage] = useState(paperDraft?.pdfInkByPage || {})
  // Older drafts inferred a question from whichever answer slot had focus. That
  // makes cover-page ink look like a Q1 response, so only explicit v2 links are
  // eligible for completion or marking.
  const [pdfInkQuestionMap, setPdfInkQuestionMap] = useState(() => paperDraft?.pdfInkMapVersion === 2 ? (paperDraft?.pdfInkQuestionMap || {}) : {})
  const [lastPdfInkPage, setLastPdfInkPage] = useState(null)
  const [mobilePane, setMobilePane] = useState('paper')
  const [answerPaneWidth, setAnswerPaneWidth] = useState(storedAnswerPaneWidth)
  const [saveStatus, setSaveStatus] = useState(paperDraft ? 'Restored' : 'Ready')
  const [showSubmitCheck, setShowSubmitCheck] = useState(false)
  const [evidenceStatus, setEvidenceStatus] = useState('')
  const initialAnswers = useRef(paperDraft?.answers || {})
  const objectUrls = useRef(new Set())
  const imageSaveVersion = useRef({})
  const saveVersion = useRef(0)
  const latestDraft = useRef(null)
  const paperDeskRef = useRef(null)
  const resizeState = useRef(null)
  const pdfInkFlushers = useRef(new Map())
  const pdfInkByPageRef = useRef(pdfInkByPage)
  const pdfInkQuestionMapRef = useRef(pdfInkQuestionMap)
  const lastPdfInkPageRef = useRef(null)
  const submitInProgressRef = useRef(false)
  const submitPaperRef = useRef(null)
  const timeUpRef = useRef(Boolean(paperDraft?.timeUp))
  const isAttempt = paper.kind === 'qp'
  const canReview = !isAttempt || submitted
  const pdfInkQuestionNumbers = useMemo(() => [...new Set(Object.values(pdfInkQuestionMap).flat().map(Number).filter(Number.isFinite))], [pdfInkQuestionMap])
  const responseQuestionNumbers = useMemo(() => [...new Set([
    ...Object.entries(answers).filter(([, answer]) => hasResponse(profile, answer)).map(([number]) => Number(number)),
    ...pdfInkQuestionNumbers,
  ])].filter(Number.isFinite), [answers, pdfInkQuestionNumbers, profile])
  const reviewedResponseQuestionNumbers = useMemo(() => responseQuestionNumbers.filter((number) => questionMetadataByNumber[number]?.reviewStatus === 'reviewed'), [questionMetadataByNumber, responseQuestionNumbers])
  const markingSummary = paperSubmissionMarkingSummary({ submitted, aiMarks, responseQuestionNumbers })
  const showWorkspaceMarkingSummary = markingSummary && !(submitted && reviewedResponseQuestionNumbers.length > 0)
  const answeredCount = Array.from({ length: questionCount }, (_, index) => index + 1).filter((questionNumber) => hasResponse(profile, answers[questionNumber]) || pdfInkQuestionNumbers.includes(questionNumber)).length
  const displayPaper = documentMode === 'mark' ? markScheme : documentMode === 'report' ? examinerReport : questionPaper || paper
  const title = documentMode === 'compare' ? `${questionPaper?.file} + ${markScheme?.file}` : displayPaper?.file || paper.file
  const [minimumQuestions, maximumQuestions] = sharedMarkingContract
    ? [sharedMarkingContract.answerSlots, sharedMarkingContract.answerSlots]
    : profile.questionCountRange || [1, 30]
  const questionCountFixed = minimumQuestions === maximumQuestions
  const componentLabel = profile.paperNumber ? `P${profile.paperNumber}` : profile.title || sourcePaper.subject.toUpperCase()
  const studyMode = normalizePaperStudyMode(paper.paperStudyMode || paperDraft?.paperStudyMode)
  const studyModeLabel = paperStudyModeLabel(studyMode)
  const isTimedSimulation = isAttempt && studyMode === 'exam-simulation'
  const timeLimitSec = isTimedSimulation && Number(profile.durationMinutes) > 0 ? Number(profile.durationMinutes) * 60 : 0
  const remainingSec = timeLimitSec > 0 ? Math.max(0, timeLimitSec - elapsedSec) : 0

  pdfInkByPageRef.current = pdfInkByPage
  pdfInkQuestionMapRef.current = pdfInkQuestionMap

  latestDraft.current = {
    schemaVersion: 2,
    attemptId,
    paperId: sourcePaper.id,
    pairKey: sourcePaper.pairKey,
    paperStudyMode: studyMode,
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
    assignmentContext,
    elapsedSec,
    timeUp,
    notes,
  }

  function persistLatestDraft(overrides = {}) {
    const snapshot = latestDraft.current ? { ...latestDraft.current, ...overrides } : null
    if (!snapshot) return
    onSaveDraft({ ...snapshot, answers: cleanAnswers(snapshot.answers), updatedAt: new Date().toISOString() })
  }

  const registerPdfInkFlush = useCallback((pageNumber, flush) => {
    pdfInkFlushers.current.set(Number(pageNumber), flush)
    return () => {
      if (pdfInkFlushers.current.get(Number(pageNumber)) === flush) pdfInkFlushers.current.delete(Number(pageNumber))
    }
  }, [])

  const flushPdfInk = useCallback(async () => {
    const entries = [...pdfInkFlushers.current.entries()].sort(([left], [right]) => left - right)
    const settled = await Promise.allSettled(entries.map(([, flush]) => flush()))
    const failed = settled.find((result) => result.status === 'rejected')
    if (failed) throw failed.reason
    const flushed = settled.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])
    if (!flushed.length) return { pdfInkByPage: pdfInkByPageRef.current, flushed: [] }
    const patch = Object.fromEntries(flushed.map(({ pageNumber, ink }) => [pageNumber, ink]))
    const next = { ...pdfInkByPageRef.current, ...patch }
    const latest = [...flushed].sort((left, right) => Number(left.ink?.updatedAt || 0) - Number(right.ink?.updatedAt || 0)).at(-1)
    pdfInkByPageRef.current = next
    if (latest) {
      lastPdfInkPageRef.current = Number(latest.pageNumber)
      setLastPdfInkPage(Number(latest.pageNumber))
    }
    setPdfInkByPage(next)
    return { pdfInkByPage: next, flushed }
  }, [])

  useEffect(() => {
    if (!isAttempt || submitted) return undefined
    const timer = window.setInterval(() => {
      setElapsedSec((value) => {
        const nextValue = value + 1
        if (isTimedSimulation && timeLimitSec > 0 && nextValue >= timeLimitSec) {
          if (!timeUpRef.current) {
            timeUpRef.current = true
            setTimeUp(true)
            window.setTimeout(() => submitPaperRef.current?.({ timeUp: true }), 0)
          }
          return timeLimitSec
        }
        return nextValue
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isAttempt, isTimedSimulation, submitted, timeLimitSec])

  useEffect(() => {
    onAttemptReady?.(attemptId)
    persistLatestDraft()
    // This is the one-time bootstrap write for refresh-safe paper deep links.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, onAttemptReady])

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
  }, [aiMarks, answers, attemptId, focusedQuestion, markScheme?.id, maxMarksByQuestion, notes, onSaveDraft, paper.retestOf, pdfInkByPage, pdfInkQuestionMap, profile, questionCount, selfMarks, sourcePaper, submitted, studyMode])

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

  const updatePdfInk = useCallback((pageNumber, ink) => {
    const next = { ...pdfInkByPageRef.current, [pageNumber]: ink }
    pdfInkByPageRef.current = next
    lastPdfInkPageRef.current = Number(pageNumber)
    setPdfInkByPage(next)
    setLastPdfInkPage(Number(pageNumber))
  }, [])

  async function linkPdfInkToQuestion(questionNumber) {
    let flushed
    try {
      flushed = await flushPdfInk()
    } catch {
      setEvidenceStatus('The latest PDF handwriting could not be saved. Try linking it again.')
      return
    }
    const latestFlushed = [...flushed.flushed].sort((left, right) => Number(left.ink?.updatedAt || 0) - Number(right.ink?.updatedAt || 0)).at(-1)
    const pageNumber = Number(latestFlushed?.pageNumber || lastPdfInkPageRef.current || lastPdfInkPage)
    if (!Number.isFinite(pageNumber) || !flushed.pdfInkByPage[pageNumber]) {
      setEvidenceStatus('Write on a PDF page first, then link that page to this answer slot.')
      return
    }
    const nextMap = {
      ...pdfInkQuestionMapRef.current,
      [pageNumber]: [...new Set([...(pdfInkQuestionMapRef.current[pageNumber] || []), Number(questionNumber)])],
    }
    pdfInkQuestionMapRef.current = nextMap
    setPdfInkQuestionMap(nextMap)
    setEvidenceStatus(`PDF page ${pageNumber} linked to question ${questionNumber}.`)
  }

  function clearPdfInk() {
    pdfInkByPageRef.current = {}
    pdfInkQuestionMapRef.current = {}
    lastPdfInkPageRef.current = null
    setPdfInkByPage({})
    setPdfInkQuestionMap({})
    setLastPdfInkPage(null)
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

  async function responseForSharedMarking(questionNumber, { inkByPage = pdfInkByPageRef.current, inkQuestionMap = pdfInkQuestionMapRef.current } = {}) {
    const answer = answers[questionNumber] || {}
    const questionMetadata = questionMetadataByNumber[questionNumber]
    const inkPage = Object.entries(inkQuestionMap).find(([, questions]) => questions.map(Number).includes(Number(questionNumber)))?.[0]
    const pdfInk = inkPage ? inkByPage[inkPage] : null
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
      questionAssetsByPart: Object.fromEntries(await Promise.all((questionMetadata?.parts || []).map(async (part) => [
        part.id,
        await loadQuestionAssets({
          sourceRef: questionMetadata?.sourceRef,
          part,
        }),
      ]))),
    }
  }

  async function markAllResponses({ questionNumbers = responseQuestionNumbers, inkByPage = pdfInkByPageRef.current, inkQuestionMap = pdfInkQuestionMapRef.current, submittedAttempt = submitted } = {}) {
    if (aiMarkingInProgress) return
    if (!submittedAttempt) return
    if (!questionNumbers.length) return
    const eligibleQuestionNumbers = questionNumbers.filter((number) => questionMetadataByNumber[number]?.reviewStatus === 'reviewed')
    const unreviewedQuestionNumbers = questionNumbers.filter((number) => !questionMetadataByNumber[number]?.reviewStatus || questionMetadataByNumber[number]?.reviewStatus !== 'reviewed')
    if (unreviewedQuestionNumbers.length) {
      setAiMarks((current) => ({ ...current, ...Object.fromEntries(unreviewedQuestionNumbers.map((number) => [number, { status: 'missing_metadata', code: 'question_metadata_missing' }])) }))
    }
    if (!eligibleQuestionNumbers.length || !sharedMarkingContract) return
    setAiMarkingInProgress(true)
    try {
      if (!sharedIdentityToken) {
        setAiMarks((current) => ({ ...current, ...Object.fromEntries(eligibleQuestionNumbers.map((number) => [number, { status: 'failed', failureCode: 'identity_required', loginRequired: true }])) }))
        return
      }
      const availability = await readSharedMarkingAvailability({ token: sharedIdentityToken })
      if (availability.authenticationRequired) {
        setAiMarks((current) => ({ ...current, ...Object.fromEntries(eligibleQuestionNumbers.map((number) => [number, { status: 'failed', failureCode: 'identity_required', loginRequired: true }])) }))
        return
      }
      if (!sharedMarkingIsAvailable(availability)) {
        setAiMarks((current) => ({ ...current, ...Object.fromEntries(eligibleQuestionNumbers.map((number) => [number, { status: 'failed', failureCode: 'service_unavailable', retryable: true }])) }))
        return
      }

      const capabilityPayload = await requestMarkingCapabilities({
        token: sharedIdentityToken,
        attemptId,
        mode: 'full-paper',
        submitted: true,
        paperId: sharedMarkingContract.paperId,
        parts: eligibleQuestionNumbers.flatMap((number) => (
          (questionMetadataByNumber[number]?.parts || []).map((part) => ({
            provenance: {
              routeId: sharedMarkingContract.routeId,
              ...(part.markingProvenance || {}),
            },
          }))
        )),
      })
      const markingCapabilities = Object.fromEntries((capabilityPayload.capabilities || []).map((item) => [item.questionPartId, item.markingGrant]))
      const batches = questionBatches(eligibleQuestionNumbers)
      let cursor = 0
      async function markBatch(questionNumbersForBatch, batchIndex) {
        try {
          const responses = await Promise.all(questionNumbersForBatch.map((number) => responseForSharedMarking(number, { inkByPage, inkQuestionMap })))
          const contract = buildSharedMarkingSubmission({
            attemptId,
            routeId: sharedMarkingContract.routeId,
            qualification: sharedMarkingContract.qualification,
            specificationVersion: sharedMarkingContract.specificationVersion,
            paperId: sharedMarkingContract.paperId,
            organizationId: assignmentContext?.organizationId,
            classroomId: assignmentContext?.classroomId,
            assignmentId: assignmentContext?.assignmentId,
            submissionSuffix: `batch-${batchIndex + 1}-${questionNumbersForBatch.join('-')}`,
            markingCapabilities,
            responses,
          })
          if (contract.missingQuestionNumbers.length) {
            setAiMarks((current) => ({ ...current, ...Object.fromEntries(contract.missingQuestionNumbers.map((number) => [number, { status: 'missing_metadata', code: 'question_metadata_missing' }])) }))
          }
          const queuedQuestionNumbers = [...new Set(Object.values(contract.questionNumberByPartId))]
          if (!contract.ok) return
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
          setAiMarks((current) => ({ ...current, ...Object.fromEntries(questionNumbersForBatch.map((number) => [number, { status: 'failed', failureCode: error.code || 'service_unavailable', retryable: Boolean(error.retryable), loginRequired: Boolean(error.loginRequired) }])) }))
        }
      }
      async function worker() {
        while (cursor < batches.length) {
          const batchIndex = cursor
          cursor += 1
          await markBatch(batches[batchIndex], batchIndex)
        }
      }
      await Promise.all(Array.from({ length: Math.min(SHARED_MARKING_CONCURRENCY, batches.length) }, worker))
    } catch (error) {
      setAiMarks((current) => ({ ...current, ...Object.fromEntries(eligibleQuestionNumbers.map((number) => [number, { status: 'failed', failureCode: error.code || 'service_unavailable', retryable: Boolean(error.retryable), loginRequired: Boolean(error.loginRequired) }])) }))
    } finally {
      setAiMarkingInProgress(false)
    }
  }

  async function retryMarking(questionNumber) {
    const current = aiMarks[questionNumber]
    if (current?.status !== 'failed' || !current.submissionId || !sharedIdentityToken) return
    const submissionId = current.submissionId
    const affectedQuestionNumbers = Object.entries(aiMarks).filter(([, result]) => result?.submissionId === submissionId).map(([number]) => Number(number))
    setAiMarks((value) => ({ ...value, ...Object.fromEntries(affectedQuestionNumbers.map((number) => [number, { ...value[number], status: 'queued', retryable: false }])) }))
    try {
      let submission = await retrySharedMarkingSubmission({ token: sharedIdentityToken, submissionId })
      if (submission.status === 'queued' || submission.status === 'processing') {
        setAiMarks((value) => ({ ...value, ...Object.fromEntries(affectedQuestionNumbers.map((number) => [number, { ...value[number], status: submission.status, submissionId }])) }))
        submission = await waitForSharedMarkingSubmission({
          token: sharedIdentityToken,
          submissionId,
          onStatus: (next) => {
            if (next.status === 'queued' || next.status === 'processing') setAiMarks((value) => ({ ...value, ...Object.fromEntries(affectedQuestionNumbers.map((number) => [number, { ...value[number], status: next.status, submissionId }])) }))
          },
        })
      }
      if (submission.status === 'completed') {
        const partIds = Object.fromEntries(affectedQuestionNumbers.flatMap((number) => (
          (questionMetadataByNumber[number]?.parts || []).map((part) => [part.id, number])
        )))
        const results = completedMarksByQuestion(submission, partIds)
        if (Object.keys(results).length) {
          setAiMarks((value) => ({ ...value, ...results }))
          setSelfMarks((value) => ({ ...value, ...Object.fromEntries(Object.entries(results).map(([number, result]) => [number, result.rawMarks])) }))
          setMaxMarksByQuestion((value) => ({ ...value, ...Object.fromEntries(Object.entries(results).map(([number, result]) => [number, result.maxMarks])) }))
          return
        }
      }
      const terminal = submission.status === 'missing_metadata'
        ? { status: 'missing_metadata', metadataIssues: submission.metadataIssues || [] }
        : { status: 'failed', submissionId, failureCode: submission.failureCode || 'provider_unavailable', retryable: Boolean(submission.retryable) }
      setAiMarks((value) => ({ ...value, ...Object.fromEntries(affectedQuestionNumbers.map((number) => [number, terminal])) }))
    } catch (error) {
      setAiMarks((value) => ({ ...value, ...Object.fromEntries(affectedQuestionNumbers.map((number) => [number, { status: 'failed', submissionId, failureCode: error.code || 'service_unavailable', retryable: Boolean(error.retryable), loginRequired: Boolean(error.loginRequired) }])) }))
    }
  }

  async function submitPaper({ timeUp: submittedByTimer = false } = {}) {
    if (submitted || submitInProgressRef.current) return
    submitInProgressRef.current = true
    if (submittedByTimer) {
      timeUpRef.current = true
      setTimeUp(true)
      setEvidenceStatus('Time is up. Submitting the saved answer sheet.')
    }
    let flushed
    try {
      flushed = await flushPdfInk()
    } catch {
      submitInProgressRef.current = false
      setEvidenceStatus('The latest PDF handwriting could not be saved. Submit again after it finishes saving.')
      return
    }
    const submittedAt = new Date().toISOString()
    const snapshot = cleanAnswers(answers)
    const inkQuestionMap = pdfInkQuestionMapRef.current
    const submittedQuestionNumbers = [...new Set([
      ...Object.entries(snapshot).filter(([, answer]) => hasResponse(profile, answer)).map(([number]) => Number(number)),
      ...Object.values(inkQuestionMap).flat().map(Number),
    ])].filter(Number.isFinite)
    const submittedAnsweredCount = Array.from({ length: questionCount }, (_, index) => index + 1)
      .filter((questionNumber) => hasResponse(profile, snapshot[questionNumber]) || submittedQuestionNumbers.includes(questionNumber)).length
    setSubmitted(true)
    setShowSubmitCheck(false)
    if (markScheme) {
      setDocumentMode('compare')
      // On touch layouts the actionable result is the answer pane: keep the
      // self-mark summary visible immediately after submission. Desktop keeps
      // both panes visible, so this does not change its split workspace.
      setMobilePane('answer')
    }
    onFinish({
      attemptId,
      paperId: sourcePaper.id,
      pairKey: sourcePaper.pairKey,
      paperStudyMode: studyMode,
      subject: sourcePaper.subject,
      file: sourcePaper.file,
      profile,
      questionCount,
      answeredCount: submittedAnsweredCount,
      answers: snapshot,
      pdfInkByPage: flushed.pdfInkByPage,
      pdfInkQuestionMap: inkQuestionMap,
      elapsedSec,
      notes,
      retestOf: paper.retestOf || null,
      assignmentContext,
      submittedAt,
      timeUp: submittedByTimer || timeUp,
    })
    const nextSelfMarks = { ...selfMarks }
    const nextMaxMarksByQuestion = { ...maxMarksByQuestion }
    if (profile.mode === 'mcq') {
      for (const questionNumber of submittedQuestionNumbers) {
        const metadata = questionMetadataByNumber[questionNumber]
        const part = metadata?.parts?.find((item) => item.answerKey)
        const score = part
          ? scorePaperMultipleChoice({
            answer: snapshot[questionNumber],
            answerKey: part.answerKey,
            marks: part.marks,
          })
          : null
        if (score == null) continue
        nextSelfMarks[questionNumber] = score.awarded
        nextMaxMarksByQuestion[questionNumber] = score.maxMarks
      }
      setSelfMarks(nextSelfMarks)
      setMaxMarksByQuestion(nextMaxMarksByQuestion)
    }
    if (profile.mode !== 'mcq') {
      setAiMarks((current) => ({ ...current, ...Object.fromEntries(submittedQuestionNumbers.map((questionNumber) => [questionNumber, questionMetadataByNumber[questionNumber]?.reviewStatus === 'reviewed' ? { status: 'checking_availability' } : { status: 'missing_metadata', code: 'question_metadata_missing' }])) }))
    }
    if (profile.mode === 'mcq' && Object.keys(nextSelfMarks).some((number) => submittedQuestionNumbers.includes(Number(number)))) {
      finishReview({
        selfMarks: nextSelfMarks,
        maxMarksByQuestion: nextMaxMarksByQuestion,
        responseQuestionNumbers: submittedQuestionNumbers,
      })
    }
    if (profile.mode !== 'mcq') {
      void markAllResponses({ questionNumbers: submittedQuestionNumbers, inkByPage: flushed.pdfInkByPage, inkQuestionMap, submittedAttempt: true })
    }
  }

  submitPaperRef.current = submitPaper

  function finishReview(overrides = {}) {
    const marksByQuestion = overrides.selfMarks || selfMarks
    const maxMarksByQuestionForReview = overrides.maxMarksByQuestion || maxMarksByQuestion
    const responseNumbers = overrides.responseQuestionNumbers || responseQuestionNumbers
    const completedQuestionNumbers = responseNumbers.filter((questionNumber) => {
      const awarded = marksByQuestion[questionNumber]
      const available = maxMarksByQuestionForReview[questionNumber]
      const awardedNumber = Number(awarded)
      const availableNumber = Number(available)
      return awarded !== '' && awarded != null && available !== '' && available != null
        && Number.isFinite(awardedNumber) && Number.isFinite(availableNumber)
        && awardedNumber >= 0 && availableNumber >= 0 && awardedNumber <= availableNumber
    })
    const marks = completedQuestionNumbers.map((questionNumber) => Number(marksByQuestion[questionNumber]))
    const available = completedQuestionNumbers.map((questionNumber) => Number(maxMarksByQuestionForReview[questionNumber]))
    const unansweredQuestionNumbers = Array.from({ length: questionCount }, (_, index) => index + 1)
      .filter((questionNumber) => !responseNumbers.includes(questionNumber))
    const review = {
      attemptId,
      paperId: sourcePaper.id,
      paperStudyMode: studyMode,
      selfMarks: marksByQuestion,
      maxMarksByQuestion: maxMarksByQuestionForReview,
      aiMarks,
      rawMarks: marks.reduce((sum, value) => sum + value, 0),
      maxMarks: profile.mode === 'mcq' ? questionCount : available.reduce((sum, value) => sum + value, 0),
      scoredQuestionNumbers: completedQuestionNumbers,
      unansweredQuestionNumbers,
      partial: completedQuestionNumbers.length < questionCount,
      reviewedAt: new Date().toISOString(),
      officialResult: false,
    }
    const signature = JSON.stringify({
      scoredQuestionNumbers: completedQuestionNumbers,
      selfMarks: Object.fromEntries(completedQuestionNumbers.map((questionNumber) => [questionNumber, marksByQuestion[questionNumber]])),
      maxMarksByQuestion: Object.fromEntries(completedQuestionNumbers.map((questionNumber) => [questionNumber, maxMarksByQuestionForReview[questionNumber]])),
      unansweredQuestionNumbers,
    })
    if (lastSavedReview?.signature === signature) return
    setLastSavedReview({ savedAt: review.reviewedAt, rawMarks: review.rawMarks, maxMarks: review.maxMarks, signature })
    onFinishReview(review)
  }

  return (
    <section className={`paper-workspace ${immersive ? 'paper-workspace--immersive' : ''}`}>
      <header className="paper-workspace-header">
        <button type="button" className="icon-button" onClick={async () => { try { const flushed = await flushPdfInk(); persistLatestDraft({ pdfInkByPage: flushed.pdfInkByPage, pdfInkQuestionMap: pdfInkQuestionMapRef.current }) } catch { persistLatestDraft() } onBack() }} aria-label="Back to paper library"><ArrowLeft size={19} /></button>
        <div className="workspace-title"><strong>{title}</strong><small>{studyModeLabel} · {profile.title} · {paper.season} {paper.year} · verified local PDF</small></div>
        <div className="paper-workspace-actions">
          <span className={`timer ${isTimedSimulation && remainingSec <= 60 ? 'timer--urgent' : ''}`} role="timer"><Clock3 size={16} />{isTimedSimulation ? `Remaining ${formatTime(remainingSec)}` : formatTime(elapsedSec)}</span>
          {timeUp && <span className="paper-time-status" role="status">Time is up · submitted</span>}
          <span className="save-state" aria-live="polite"><Save size={16} /><span>{saveStatus}</span></span>
          <a className="icon-button" href={(displayPaper || paper).localUrl} target="_blank" rel="noreferrer" aria-label="Open PDF in a new tab"><ExternalLink size={18} /></a>
          <button type="button" className="paper-focus-button" onClick={() => onToggleImmersive(!immersive)} aria-label={immersive ? 'Exit paper focus mode' : 'Enter paper focus mode'} aria-pressed={immersive} title={immersive ? 'Exit paper focus mode' : 'Enter paper focus mode'}>{immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
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
        <span>{studyModeLabel} · {componentLabel} · {profile.durationMinutes ? `${profile.durationMinutes} min` : 'paper timing'} · {profile.maxMarks ? `${profile.maxMarks} marks` : 'source marks'}</span>
      </div>

      <div className="paper-pane-switch" role="tablist" aria-label="Mobile paper workspace">
        <button type="button" role="tab" aria-selected={mobilePane === 'paper'} aria-controls="paper-document-pane" className={mobilePane === 'paper' ? 'active' : ''} onClick={() => setMobilePane('paper')}><FileText size={17} />Paper</button>
        <button type="button" role="tab" aria-selected={mobilePane === 'answer'} aria-controls="paper-answer-pane" className={mobilePane === 'answer' ? 'active' : ''} disabled={!isAttempt} onClick={() => setMobilePane('answer')}><NotebookPen size={17} />Answer sheet <span>{answeredCount}/{questionCount}</span></button>
      </div>

      {questionPaper && !markScheme && <div className="missing-mark-scheme"><AlertTriangle size={18} /><div><strong>No exact mark scheme is present for {questionPaper.file}</strong><span>Another paper's mark scheme will not be substituted.</span></div></div>}
      {paper.agentNotice && <div className="session-complete"><CheckCircle2 size={18} />{paper.agentNotice}</div>}
      {showWorkspaceMarkingSummary && <div className={`session-complete session-complete--${markingSummary.tone}`}><CheckCircle2 size={18} />{markingSummary.text}</div>}
      <div ref={paperDeskRef} className={`paper-desk ${documentMode === 'compare' ? 'compare-mode' : ''} ${!isAttempt ? 'reference-mode' : ''}`} style={{ '--answer-pane-width': `${answerPaneWidth}px` }}>
        <div id="paper-document-pane" role="tabpanel" className={`pdf-stage ${documentMode === 'compare' ? 'pdf-stage-compare' : ''} ${mobilePane !== 'paper' ? 'mobile-pane-hidden' : ''}`}>
          <Suspense fallback={<PdfViewerLoading />}>
            {documentMode === 'compare'
              ? <div className="pdf-compare"><section><header>Question paper</header><PdfViewer file={questionPaper} annotate={isAttempt && Object.keys(pdfInkByPage).length > 0} readOnly inkByPage={pdfInkByPage} /></section><section><header>Mark scheme</header><PdfViewer file={markScheme} /></section></div>
              : <PdfViewer file={displayPaper || paper} annotate={isAttempt && documentMode === 'question' && pdfWritingEnabled} inkByPage={pdfInkByPage} inkTool={pdfInkTool} questionNumber={focusedQuestion} onInkChange={updatePdfInk} registerInkFlush={registerPdfInkFlush} />}
          </Suspense>
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
            mode={profile.mode}
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
            paperStudyMode={studyMode}
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
            reviewedResponseQuestionNumbers={reviewedResponseQuestionNumbers}
            sharedMarkingContract={sharedMarkingContract}
            sharedIdentityConnected={Boolean(sharedIdentityToken)}
            onOpenAccount={onOpenAccount}
            aiMarkingInProgress={aiMarkingInProgress}
            onRequestAiMarking={markAllResponses}
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
        stateOwnerId={stateOwnerId}
        openRequest={coachRequest}
        showTrigger={false}
        context={{
          attemptId,
          stateOwnerId,
          view: 'full-paper',
          routeId: paper.routeId || '',
          subject: { code: sourcePaper.subject, title: profile.title },
          stage: paper.stage || profile.stages?.join(' / ') || 'Cambridge paper',
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
