import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Brain,
  CheckCircle2,
  ChevronRight,
  Dumbbell,
  FileText,
  Flag,
  GraduationCap,
  Heart,
  BookOpen,
  ListFilter,
  LogIn,
  LogOut,
  Play,
  RefreshCcw,
  Search,
  Sparkles,
  Target,
  TimerReset,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react'
import { fullPaperUnits, importedPdfLibrary, subjects, topicUnits } from './data/catalog'
import { learningPlan, stagesForComponentTags } from './data/learningPlan'
import { courseRoutes, formatRouteComponents, routeById, routesForSubject } from './data/routeRegistry'
import { COURSE_STAGE_ORDER } from './data/stages'
import { AiCoach } from './components/AiCoach'
import { PaperLibrary } from './components/PaperLibrary'
import { PracticeWorkspace } from './components/PracticeWorkspace'
import { usePaperCatalog } from './hooks/usePaperCatalog'
import { loadState, makeAttemptId, normalizeState, saveState } from './lib/storage'
import { hasAttemptResponse, hasCurrentSourceBindingForAttempt, isPendingSelfMarkAttempt, isScoredAttempt, prepareLearningExport, sourceBindingSnapshotForUnit } from './lib/attemptAudit'
import { mergeNotebookNote, notebookNoteRequest } from './lib/privateNotes'
import { stripSourceVisualPlaceholders } from './lib/questionContent'
import {
  buildPartMarkingLifecycle,
  canUseAiAssistedMarking,
  finalizePartMarking,
  hasCompleteStudentMarks,
  markingCapabilityForUnit,
  pendingPartsForLifecycle,
} from './lib/markingLifecycle'
import { buildCoachPractice, buildVerifiedPracticeCatalog, coachPracticeOptions, MIN_VERIFIED_GROUPS_FOR_PRACTICE, previewCoachPracticeSourceMix, rebindVerifiedPracticeUnit, resolveVerifiedPracticeSelection, topicQueryForRoute } from './lib/verifiedPracticeCatalog'
import { latestBphoSpcPaper } from './lib/coachIntent'
import { buildCompletionByUnit, buildLearningProgress, recommendForRoute } from './lib/learningProgress'
import { professionalTermsUrl, requestSharedAccount, requestSharedWorkspace, sharedAccountRequest, sharedAuthUrl, sharedLogoutUrl } from './lib/sharedAccount'
import { requestMarkingCapabilities } from './lib/markingCapabilityClient'
import { parseProductContext, termIdsForStemContext } from './lib/productContext'
import { vocabularyCoverageForRoute } from './data/stemVocabularyTaxonomy'
import { verifiedPracticeQuestionGroups } from './lib/verifiedPracticeCatalog'
import './App.css'
import './StudentV2.css'
import './TabletNavFix.css'

const PaperWorkspace = lazy(() =>
  import('./components/PaperWorkspace').then((module) => ({ default: module.PaperWorkspace })),
)
const HistoryView = lazy(() =>
  import('./components/HistoryView').then((module) => ({ default: module.HistoryView })),
)
const RoleWorkspace = lazy(() =>
  import('./components/RoleWorkspace').then((module) => ({ default: module.RoleWorkspace })),
)

const EMPTY_SELF_MARKS = Object.freeze({})

function formatTime(totalSec) {
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function routePickerLabel(route) {
  const siblings = courseRoutes.filter((item) => item.qualification === route.qualification && item.subjectId === route.subjectId && item.stage === route.stage)
  const componentLabel = siblings.length > 1 ? ` · ${formatRouteComponents(route.paperComponents)}` : ''
  const stageLabel = route.stage === 'Competition' || route.stage === 'Admissions' ? '' : `${route.stage} `
  return `${stageLabel}${route.subject} (${route.subjectCode.toUpperCase()})${componentLabel}`
}

function displayPartLabel(part, fallback = 'Question') {
  if (part?.displayLabel) return part.displayLabel
  const file = String(part?.sourceRef?.paper || '').replace(/\.[^.]+$/, '')
  const match = file.match(/(?:^|[_-])([msw])(\d{2})[_-]qp[_-]?(\d{1,2})(?:$|[_-])/i)
  const label = part?.label || fallback
  return match ? `${match[1].toUpperCase()}${match[2]}/${match[3]} · ${label}` : label
}

function focusedRetestUnit(unit, partId) {
  if (!partId || unit.parts.length === 1) return unit
  const part = unit.parts.find((item) => item.id === partId)
  if (!part) return unit
  const ratio = 1 / Math.max(1, unit.parts.length)
  return {
    ...unit,
    id: `${unit.id}:focused:${part.id}`,
    title: `${unit.title} · ${displayPartLabel(part)}`,
    parts: [part],
    maxMarks: part.marks,
    estimatedMinutes: Math.max(5, Math.ceil((unit.estimatedMinutes || 10) * ratio)),
    durationSec: Math.max(300, Math.ceil((unit.durationSec || 600) * ratio)),
    focusedRetestOf: unit.id,
  }
}

function getUnitAttempts(attempts, unit) {
  const unitId = typeof unit === 'string' ? unit : unit?.id
  return attempts.filter((attempt) => attempt.unitId === unitId && isScoredAttempt(attempt, typeof unit === 'string' ? null : unit))
}

function bestResultFor(attempts, unit) {
  return getUnitAttempts(attempts, unit)
    .map((attempt) => attempt.scoreResult)
    .sort((a, b) => b.percentage - a.percentage)[0]
}

async function requestVisionReviews(unit, attempt, identityToken = '') {
  const eligibleParts = (unit.parts || []).filter(canUseAiAssistedMarking)
  const reviews = Object.fromEntries(eligibleParts.map((part) => [part.id, {
    status: attempt.evidence?.[part.id]?.dataUrl ? 'queued' : 'no_evidence',
  }]))
  const eligibleEntries = eligibleParts
    .map((part) => [part.id, attempt.evidence?.[part.id]])
    .filter(([, evidence]) => Boolean(evidence?.dataUrl))
  if (!eligibleEntries.length) return reviews
  let capabilityByPartId
  try {
    const capabilityPayload = await requestMarkingCapabilities({
      token: identityToken,
      attemptId: attempt.id,
      mode: 'topic',
      submitted: true,
      parts: eligibleEntries.map(([partId]) => {
        const part = eligibleParts.find((candidate) => candidate.id === partId)
        return { provenance: { routeId: unit.routeId, ...(part?.markingProvenance || {}) } }
      }),
    })
    capabilityByPartId = Object.fromEntries((capabilityPayload.capabilities || []).map((item) => [item.questionPartId, item.markingGrant]))
  } catch (error) {
    return {
      ...reviews,
      ...Object.fromEntries(eligibleEntries.map(([partId]) => [partId, {
        status: 'error',
        error: error.message || 'This submitted attempt could not be verified for AI marking.',
        loginRequired: Boolean(error.loginRequired),
      }])),
    }
  }
  try {
    const statusResponse = await fetch('/api/ai/status')
    const status = await statusResponse.json()
    if (!status.visionEnabled) return { ...reviews, ...Object.fromEntries(eligibleEntries.map(([partId]) => [partId, { status: 'unconfigured' }])) }
  } catch {
    return { ...reviews, ...Object.fromEntries(eligibleEntries.map(([partId]) => [partId, { status: 'error', error: 'AI service status could not be checked.' }])) }
  }

  const results = await Promise.all(eligibleEntries.map(async ([partId, evidence]) => {
    const part = unit.parts.find((item) => item.id === partId)
    if (!part) return [partId, { status: 'error', error: 'Question context is unavailable.' }]
    try {
      const response = await fetch('/api/ai/mark-handwriting', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${identityToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attemptId: attempt.id,
          mode: 'topic',
          submitted: true,
          markingGrant: capabilityByPartId?.[part.markingProvenance?.questionPartId] || '',
          imageDataUrl: evidence.dataUrl,
          typedResponse: attempt.answers[partId] || attempt.working?.[partId] || '',
          provenance: {
            routeId: unit.routeId,
            ...(part.markingProvenance || {}),
          },
          paperId: part.sourceRef?.paperId || '',
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) return [partId, { status: payload.code === 'vision_not_configured' ? 'unconfigured' : 'error', error: payload.error || 'AI review could not be completed.' }]
      if (payload.mode !== 'vision') return [partId, { status: 'error', error: payload.error || 'AI review could not be completed.' }]
      return [partId, { ...payload, status: 'success' }]
    } catch {
      return [partId, { status: 'error', error: 'AI review could not be reached. Your response remains saved.' }]
    }
  }))
  return { ...reviews, ...Object.fromEntries(results) }
}

function migratePracticeAnswers(unit, draft) {
  if (!draft) return {}
  return Object.fromEntries(unit.parts.map((part) => {
    const answer = String(draft.answers?.[part.id] || '').trim()
    const working = String(draft.working?.[part.id] || '').trim()
    if (part.answerType === 'multiple-choice') {
      const keyedAnswer = answer.match(/^([A-D])(?:\b|[.)\s:-])/i)?.[1]?.toUpperCase()
      const optionIndex = part.options?.findIndex((option) => option === answer) ?? -1
      return [part.id, keyedAnswer || (optionIndex >= 0 ? String.fromCharCode(65 + optionIndex) : answer)]
    }
    if (!working || answer.includes(working)) return [part.id, answer]
    return [part.id, [working, answer].filter(Boolean).join('\n\n')]
  }).filter(([, value]) => value))
}

function getIncomingProductContext() {
  if (typeof window === 'undefined') return { from: '', focus: '', subjectId: 'all' }
  const context = parseProductContext(window.location.search)
  const focus = context.focus
  const route = routeById(context.routeId)
  const subjectId = {
    physics: 'physics',
    biology: 'biology',
    mathematics: 'math',
    chemistry: 'chemistry',
    economics: 'economics',
  }[focus] || route?.subjectId || 'all'
  return { ...context, subjectId }
}

function App() {
  const [appState, setAppState] = useState(() => loadState())
  const paperCatalogState = usePaperCatalog()
  const incomingContext = getIncomingProductContext()
  const incomingTopicQuery = topicQueryForRoute(incomingContext.routeId, incomingContext.topicId)
  const [view, setView] = useState(() => incomingContext.from === 'ieltsist' || incomingContext.focus ? 'library' : 'dashboard')
  const [activeTab, setActiveTab] = useState('recommended')
  const [selectedTopicId, setSelectedTopicId] = useState(() => incomingContext.topicId || null)
  const [activeRouteId, setActiveRouteId] = useState(() => {
    if (routeById(incomingContext.routeId)) return incomingContext.routeId
    if (routeById(appState.profile?.activeRouteId)) return appState.profile.activeRouteId
    return routesForSubject(incomingContext.subjectId).find((route) => route.stage === 'AS')?.routeId
      || routesForSubject(incomingContext.subjectId)[0]?.routeId
      || 'cie-9702-as-physics'
  })
  const activeRoute = routeById(activeRouteId) || courseRoutes[0]
  const activeSubject = subjects.find((subject) => subject.routeIds?.includes(activeRoute.routeId)) || subjects[0]
  const [_subjectFilter, setSubjectFilter] = useState(() => activeSubject.id)
  const [completionFilter] = useState('all')
  const [query, setQuery] = useState(() => incomingTopicQuery)
  const [currentAttempt, setCurrentAttempt] = useState(null)
  const [resultAttempt, setResultAttempt] = useState(null)
  const [activePaper, setActivePaper] = useState(null)
  const [pendingSession, setPendingSession] = useState(null)
  const [coachOpenRequest, setCoachOpenRequest] = useState(0)
  const [sharedAccount, setSharedAccount] = useState({ status: 'loading', token: '', workspace: null, error: '' })
  const [stateOwnerId, setStateOwnerId] = useState('')
  const [exportState, setExportState] = useState({ status: 'idle', error: '', exportedAt: '', checksum: '' })
  const migrationAttemptedRef = useRef(false)
  const notebookSyncTimerRef = useRef(null)
  const stateOwnerIdRef = useRef('')
  const incomingTopicManuallyChangedRef = useRef(false)
  const verifiedCatalogUnits = useMemo(() => buildVerifiedPracticeCatalog(), [])
  const visibleVerifiedUnits = useMemo(() => {
    const persisted = (appState.generatedUnits || [])
      .filter((unit) => unit.agentGenerated || unit.focusedRetestOf)
      .map((unit) => rebindVerifiedPracticeUnit(unit))
      .filter(Boolean)
    const labelled = [...persisted, ...verifiedCatalogUnits.filter((catalogUnit) => !persisted.some((unit) => unit.id === catalogUnit.id))]
    return labelled.map((unit) => {
      const route = routeById(unit.routeId)
      return route && !String(unit.title || '').startsWith(`${route.stage} `)
        ? { ...unit, title: `${route.stage} ${route.subject} · ${unit.topic || unit.title}` }
        : unit
    })
  }, [appState.generatedUnits, verifiedCatalogUnits])
  const allPracticeUnits = visibleVerifiedUnits
  const migrationUnits = useMemo(() => [...new Map([...allPracticeUnits, ...topicUnits, ...fullPaperUnits].map((unit) => [unit.id, unit])).values()], [allPracticeUnits])
  const routePracticeUnits = useMemo(() => allPracticeUnits.filter((unit) => unit.routeId === activeRouteId), [activeRouteId, allPracticeUnits])
  const routeAttempts = useMemo(() => appState.attempts.filter((attempt) => attempt.routeId === activeRouteId), [activeRouteId, appState.attempts])
  const routePaperSessions = useMemo(() => appState.paperSessions.filter((session) => session.routeId === activeRouteId), [activeRouteId, appState.paperSessions])
  const routePaperReviews = useMemo(() => {
    const attemptIds = new Set(routePaperSessions.map((session) => session.attemptId))
    return (appState.paperReviews || []).filter((review) => review.routeId === activeRouteId || attemptIds.has(review.attemptId))
  }, [activeRouteId, appState.paperReviews, routePaperSessions])
  const aiPracticeOptions = useMemo(() => coachPracticeOptions(), [])
  const learningProgress = useMemo(() => buildLearningProgress({
    attempts: appState.attempts,
    drafts: appState.drafts,
    units: allPracticeUnits,
    routes: courseRoutes,
    routeId: activeRouteId,
    weeklyTarget: appState.profile.weeklyQuestions,
  }), [activeRouteId, allPracticeUnits, appState.attempts, appState.drafts, appState.profile.weeklyQuestions])
  const syllabusRoadmap = useMemo(() => {
    const topicStats = new Map(learningProgress.topicProgress.map((item) => [item.id, item]))
    const routeOption = aiPracticeOptions.find((option) => option.routeId === activeRouteId)
    return (routeOption?.topics || []).map((topic, index) => ({
      id: topic.id,
      routeId: activeRouteId,
      subjectId: activeRoute.subjectId,
      name: topic.label,
      officialTopicNumber: index + 1,
      inventory: topic.inventory,
      ...(topicStats.get(topic.id) || { mastery: null, attempts: 0, questions: 0, status: 'Not started' }),
    }))
  }, [activeRoute.subjectId, activeRouteId, aiPracticeOptions, learningProgress.topicProgress])

  useEffect(() => {
    if (sharedAccount.status === 'loading') return
    const nextOwnerId = sharedAccount.status === 'ready' ? String(sharedAccount.identity?.id || '') : ''
    if (nextOwnerId === stateOwnerId) return
    if (notebookSyncTimerRef.current) window.clearTimeout(notebookSyncTimerRef.current)
    const nextState = loadState({ userId: nextOwnerId })
    // A cross-product URL is an explicit navigation request and must not be
    // overwritten by the user's most recently saved STEM route.
    const nextRouteId = routeById(incomingContext.routeId)?.routeId
      || routeById(nextState.profile?.activeRouteId)?.routeId
      || 'cie-9702-as-physics'
    stateOwnerIdRef.current = nextOwnerId
    migrationAttemptedRef.current = false
    setStateOwnerId(nextOwnerId)
    setAppState(nextState)
    setActiveRouteId(nextRouteId)
    setCurrentAttempt(null)
    setResultAttempt(null)
    setActivePaper(null)
    setPendingSession(null)
    setSelectedTopicId(incomingContext.topicId || null)
    if (!incomingTopicManuallyChangedRef.current) setQuery(topicQueryForRoute(nextRouteId, incomingContext.topicId))
    if (stateOwnerId) setView('dashboard')
  }, [incomingContext.routeId, incomingContext.topicId, sharedAccount.identity?.id, sharedAccount.status, stateOwnerId])

  useEffect(() => {
    saveState(appState, { userId: stateOwnerId })
  }, [appState, stateOwnerId])

  useEffect(() => {
    if (migrationAttemptedRef.current) return
    migrationAttemptedRef.current = true
    setAppState((state) => {
      const needsContextMigration = [...(state.attempts || []), ...Object.values(state.drafts || {})]
        .some((record) => record?.routeMigration?.status === 'deferred')
      return needsContextMigration ? normalizeState(state, { units: migrationUnits }) : state
    })
  }, [migrationUnits])

  function selectRoute(routeId) {
    const route = routeById(routeId)
    if (!route) return
    const subject = subjects.find((item) => item.routeIds?.includes(routeId))
    setActiveRouteId(routeId)
    setSelectedTopicId(null)
    if (subject) setSubjectFilter(subject.id)
    setAppState((state) => ({
      ...state,
      profile: {
        ...state.profile,
        activeRouteId: routeId,
        learningTrack: route.stage,
        recentRouteIds: [routeId, ...(state.profile.recentRouteIds || []).filter((id) => id !== routeId)].slice(0, 6),
      },
    }))
  }

  const refreshSharedAccount = useCallback(async () => {
    try {
      const account = await requestSharedAccount()
      const workspace = await requestSharedWorkspace(account.token)
      setSharedAccount({ status: 'ready', ...account, workspace, error: '' })
      return account
    } catch (error) {
      setSharedAccount({ status: 'guest', token: '', workspace: null, error: error.message || 'Shared account is unavailable.' })
      return null
    }
  }, [])

  useEffect(() => {
    refreshSharedAccount()
    const timer = window.setInterval(refreshSharedAccount, 4 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [refreshSharedAccount])

  useEffect(() => {
    const accountUserId = String(sharedAccount.identity?.id || '')
    if (sharedAccount.status !== 'ready' || !sharedAccount.token || !accountUserId || accountUserId !== stateOwnerId) return undefined
    let cancelled = false
    sharedAccountRequest(sharedAccount.token, `/api/stem/notebook/notes?routeId=${encodeURIComponent(activeRouteId)}`)
      .then((payload) => {
        if (cancelled || stateOwnerIdRef.current !== accountUserId) return
        setAppState((state) => {
          if (!payload.note) {
            if (!Object.prototype.hasOwnProperty.call(state.notebookNotes || {}, activeRouteId)) return state
            const { [activeRouteId]: _removed, ...notebookNotes } = state.notebookNotes || {}
            return { ...state, notebookNotes }
          }
          const current = state.notebookNotes?.[activeRouteId]
          const note = mergeNotebookNote(current, payload.note, { preferTombstone: true })
          if (!note || note === current) return state
          return { ...state, notebookNotes: { ...(state.notebookNotes || {}), [activeRouteId]: note } }
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeRouteId, sharedAccount.identity?.id, sharedAccount.status, sharedAccount.token, stateOwnerId])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  useEffect(() => {
    if (view !== 'practice') return undefined
    const tick = window.setInterval(() => {
      setCurrentAttempt((attempt) => {
        if (!attempt) return attempt
        const next = { ...attempt, elapsedSec: attempt.elapsedSec + 1 }
        if (next.elapsedSec % 15 === 0) {
          setAppState((state) => ({
            ...state,
            drafts: {
              ...state.drafts,
              [attempt.unitId]: {
                routeId: next.routeId,
                stage: next.stage,
                answers: next.answers,
                working: next.working,
                evidence: next.evidence,
                elapsedSec: next.elapsedSec,
                activePartId: next.activePartId,
                settings: next.settings,
                updatedAt: new Date().toISOString(),
              },
            },
          }))
        }
        return next
      })
    }, 1000)

    return () => window.clearInterval(tick)
  }, [view])

  const completionByUnit = useMemo(() => {
    return buildCompletionByUnit({ attempts: appState.attempts, units: allPracticeUnits, routes: courseRoutes, routeId: activeRouteId })
  }, [activeRouteId, allPracticeUnits, appState.attempts])

  const mistakes = useMemo(() => {
    const attemptById = new Map(appState.attempts.map((attempt) => [attempt.id, attempt]))
    const unitById = new Map(allPracticeUnits.map((unit) => [unit.id, unit]))
    const latestRetestCriterion = (sourceAttempt, partId) => [...appState.attempts].reverse().find((candidate) => {
      let parentId = candidate.retestOf
      while (parentId) {
        if (parentId === sourceAttempt.id) {
          return isScoredAttempt(candidate, unitById.get(candidate.unitId))
            && candidate.scoreResult?.criteria?.some((criterion) => criterion.partId === partId)
        }
        parentId = attemptById.get(parentId)?.retestOf
      }
      return false
    })?.scoreResult?.criteria?.find((criterion) => criterion.partId === partId)

    return appState.attempts.flatMap((attempt) => {
      const unit = allPracticeUnits.find((item) => item.id === attempt.unitId)
      if (!unit || unit.routeId !== activeRouteId || !isScoredAttempt(attempt, unit)) return []
      return attempt.scoreResult.criteria
        .filter((criterion) => hasAttemptResponse(attempt, criterion.partId))
        .filter((criterion) => criterion.awarded < criterion.maxMarks)
        .filter((criterion) => {
          const retestCriterion = latestRetestCriterion(attempt, criterion.partId)
          return !retestCriterion || retestCriterion.awarded < retestCriterion.maxMarks
        })
        .map((criterion) => {
          const part = unit.parts.find((item) => item.id === criterion.partId)
          return {
            id: `${attempt.id}-${criterion.partId}`,
            attempt,
            unit,
            part,
            criterion,
            severity: criterion.awarded === 0 ? 'High' : 'Medium',
            status: criterion.status === 'review-needed' ? 'Review needed' : 'Open',
          }
        })
    })
  }, [activeRouteId, allPracticeUnits, appState.attempts])

  const paperMistakes = useMemo(() => {
    const reviews = appState.paperReviews || []
    const latestReviewByAttempt = new Map()
    reviews.forEach((review) => latestReviewByAttempt.set(review.attemptId, review))
    const sessionByAttempt = new Map(appState.paperSessions.map((session) => [session.attemptId, session]))
    const paperById = new Map((paperCatalogState.catalog?.items || []).map((paper) => [paper.id, paper]))

    function latestDescendantReview(sourceAttemptId) {
      for (const candidate of [...appState.paperSessions].reverse()) {
        let parentId = candidate.retestOf
        while (parentId) {
          if (parentId === sourceAttemptId) {
            const review = latestReviewByAttempt.get(candidate.attemptId)
            if (review) return { session: candidate, review }
            break
          }
          parentId = sessionByAttempt.get(parentId)?.retestOf
        }
      }
      return null
    }

    return appState.paperSessions.flatMap((session) => {
      if (session.retestOf || session.routeId !== activeRouteId) return []
      const sourceReview = latestReviewByAttempt.get(session.attemptId)
      if (!sourceReview) return []
      const descendant = latestDescendantReview(session.attemptId)
      const activeSession = descendant?.session || session
      const activeReview = descendant?.review || sourceReview
      const paper = paperById.get(session.paperId)
      if (!paper) return []
      const pdfInkQuestionNumbers = new Set(Object.values(activeSession.pdfInkQuestionMap || {}).flat().map(Number).filter(Number.isFinite))

      return Array.from({ length: session.questionCount || 0 }, (_, index) => index + 1).flatMap((questionNumber) => {
        const answer = activeSession.answers?.[questionNumber] || {}
        const hasResponse = activeSession.profile?.mode === 'mcq'
          ? Boolean(answer.choice)
          : Boolean(String(answer.finalAnswer || '').trim() || answer.image || pdfInkQuestionNumbers.has(questionNumber))
        const awardedValue = activeReview.selfMarks?.[questionNumber]
        const maxValue = activeSession.profile?.mode === 'mcq' ? 1 : activeReview.maxMarksByQuestion?.[questionNumber]
        const awarded = awardedValue === '' || awardedValue == null ? null : Number(awardedValue)
        const maxMarks = maxValue === '' || maxValue == null ? null : Number(maxValue)
        const secure = Number.isFinite(awarded) && Number.isFinite(maxMarks) && maxMarks > 0 && awarded >= maxMarks
        if (secure) return []

        return [{
          id: `paper-${session.attemptId}-${questionNumber}`,
          kind: 'paper',
          session,
          paper,
          questionNumber,
          awarded: Number.isFinite(awarded) ? awarded : null,
          maxMarks: Number.isFinite(maxMarks) ? maxMarks : null,
          severity: Number.isFinite(awarded) && awarded === 0 ? 'High' : 'Medium',
          status: !hasResponse ? 'Blank response' : Number.isFinite(awarded) ? 'Open' : 'Self-mark needed',
        }]
      })
    })
  }, [activeRouteId, appState.paperReviews, appState.paperSessions, paperCatalogState.catalog])

  const topicMastery = useMemo(() => {
    return routePracticeUnits.map((unit) => {
      const best = bestResultFor(appState.attempts, unit.id)
      return {
        id: unit.id,
        topic: unit.topic,
        subjectId: unit.subjectId,
        icon: unit.icon,
        score: best?.percentage ?? null,
      }
    })
  }, [appState.attempts, routePracticeUnits])

  const recommendation = useMemo(() => {
    return recommendForRoute({ attempts: appState.attempts, drafts: appState.drafts, units: allPracticeUnits, routes: courseRoutes, routeId: activeRouteId })
  }, [activeRouteId, allPracticeUnits, appState.attempts, appState.drafts])

  const visibleUnits = useMemo(() => {
    const source = activeTab === 'papers' || activeTab === 'exams' || activeTab === 'mistakes' ? [] : routePracticeUnits
    const normalizedQuery = query.toLowerCase().trim()

    return source.filter((unit) => {
      const completion = completionByUnit[unit.id]
      const matchesCompletion =
        completionFilter === 'all' ||
        (completionFilter === 'completed' && completion.completed) ||
        (completionFilter === 'open' && !completion.completed)
      const matchesQuery =
        !normalizedQuery ||
        [unit.title, unit.topic, unit.subtopic, unit.specification, unit.board]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      return matchesCompletion && matchesQuery
    })
  }, [activeTab, completionByUnit, completionFilter, query, routePracticeUnits])

  function updateProfile(patch) {
    setAppState((state) => ({ ...state, profile: { ...state.profile, ...patch } }))
  }

  function setImmersiveLearning(value) {
    updateProfile({ immersiveLearning: Boolean(value) })
  }

  function toggleFavoriteUnit(unitId) {
    setAppState((state) => {
      const current = state.favoriteUnitIds || []
      const favoriteUnitIds = current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [unitId, ...current].slice(0, 24)
      return { ...state, favoriteUnitIds }
    })
  }

  function updateNotebookNote(value) {
    const updatedAt = new Date().toISOString()
    const request = notebookNoteRequest(value)
    const deleted = request.method === 'DELETE'
    const noteOwnerId = String(sharedAccount.identity?.id || '')
    setAppState((state) => ({
      ...state,
      notebookNotes: {
        ...(state.notebookNotes || {}),
        [activeRouteId]: {
          body: deleted ? '' : value,
          updatedAt,
          ...(deleted ? { deleted: true, deletedAt: updatedAt } : { deleted: false, deletedAt: null }),
          syncStatus: sharedAccount.status === 'ready' ? 'pending' : 'local-only',
        },
      },
    }))
    if (notebookSyncTimerRef.current) window.clearTimeout(notebookSyncTimerRef.current)
    if (sharedAccount.status === 'ready' && sharedAccount.token && noteOwnerId) {
      notebookSyncTimerRef.current = window.setTimeout(async () => {
        if (stateOwnerIdRef.current !== noteOwnerId) return
        try {
          const payload = await sharedAccountRequest(sharedAccount.token, `/api/stem/notebook/notes/${encodeURIComponent(activeRouteId)}`, request)
          if (stateOwnerIdRef.current !== noteOwnerId) return
          setAppState((state) => {
            const current = state.notebookNotes?.[activeRouteId]
            const syncedNote = mergeNotebookNote(current, payload.note)
            return {
              ...state,
              notebookNotes: {
                ...(state.notebookNotes || {}),
                [activeRouteId]: syncedNote || { ...(current || {}), syncStatus: 'synced' },
              },
            }
          })
        } catch {
          if (stateOwnerIdRef.current !== noteOwnerId) return
          setAppState((state) => ({
            ...state,
            notebookNotes: {
              ...(state.notebookNotes || {}),
              [activeRouteId]: { ...(state.notebookNotes?.[activeRouteId] || {}), syncStatus: 'error' },
            },
          }))
        }
      }, 650)
    }
  }

  function disconnectSharedAccount() {
    setSharedAccount({ status: 'guest', token: '', workspace: null, error: 'You are signed out of the STEM session.' })
    window.location.assign(sharedLogoutUrl())
  }

  async function createClassroom(name) {
    const account = sharedAccount.status === 'ready' ? sharedAccount : await refreshSharedAccount()
    if (!account?.token) throw new Error('Sign in to IELTS-ist before creating a class.')
    const result = await sharedAccountRequest(account.token, '/api/stem/classrooms', { method: 'POST', body: JSON.stringify({ name }) })
    const workspace = await requestSharedWorkspace(account.token)
    setSharedAccount((current) => ({ ...current, status: 'ready', workspace }))
    return result.classroom
  }

  async function joinClassroom(inviteCode) {
    const account = sharedAccount.status === 'ready' ? sharedAccount : await refreshSharedAccount()
    if (!account?.token) throw new Error('Sign in to IELTS-ist before joining a class.')
    await sharedAccountRequest(account.token, '/api/stem/classrooms/join', { method: 'POST', body: JSON.stringify({ inviteCode }) })
    const workspace = await requestSharedWorkspace(account.token)
    setSharedAccount((current) => ({ ...current, status: 'ready', workspace }))
  }

  async function createAssignment(draft) {
    const account = sharedAccount.status === 'ready' ? sharedAccount : await refreshSharedAccount()
    if (!account?.token) throw new Error('Sign in to IELTS-ist before creating an assignment.')
    const route = routeById(draft.routeId)
    if (!route || route.stage !== draft.stage) throw new Error('Choose a valid registered route before publishing.')
    const subject = subjects.find((item) => item.routeIds?.includes(route.routeId))
    const topic = learningPlan.knowledgeGroups.find((group) => group.id === draft.topicId)
    const classroomId = draft.classroomId || account.workspace?.classrooms?.find((classroom) => ['owner', 'teacher'].includes(classroom.role))?.id
    if (!classroomId) throw new Error('Create or join a teacher class before assigning work.')
    const verifiedUnit = buildCoachPractice({ routeId: route.routeId, knowledgeGroupId: draft.topicId, questionCount: 10 })
    const result = await sharedAccountRequest(account.token, '/api/stem/assignments', {
      method: 'POST',
      body: JSON.stringify({
        classroomId,
        subjectId: verifiedUnit.subjectId,
        routeId: route.routeId,
        stage: route.stage,
        syllabusPointId: draft.topicId,
        title: draft.title || `${subject?.code || ''} ${topic?.name || 'verified practice'}`.trim(),
        dueAt: draft.dueDate || null,
        sourceScope: { routeId: route.routeId, stage: route.stage, questionIds: [...new Set(verifiedUnit.parts.map((part) => part.bankId))], provenanceVersion: 'qp-ms-v2' },
      }),
    })
    const workspace = await requestSharedWorkspace(account.token)
    setSharedAccount((current) => ({ ...current, status: 'ready', workspace }))
    return result.assignment
  }

  function startAssignedAssignment(assignment) {
    const sourceQuestionIds = assignment.sourceScope?.questionIds
    if (!Array.isArray(sourceQuestionIds) || !sourceQuestionIds.length) {
      throw new Error('This assignment has no verified source question list. Ask the teacher to republish it.')
    }
    const unit = buildCoachPractice({
      routeId: assignment.routeId,
      knowledgeGroupId: assignment.syllabusPointId,
      sourceQuestionIds,
      unitId: `assignment:${assignment.id}`,
    })
    startPractice(unit, { assignmentId: assignment.id })
  }

  function startPractice(unit, options = {}) {
    const hasSourceParts = Array.isArray(unit?.parts) && unit.parts.some((part) => part?.sourceKind === 'past-paper')
    const currentBoundUnit = hasSourceParts ? rebindVerifiedPracticeUnit(unit) : unit
    if (!currentBoundUnit || !routeById(currentBoundUnit.routeId)) {
      throw new Error('This saved question set is no longer source-complete and cannot be resumed or marked.')
    }
    const sourceAttempt = options.retestOf
      ? appState.attempts.find((attempt) => attempt.id === options.retestOf)
      : null
    if (sourceAttempt && !hasCurrentSourceBindingForAttempt(sourceAttempt, currentBoundUnit)) {
      throw new Error('This saved attempt is linked to an older source review and is available only as read-only history.')
    }
    selectRoute(currentBoundUnit.routeId)
    const sessionUnit = focusedRetestUnit(currentBoundUnit, options.onlyPartId)
    if (!options.confirmed) {
      setPendingSession({
        unit: sessionUnit,
        options,
        mode: sessionUnit.type === 'paper' ? 'exam' : options.retestOf ? 'guided' : 'practice',
        timing: sessionUnit.type === 'paper' ? 'timed' : 'recommended',
        hints: sessionUnit.type !== 'paper',
      })
      return
    }
    if (sessionUnit.focusedRetestOf || sessionUnit.agentGenerated) {
      setAppState((state) => ({
        ...state,
        generatedUnits: [sessionUnit, ...(state.generatedUnits || []).filter((item) => item.id !== sessionUnit.id)].slice(0, 24),
      }))
    }
    setAppState((state) => ({
      ...state,
      recentPractice: [
        { unitId: sessionUnit.id, attemptId: options.clearDraft ? null : state.drafts[sessionUnit.id]?.attemptId || null, openedAt: new Date().toISOString() },
        ...(state.recentPractice || []).filter((item) => item.unitId !== sessionUnit.id),
      ].slice(0, 8),
    }))
    const draft = options.clearDraft ? null : appState.drafts[sessionUnit.id]
    setCurrentAttempt({
      id: draft?.attemptId || makeAttemptId(),
      unitId: sessionUnit.id,
      routeId: sessionUnit.routeId,
      qualification: sessionUnit.qualification,
      courseStage: sessionUnit.stage,
      mode: sessionUnit.type,
      stage: sessionUnit.stage,
      attemptStatus: 'practice',
      startedAt: draft?.startedAt || new Date().toISOString(),
      elapsedSec: draft?.elapsedSec || 0,
      durationSec: sessionUnit.durationSec,
      activePartId: draft?.activePartId || sessionUnit.parts[0].id,
      answers: migratePracticeAnswers(sessionUnit, draft),
      working: draft?.working || {},
      evidence: draft?.evidence || {},
      saveStatus: draft ? 'Restored draft' : 'Ready',
      retestOf: options.retestOf || null,
      assignmentId: options.assignmentId || null,
      sourceBinding: sourceBindingSnapshotForUnit(sessionUnit),
      settings: options.settings || draft?.settings || { mode: sessionUnit.type === 'paper' ? 'exam' : 'practice', timing: 'recommended', hints: true },
    })
    setPendingSession(null)
    setResultAttempt(null)
    setView('practice')
  }

  function openPaper(paper, routeOverride = activeRoute) {
    const paperNumber = paper.examProfile?.paperNumber == null ? null : Number(paper.examProfile.paperNumber)
    const routeMatches = String(paper.subject) === String(routeOverride.subjectCode)
      && (paperNumber == null || !Number.isFinite(paperNumber) || !routeOverride.paperComponents.length || routeOverride.paperComponents.includes(paperNumber))
    if (!routeMatches) return
    const scopedPaper = { ...paper, routeId: routeOverride.routeId, stage: routeOverride.stage, qualification: routeOverride.qualification }
    setActivePaper(scopedPaper)
    setAppState((state) => ({
      ...state,
      recentPapers: [paper.id, ...state.recentPapers.filter((id) => id !== paper.id)].slice(0, 8),
    }))
    setView('paper')
  }

  function generateCoachPractice(selection) {
    const unit = buildCoachPractice({
      ...selection,
      agentGenerated: true,
      allowPartial: selection.allowPartial ?? true,
    })
    setAppState((state) => ({
      ...state,
      generatedUnits: [unit, ...(state.generatedUnits || [])].slice(0, 24),
    }))
    startPractice(unit, {
      confirmed: true,
      clearDraft: true,
      settings: { mode: 'guided', timing: 'recommended', hints: true },
    })
    return unit
  }

  async function handleCoachAgentAction(intent) {
    if (intent.type === 'open-latest-paper' && intent.contest === 'bpho-spc') {
      const bphoRoute = routeById(intent.routeId)
      if (!bphoRoute || bphoRoute.subjectId !== 'bpho' || bphoRoute.stage !== 'Competition') {
        return { handled: true, message: 'This Competition paper request is not bound to a verified learning route.' }
      }
      const paper = latestBphoSpcPaper(paperCatalogState.catalog?.items || [])
      if (!paper) {
        return {
          handled: true,
          message: 'BPhO SPC 的本地 PDF 目录还没有加载好，或没有找到已配对的最新 QP/MS。请稍后再试。',
        }
      }
      selectRoute(bphoRoute.routeId)
      openPaper({
        ...paper,
        agentNotice: '已打开最新 BPhO SPC question paper。先在右侧答题区作答并提交，提交后会解锁精确配对的 mark scheme。',
      }, bphoRoute)
      return {
        handled: true,
        message: `已打开 ${paper.file}。它已经配对 ${paper.markSchemeId ? '精确 mark scheme' : '答案文件'}；提交答题区后可以查看答案。`,
      }
    }

    if (intent.type === 'build-topic-practice') {
      try {
        const selection = resolveVerifiedPracticeSelection({
          routeId: intent.routeId,
          subjectId: intent.subjectId,
          stage: intent.stage,
          topicId: intent.topicId || intent.knowledgeGroupId,
        })
        const unit = generateCoachPractice({
          ...intent,
          routeId: selection.subject.routeId,
          stage: selection.subject.stage,
          topicId: selection.group.id,
          knowledgeGroupId: selection.group.id,
        })
        return {
          handled: true,
          message: `已生成 ${unit.title}。共 ${unit.parts.length} 道真实来源题，每题绑定原卷和对应 mark scheme；提交后自动批改，手写图像会进入 AI 复核。`,
        }
      } catch (error) {
        return { handled: true, message: error.message || 'This topic does not yet have enough verified questions.' }
      }
    }

    return { handled: false }
  }

  function retestPaper(paper, sourceAttemptId) {
    const key = paper.pairKey || paper.id
    setAppState((state) => {
      const { [key]: _removedDraft, ...paperDrafts } = state.paperDrafts
      return { ...state, paperDrafts, recentPapers: [paper.id, ...state.recentPapers.filter((id) => id !== paper.id)].slice(0, 8) }
    })
    const sourceSession = appState.paperSessions.find((session) => session.attemptId === sourceAttemptId)
    setActivePaper({ ...paper, routeId: sourceSession?.routeId || activeRouteId, stage: sourceSession?.stage || activeRoute.stage, qualification: sourceSession?.qualification || activeRoute.qualification, retestOf: sourceAttemptId })
    setView('paper')
  }

  const savePaperDraft = useCallback((draft) => {
    const key = draft.pairKey || draft.paperId
    setAppState((state) => ({ ...state, paperDrafts: { ...state.paperDrafts, [key]: draft } }))
  }, [])

  function finishPaperSession(session) {
    setAppState((state) => {
      if (state.paperSessions.some((item) => item.attemptId === session.attemptId)) return state
      return {
        ...state,
        paperSessions: [
          ...state.paperSessions,
          { ...session, routeId: activePaper?.routeId || activeRouteId, stage: activePaper?.stage || activeRoute.stage, qualification: activePaper?.qualification || activeRoute.qualification, id: makeAttemptId().replace('att-', 'paper-'), completedAt: session.submittedAt || new Date().toISOString() },
        ],
      }
    })
  }

  function finishPaperReview(review) {
    setAppState((state) => ({
      ...state,
      paperReviews: [
        ...(state.paperReviews || []),
        { ...review, routeId: activePaper?.routeId || activeRouteId, stage: activePaper?.stage || activeRoute.stage, id: makeAttemptId().replace('att-', 'review-'), completedAt: review.reviewedAt || new Date().toISOString() },
      ],
    }))
  }

  async function exportLearningData() {
    setExportState({ status: 'preparing', error: '', exportedAt: '', checksum: '' })
    try {
      const prepared = await prepareLearningExport(appState, { units: allPracticeUnits })
      const checksum = prepared.checksum
      const blob = new Blob([prepared.json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `alevel-studio-export-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setExportState({ status: 'ready', error: '', exportedAt: prepared.payload.exportedAt, checksum })
    } catch {
      setExportState({ status: 'failed', error: 'Your export could not be prepared. Try again.', exportedAt: '', checksum: '' })
    }
  }

  function updateAnswer(partId, value) {
    setCurrentAttempt((attempt) => {
      const next = {
        ...attempt,
        answers: { ...attempt.answers, [partId]: value },
        saveStatus: 'Autosaved',
      }
      setAppState((state) => ({
        ...state,
        drafts: {
          ...state.drafts,
          [attempt.unitId]: {
            attemptId: next.id,
            startedAt: next.startedAt,
            routeId: next.routeId,
            stage: next.stage,
            answers: next.answers,
            working: next.working,
            evidence: next.evidence,
            elapsedSec: next.elapsedSec,
            activePartId: next.activePartId,
            settings: next.settings,
            updatedAt: new Date().toISOString(),
          },
        },
      }))
      return next
    })
  }

  function updateEvidence(partId, evidence) {
    setCurrentAttempt((attempt) => {
      const next = {
        ...attempt,
        evidence: { ...attempt.evidence, [partId]: evidence },
        saveStatus: 'Autosaved',
      }
      setAppState((state) => ({
        ...state,
        drafts: {
          ...state.drafts,
          [attempt.unitId]: {
            attemptId: next.id,
            startedAt: next.startedAt,
            routeId: next.routeId,
            stage: next.stage,
            answers: next.answers,
            working: next.working,
            evidence: next.evidence,
            elapsedSec: next.elapsedSec,
            activePartId: next.activePartId,
            settings: next.settings,
            updatedAt: new Date().toISOString(),
          },
        },
      }))
      return next
    })
  }

  function setActivePart(partId) {
    setCurrentAttempt((attempt) => {
      const next = { ...attempt, activePartId: partId }
      setAppState((state) => ({
        ...state,
        drafts: {
          ...state.drafts,
          [attempt.unitId]: {
            attemptId: next.id,
            startedAt: next.startedAt,
            routeId: next.routeId,
            stage: next.stage,
            answers: next.answers,
            working: next.working,
            evidence: next.evidence,
            elapsedSec: next.elapsedSec,
            activePartId: partId,
            settings: next.settings,
            updatedAt: new Date().toISOString(),
          },
        },
      }))
      return next
    })
  }

  async function submitAttempt(evidencePatch = {}) {
    if (!currentAttempt) return
    if (currentAttempt.submitting) return
    const attemptSnapshot = { ...currentAttempt, evidence: { ...(currentAttempt.evidence || {}), ...evidencePatch }, submitting: true }
    setCurrentAttempt(attemptSnapshot)
    const unit = allPracticeUnits.find((item) => item.id === currentAttempt.unitId)
    if (!unit) {
      setCurrentAttempt(null)
      setView('library')
      return
    }
    const capability = markingCapabilityForUnit(unit)
    const sourceBinding = sourceBindingSnapshotForUnit(unit)
    if ((unit.parts || []).some((part) => part.sourceKind === 'past-paper') && !sourceBinding) {
      setCurrentAttempt({ ...attemptSnapshot, submitting: false, saveStatus: 'Source review changed. Reopen this set before submitting.' })
      return
    }
    const submittedAt = new Date().toISOString()
    const submittedAttempt = { ...attemptSnapshot, submittedAt, submitting: false }
    const visionReviews = capability.counts['ai-assisted'] ? await requestVisionReviews(unit, submittedAttempt, sharedAccount.token) : {}
    const markingLifecycle = buildPartMarkingLifecycle(unit, attemptSnapshot.answers, attemptSnapshot.elapsedSec, visionReviews)
    const scoreResult = markingLifecycle.complete
      ? finalizePartMarking(unit, markingLifecycle, {}, attemptSnapshot.elapsedSec)
      : null
    const pendingStatus = capability.mode === 'self-mark' ? 'self-mark-pending' : 'marking-pending'
    const imageEvidence = Object.entries(attemptSnapshot.evidence || {}).filter(([, evidence]) => Boolean(evidence)).map(([partId, evidence]) => ({ partId, ...evidence }))
    const completedAttempt = {
      ...attemptSnapshot,
      submitting: false,
      routeId: unit.routeId,
      stage: unit.stage,
      attemptStatus: scoreResult ? 'result' : pendingStatus,
      submittedAt,
      sourceBinding,
      ...(scoreResult ? { scoreResult } : {}),
      assistedReview: null,
      imageEvidence,
      visionReviews,
      markingLifecycle,
      selfMarkPending: !scoreResult,
      contentScope: {
        unitId: unit.id,
        title: unit.title,
        type: unit.type,
        routeId: unit.routeId,
        qualification: unit.qualification,
        stage: unit.stage,
        subjectId: unit.subjectId,
        syllabusTopic: unit.syllabusTopic || unit.knowledgeGroupId,
        topic: unit.topic,
      },
    }
    const previousScores = appState.attempts
      .filter((attempt) => isScoredAttempt(attempt, unit) && attempt.routeId === unit.routeId && attempt.unitId === unit.id)
      .map((attempt) => attempt.scoreResult.percentage)
    const masteryBefore = previousScores.length
      ? Math.round(previousScores.reduce((total, score) => total + score, 0) / previousScores.length)
      : null
    if (scoreResult) {
      completedAttempt.learningSignal = {
        masteryBefore,
        masteryAfter: scoreResult.percentage,
        masteryDelta: masteryBefore == null ? null : scoreResult.percentage - masteryBefore,
      }
    }

    if (scoreResult && attemptSnapshot.assignmentId && sharedAccount.status === 'ready') {
      try {
        await sharedAccountRequest(sharedAccount.token, `/api/stem/assignments/${encodeURIComponent(attemptSnapshot.assignmentId)}/submissions`, {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: attemptSnapshot.id,
            attemptId: attemptSnapshot.id,
            routeId: unit.routeId,
            stage: unit.stage,
            rawMarks: scoreResult.rawMarks,
            maxMarks: scoreResult.maxMarks,
            percentage: scoreResult.percentage,
            elapsedSeconds: scoreResult.elapsedSec,
            markingMode: Object.keys(visionReviews).length ? 'assisted-vision' : 'deterministic',
            reviewRequired: Object.values(visionReviews).some((review) => review.reviewRequired),
          }),
          storageUserId: stateOwnerId,
        })
        completedAttempt.serverSync = 'synced'
      } catch (error) {
        completedAttempt.serverSync = 'pending'
        completedAttempt.serverSyncError = error.message || 'The local result is saved and will need a retry.'
      }
    }

    setAppState((state) => {
      const { [unit.id]: _removedDraft, ...drafts } = state.drafts
      return {
        ...state,
        attempts: [...state.attempts, completedAttempt],
        drafts,
      }
    })
    setCurrentAttempt(null)
    setResultAttempt(completedAttempt)
    setView('result')
  }

  function saveSelfMarkDraft(attemptId, marksByPart) {
    setAppState((state) => ({
      ...state,
      selfMarkDrafts: {
        ...(state.selfMarkDrafts || {}),
        [attemptId]: { ...marksByPart, updatedAt: new Date().toISOString() },
      },
    }))
  }

  function recordSelfMark(attemptId, marksByPart) {
    const pending = appState.attempts.find((attempt) => attempt.id === attemptId)
    const unit = pending && allPracticeUnits.find((item) => item.id === pending.unitId)
    if (!pending || !unit || !isPendingSelfMarkAttempt(pending) || !hasCurrentSourceBindingForAttempt(pending, unit)) return
    const existingFinal = appState.attempts.find((attempt) => attempt.finalizedFromAttemptId === attemptId && isScoredAttempt(attempt, unit))
    if (existingFinal) {
      setResultAttempt(existingFinal)
      return
    }
    const markingLifecycle = pending.markingLifecycle || buildPartMarkingLifecycle(unit, pending.answers, pending.elapsedSec, pending.visionReviews)
    if (!hasCompleteStudentMarks(unit, markingLifecycle, marksByPart)) return
    const scoreResult = finalizePartMarking(unit, markingLifecycle, marksByPart, pending.elapsedSec)
    const previousScores = appState.attempts
      .filter((attempt) => attempt.id !== attemptId && isScoredAttempt(attempt, unit) && attempt.routeId === unit.routeId && attempt.unitId === unit.id)
      .map((attempt) => attempt.scoreResult.percentage)
    const masteryBefore = previousScores.length ? Math.round(previousScores.reduce((total, score) => total + score, 0) / previousScores.length) : null
    const recorded = {
      ...pending,
      id: makeAttemptId(),
      finalizedFromAttemptId: pending.id,
      attemptStatus: 'result',
      selfMarkPending: false,
      studentSelfMarks: Object.fromEntries(pendingPartsForLifecycle(unit, markingLifecycle).map((part) => [part.id, Number(marksByPart[part.id])])),
      selfMarkRecordedAt: new Date().toISOString(),
      scoreResult,
      markingResolution: {
        finalizedAt: new Date().toISOString(),
        studentMarkedPartIds: pendingPartsForLifecycle(unit, markingLifecycle).map((part) => part.id),
      },
      learningSignal: {
        masteryBefore,
        masteryAfter: scoreResult.percentage,
        masteryDelta: masteryBefore == null ? null : scoreResult.percentage - masteryBefore,
      },
    }
    setAppState((state) => {
      const { [attemptId]: _removedDraft, ...selfMarkDrafts } = state.selfMarkDrafts || {}
      return { ...state, attempts: [...state.attempts, recorded], selfMarkDrafts }
    })
    setResultAttempt(recorded)
  }

  const currentUnit = currentAttempt ? allPracticeUnits.find((unit) => unit.id === currentAttempt.unitId) : null
  const resultUnit = resultAttempt ? allPracticeUnits.find((unit) => unit.id === resultAttempt.unitId) : null
  const resultIsPendingSelfMark = Boolean(resultAttempt && resultUnit && isPendingSelfMarkAttempt(resultAttempt))
  const resultCoachPart = resultAttempt && resultUnit
    ? resultUnit.parts.find((part) => !resultIsPendingSelfMark && part.id === resultAttempt.scoreResult?.weakestPartId)
      || resultUnit.parts.find((part) => hasAttemptResponse(resultAttempt, part.id))
      || resultUnit.parts[0]
    : null

  function returnToLibrary(tab = 'recommended') {
    setCurrentAttempt(null)
    setPendingSession(null)
    setResultAttempt(null)
    setActivePaper(null)
    setSelectedTopicId(null)
    setActiveTab(tab)
    setView('library')
  }

  return (
    <main className={`app-shell app-shell--${view}`}>
      {view !== 'practice' && view !== 'paper' && <TopNav view={view} activeTab={activeTab} setView={setView} profile={appState.profile} sharedAccount={sharedAccount} onRefreshSharedAccount={refreshSharedAccount} onDisconnectSharedAccount={disconnectSharedAccount} openNotebook={() => setView('notebook')} openRoleWorkspace={() => setView('workspace')} openPractice={() => { setActiveTab('recommended'); setView('library') }} openPapers={() => { setActiveTab('papers'); setView('library') }} />}

      {view === 'dashboard' && (
        <StudentDashboard
          activeRoute={activeRoute}
          routeOptions={courseRoutes}
          selectRoute={selectRoute}
          profile={appState.profile}
          updateProfile={updateProfile}
          attempts={routeAttempts}
          completionByUnit={completionByUnit}
          recommendation={recommendation}
          topicMastery={topicMastery}
          mistakes={mistakes}
          practiceUnits={routePracticeUnits}
          paperMistakes={paperMistakes}
          learningProgress={learningProgress}
          syllabusRoadmap={syllabusRoadmap}
          startPractice={startPractice}
          setView={setView}
          setActiveTab={setActiveTab}
          setSubjectFilter={setSubjectFilter}
          setQuery={setQuery}
          allPracticeUnits={allPracticeUnits}
          recentPractice={appState.recentPractice || []}
           favoriteUnitIds={appState.favoriteUnitIds || []}
           openCoach={() => setCoachOpenRequest((value) => value + 1)}
           sharedAccount={sharedAccount}
           onRefreshSharedAccount={refreshSharedAccount}
           openNotebook={() => setView('notebook')}
          openRoleWorkspace={() => setView('workspace')}
        />
      )}

      {view === 'workspace' && <Suspense fallback={<div className="workspace-loading"><span className="loading-line" />Loading workspace...</div>}><RoleWorkspace profile={appState.profile} updateProfile={updateProfile} assignments={sharedAccount.workspace?.assignments || []} classrooms={sharedAccount.workspace?.classrooms || []} submissions={sharedAccount.workspace?.submissions || []} serverSummaries={sharedAccount.workspace?.serverSummaries || {}} attempts={appState.attempts} learningProgress={learningProgress} account={sharedAccount} onRefreshAccount={refreshSharedAccount} onCreateClassroom={createClassroom} onJoinClassroom={joinClassroom} onCreateAssignment={createAssignment} onStartAssignedAssignment={startAssignedAssignment} /></Suspense>}

      {view === 'notebook' && (
        <StudentNotebook
          activeRoute={activeRoute}
          routeOptions={courseRoutes}
          selectRoute={selectRoute}
          attempts={routeAttempts}
          units={routePracticeUnits}
          mistakes={mistakes}
          paperMistakes={paperMistakes}
          note={appState.notebookNotes?.[activeRouteId] || null}
          onChangeNote={updateNotebookNote}
          onDeleteNote={() => updateNotebookNote('')}
          startPractice={startPractice}
          retestPaper={retestPaper}
          openPractice={() => { setActiveTab('topics'); setView('library') }}
        />
      )}

      {view === 'library' && (
        <LibraryView
          activeRoute={activeRoute}
          activeRouteId={activeRouteId}
          selectRoute={selectRoute}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          query={query}
          onTopicQueryChange={(nextQuery) => { incomingTopicManuallyChangedRef.current = true; setQuery(nextQuery) }}
          visibleUnits={visibleUnits}
          completionByUnit={completionByUnit}
          favoriteUnitIds={appState.favoriteUnitIds || []}
          onToggleFavorite={toggleFavoriteUnit}
          mistakes={mistakes}
          paperMistakes={paperMistakes}
          startPractice={startPractice}
          retestPaper={retestPaper}
          paperCatalogState={paperCatalogState}
          openPaper={openPaper}
          recommendation={recommendation}
          onOpenTopic={(topicId) => { setSelectedTopicId(topicId); setView('topic') }}
          onOpenCoach={() => setCoachOpenRequest((value) => value + 1)}
        />
      )}

      {view === 'topic' && selectedTopicId && (
        <TopicDetail
          activeRoute={activeRoute}
          activeRouteId={activeRouteId}
          topicId={selectedTopicId}
          practiceOptions={aiPracticeOptions}
          practiceUnits={routePracticeUnits}
          completionByUnit={completionByUnit}
          learningProgress={learningProgress}
          mistakes={mistakes}
          startPractice={startPractice}
          startKnowledgeDrill={generateCoachPractice}
          onBack={() => { setActiveTab('topics'); setView('library') }}
          onOpenCoach={() => setCoachOpenRequest((value) => value + 1)}
        />
      )}

      {view === 'history' && (
        <Suspense fallback={<div className="workspace-loading"><span className="loading-line" />Loading history...</div>}><HistoryView
          attempts={routeAttempts}
          paperSessions={routePaperSessions}
          paperReviews={routePaperReviews}
          onRetest={startPractice}
          onContinuePending={(attempt) => {
            setResultAttempt(attempt)
            setView('result')
          }}
          units={routePracticeUnits}
          onExport={exportLearningData}
          exportState={exportState}
        /></Suspense>
      )}

      {view === 'paper' && activePaper && paperCatalogState.catalog && (
        <Suspense fallback={<div className="paper-state workspace-loading"><span className="loading-line" />Loading the PDF study desk...</div>}>
          <PaperWorkspace
            paper={activePaper}
            catalog={paperCatalogState.catalog}
            draft={appState.paperDrafts[activePaper.pairKey || activePaper.id]}
            assignmentContext={(() => {
              const assignment = sharedAccount.workspace?.assignments?.find((item) => item.id === activePaper.assignmentId)
              return assignment ? { assignmentId: assignment.id, classroomId: assignment.classroomId, organizationId: assignment.organizationId || null } : null
            })()}
            sharedIdentityToken={sharedAccount.token}
            stateOwnerId={stateOwnerId}
            immersive={Boolean(appState.profile?.immersiveLearning)}
            onToggleImmersive={setImmersiveLearning}
            onBack={() => {
              returnToLibrary('papers')
            }}
            onSaveDraft={savePaperDraft}
            onFinish={finishPaperSession}
            onFinishReview={finishPaperReview}
          />
        </Suspense>
      )}

      {view === 'practice' && currentUnit && currentAttempt && (
        <PracticeWorkspace
          attempt={currentAttempt}
          unit={currentUnit}
          setActivePart={setActivePart}
          updateAnswer={updateAnswer}
          updateEvidence={updateEvidence}
          submitAttempt={submitAttempt}
            deferredMarking={markingCapabilityForUnit(currentUnit).mode !== 'deterministic'}
            stateOwnerId={stateOwnerId}
          immersive={Boolean(appState.profile?.immersiveLearning)}
          onToggleImmersive={setImmersiveLearning}
          goBack={() => returnToLibrary('topics')}
        />
      )}

      {view === 'result' && resultUnit && resultAttempt && (
          <ResultView
            attempt={resultAttempt}
            unit={resultUnit}
            sourceCurrent={hasCurrentSourceBindingForAttempt(resultAttempt, resultUnit)}
            startPractice={startPractice}
            goLibrary={() => returnToLibrary('recommended')}
            recordSelfMark={recordSelfMark}
            initialSelfMarks={appState.selfMarkDrafts?.[resultAttempt.id] || resultAttempt.studentSelfMarks}
            onSelfMarksChange={(marks) => saveSelfMarkDraft(resultAttempt.id, marks)}
        />
      )}

      {pendingSession && (
        <SessionSetup
          session={pendingSession}
          onChange={(patch) => setPendingSession((current) => ({ ...current, ...patch }))}
          onCancel={() => setPendingSession(null)}
          onStart={() => startPractice(pendingSession.unit, {
            ...pendingSession.options,
            confirmed: true,
            settings: {
              mode: pendingSession.mode,
              timing: pendingSession.timing,
              hints: pendingSession.hints,
            },
          })}
        />
      )}
      {view !== 'practice' && view !== 'paper' && !(view === 'library' && activeTab === 'papers') && (
        <AiCoach
          key={`${activeRouteId}:${view}:${resultAttempt?.id || 'general'}`}
          stateOwnerId={stateOwnerId}
          context={{
            attemptId: resultAttempt?.id,
            stateOwnerId,
            view,
            routeId: resultUnit?.routeId || activeRouteId,
            subject: activeSubject,
            stage: resultUnit?.stage || activeRoute.stage,
            question: resultAttempt && resultUnit ? {
              id: resultCoachPart?.id || '',
              label: resultIsPendingSelfMark ? 'Submitted response pending self-mark' : 'Latest scored result',
              prompt: resultCoachPart?.prompt || resultUnit.title,
            } : null,
            response: resultAttempt && resultCoachPart ? resultAttempt.answers?.[resultCoachPart.id] || resultAttempt.working?.[resultCoachPart.id] || '' : '',
            submitted: view === 'result',
            markingStatus: resultIsPendingSelfMark ? 'self-mark-pending' : resultAttempt?.scoreResult ? 'scored' : 'not-scored',
          }}
          openRequest={coachOpenRequest}
          practiceOptions={aiPracticeOptions}
          onGeneratePractice={generateCoachPractice}
          onAgentAction={handleCoachAgentAction}
        />
      )}
    </main>
  )
}

function SessionSetup({ session, onChange, onCancel, onStart }) {
  const { unit } = session
  const isPaper = unit.type === 'paper'
  const markingCapability = markingCapabilityForUnit(unit)
  return (
    <div className="setup-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="session-setup" role="dialog" aria-modal="true" aria-labelledby="setup-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="section-label">Session setup</p><h2 id="setup-title">{unit.title}</h2><p>{unit.topic} · {unit.parts.length} questions · {unit.maxMarks} marks</p></div><button type="button" className="setup-close" onClick={onCancel} aria-label="Close setup">×</button></header>
        <div className="setup-section"><span className="setup-label">How do you want to practise?</span><div className="mode-segments"><button type="button" className={session.mode === 'guided' ? 'active' : ''} onClick={() => onChange({ mode: 'guided', hints: true })}><Sparkles size={16} /><strong>Guided</strong><small>Hints available</small></button><button type="button" className={session.mode === 'practice' ? 'active' : ''} onClick={() => onChange({ mode: 'practice' })}><Dumbbell size={16} /><strong>Practice</strong><small>Independent set</small></button><button type="button" className={session.mode === 'exam' ? 'active' : ''} onClick={() => onChange({ mode: 'exam', timing: 'timed', hints: false })}><GraduationCap size={16} /><strong>Exam</strong><small>Answers hidden</small></button></div></div>
        <div className="setup-options"><label><span>Timing</span><select value={session.timing} onChange={(event) => onChange({ timing: event.target.value })}><option value="recommended">Recommended · {unit.estimatedMinutes} min</option><option value="timed">Strict timer</option><option value="untimed">Untimed</option></select></label><label className="toggle-row"><span><strong>Question hints</strong><small>Hints never reveal the final answer.</small></span><input type="checkbox" checked={session.hints} disabled={session.mode === 'exam'} onChange={(event) => onChange({ hints: event.target.checked })} /></label></div>
        <div className="setup-summary"><ListFilter size={18} /><div><strong>{unit.parts.length} questions ready</strong><span>{isPaper ? 'Mixed paper practice' : `${unit.subtopic || unit.topic} knowledge drill`} · autosave on</span></div></div>
        <div className={`setup-marking-note setup-marking-note--${markingCapability.mode}`} role="status"><strong>{markingCapability.label}</strong><span>{markingCapability.description}</span></div>
        <footer><button type="button" className="secondary-action" onClick={onCancel}>Cancel</button><button type="button" className="primary-action" onClick={onStart}><PlayIcon />Start session</button></footer>
      </section>
    </div>
  )
}

function StudentRoutePicker({ activeRoute, routes = courseRoutes, selectRoute, compact = false }) {
  const [stage, setStage] = useState(activeRoute.stage)
  useEffect(() => setStage(activeRoute.stage), [activeRoute.stage])
  const stages = COURSE_STAGE_ORDER.filter((item) => routes.some((route) => route.stage === item))
  const stageRoutes = routes.filter((route) => route.stage === stage)
  const selectedRoute = stageRoutes.some((route) => route.routeId === activeRoute.routeId) ? activeRoute.routeId : stageRoutes[0]?.routeId || activeRoute.routeId

  function changeStage(nextStage) {
    setStage(nextStage)
    const nextRoute = routes.find((route) => route.routeId === activeRoute.routeId && route.stage === nextStage) || routes.find((route) => route.stage === nextStage)
    if (nextRoute && nextRoute.routeId !== activeRoute.routeId) selectRoute(nextRoute.routeId)
  }

  return <div className={`student-route-picker ${compact ? 'student-route-picker--compact' : ''}`}>
    <div className="student-route-picker__stages" role="tablist" aria-label="Choose stage">
      {stages.map((item) => <button type="button" role="tab" aria-selected={stage === item} className={stage === item ? 'active' : ''} key={item} onClick={() => changeStage(item)}>{item}</button>)}
    </div>
    <label>
      <span>{compact ? 'Course' : 'Current course'}</span>
      <select aria-label="Current course" value={selectedRoute} onChange={(event) => selectRoute(event.target.value)}>
        {stageRoutes.map((route) => <option value={route.routeId} key={route.routeId}>{routePickerLabel(route)}</option>)}
      </select>
    </label>
    <small className="student-route-picker__selected">Selected: {activeRoute.stage} {activeRoute.subject} · {activeRoute.subjectCode}</small>
  </div>
}

function SharedAccountBanner({ sharedAccount, onRefreshSharedAccount }) {
  if (sharedAccount.status === 'ready') {
    return <section className="student-account-banner student-account-banner--ready" role="status"><CheckCircle2 size={19} /><div><strong>IELTSist ID connected</strong><span>{sharedAccount.identity?.username || 'Your shared account'} · STEM progress can sync across devices.</span></div><button type="button" className="text-action" onClick={onRefreshSharedAccount}>Refresh session <RefreshCcw size={14} /></button></section>
  }
  return <section className="student-account-banner" role="status"><LogIn size={19} /><div><strong>Save your learning across devices</strong><span>Use one IELTSist ID for IELTS and STEM. Your private notebook stays private from teachers and schools.</span></div><a className="primary-action compact-action" href={sharedAuthUrl('login')}>Log in or create account <ChevronRight size={15} /></a></section>
}

function TopNav({ view, activeTab, setView, profile, sharedAccount, onRefreshSharedAccount, onDisconnectSharedAccount, openNotebook, openRoleWorkspace, openPractice, openPapers }) {
  const [campusOpen, setCampusOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const learnerName = String(profile?.learnerName || 'Student').trim() || 'Student'
  const accountName = sharedAccount.status === 'ready' && sharedAccount.identity?.username ? sharedAccount.identity.username : learnerName
  const firstName = accountName.split(/\s+/)[0]
  return (
    <header className="top-nav unified-top-nav">
      <button className="brand-button" type="button" onClick={() => setView('dashboard')} aria-label="Open dashboard">
        <span className="brand-mark">I</span>
        <span>
          <strong>IELTSist</strong>
          <small>Learning platform</small>
        </span>
      </button>
      <div className="campus-switcher">
        <button type="button" aria-expanded={campusOpen} onClick={() => setCampusOpen((open) => !open)}><span className="campus-switcher__stem">STEM</span><ChevronRight size={15} /></button>
        {campusOpen && <div className="campus-menu" role="menu" aria-label="Switch campus"><a href="https://ieltsist.com/" target="_blank" rel="noreferrer" role="menuitem"><span>IELTS</span><small>Language learning</small></a><button type="button" role="menuitem" onClick={() => { setView('dashboard'); setCampusOpen(false) }}><span>STEM</span><small>Maths and science</small></button></div>}
      </div>
      <nav aria-label="Primary navigation">
        <button className={view === 'dashboard' ? 'active' : ''} type="button" onClick={() => setView('dashboard')}>
          <Target size={17} />
          Today
        </button>
        <button className={view === 'topic' || (view === 'library' && activeTab !== 'papers') ? 'active' : ''} type="button" onClick={openPractice}>
          <Dumbbell size={17} />
          Practice
        </button>
        <button className={view === 'library' && activeTab === 'papers' ? 'active' : ''} type="button" onClick={openPapers}>
          <FileText size={17} />
          Papers
        </button>
        <button className={view === 'history' ? 'active' : ''} type="button" onClick={() => setView('history')}>
          <BarChart3 size={17} />
          Progress
        </button>
        <button className={view === 'notebook' ? 'active' : ''} type="button" onClick={openNotebook} aria-label="Notebook">
          <BookOpen size={17} />
          Notebook
        </button>
      </nav>
      <div className="nav-context"><a className="vocabulary-link" href="https://ieltsist.com/?from=stem&focus=language#vocabulary" target="_blank" rel="noreferrer"><Brain size={15} />Vocabulary</a><button type="button" className="notification-button" aria-label="Notifications"><span /></button><div className="account-menu"><button type="button" className={`account-trigger ${sharedAccount.status !== 'ready' ? 'account-trigger--guest' : ''}`} aria-label={sharedAccount.status === 'ready' ? `Account: ${accountName}` : 'Connect IELTSist account'} title={sharedAccount.status === 'ready' ? `Account: ${accountName}` : 'Connect IELTSist account'} aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}><span className="account-avatar">{firstName.slice(0, 1).toUpperCase()}</span><span>{sharedAccount.status === 'ready' ? accountName : 'Connect account'}</span><ChevronRight size={14} /></button>{accountOpen && <div className="account-popover"><strong>{sharedAccount.status === 'ready' ? accountName : 'IELTSist ID'}</strong><small>{sharedAccount.status === 'ready' ? 'Shared account connected' : 'One account for IELTS + STEM'}</small>{sharedAccount.status !== 'ready' ? <><p className="account-popover__hint">STEM does not create a second password. Continue to IELTSist to log in or register, then return here.</p><a className="account-popover__primary" href={sharedAuthUrl('login')}><LogIn size={15} />Log in to IELTSist <ChevronRight size={14} /></a><a href={sharedAuthUrl('register')}><Users size={15} />Create an IELTSist account <ChevronRight size={14} /></a>{sharedAccount.error && <p className="account-popover__error" role="alert">{sharedAccount.error}</p>}<button type="button" onClick={() => onRefreshSharedAccount()}><RefreshCcw size={15} />Check shared session <ChevronRight size={14} /></button></> : <><div><span>Student</span><b>STEM</b></div><span className="account-popover__privacy">Private notes are visible only to you.</span><a href="https://ieltsist.com/?from=stem#mine" target="_blank" rel="noreferrer">Open IELTSist account <ChevronRight size={14} /></a><button type="button" onClick={() => { openRoleWorkspace(); setAccountOpen(false) }}>Teacher &amp; school workspace <ChevronRight size={14} /></button><button type="button" className="account-popover__logout" onClick={() => { setAccountOpen(false); onDisconnectSharedAccount() }}><LogOut size={15} />Sign out of shared account <ChevronRight size={14} /></button></>}<div className="account-popover__legal"><a href="https://ieltsist.com/terms" target="_blank" rel="noreferrer">Terms</a><a href="https://ieltsist.com/privacy" target="_blank" rel="noreferrer">Privacy</a></div></div>}</div></div>
    </header>
  )
}

/* oxlint-disable no-unused-vars */
function Dashboard({
  profile,
  updateProfile,
  attempts,
  completionByUnit,
  recommendation,
  topicMastery,
  mistakes,
  paperMistakes,
  startPractice,
  setView,
  setActiveTab,
  setSubjectFilter,
  openWorkspace,
  learningProgress,
  syllabusRoadmap,
  allPracticeUnits = [],
}) {
  const unitById = new Map(allPracticeUnits.map((unit) => [unit.id, unit]))
  const verifiedAttempts = attempts.filter((attempt) => {
    const unit = unitById.get(attempt.unitId)
    return Boolean(unit && isScoredAttempt(attempt, unit) && completionByUnit[attempt.unitId]?.completed)
  })
  const completedCount = Object.values(completionByUnit).filter((item) => item.completed).length
  const latest = verifiedAttempts.at(-1)
  const average = verifiedAttempts.length
    ? Math.round(verifiedAttempts.reduce((sum, attempt) => sum + attempt.scoreResult.percentage, 0) / verifiedAttempts.length)
    : null
  const totalImportedFiles = importedPdfLibrary.reduce((sum, subject) => sum + subject.files, 0)
  const nextUnit = recommendation.unit

  function openCourse(subject) {
    setSubjectFilter(subject.id)
    setActiveTab('topics')
    setView('library')
  }

  return (
    <section className="dashboard page-band">
      <section className="today-action-panel" aria-label="Today action">
        <div className="today-action-main"><p className="section-label">Today</p><h2>{nextUnit?.title || 'Choose your first syllabus topic'}</h2><p>{nextUnit ? recommendation.reason : 'Start with a verified Cambridge question set and build your record from there.'}</p><div className="action-row"><button className="primary-action" type="button" onClick={() => nextUnit ? startPractice(nextUnit, recommendation.action === 'Resume' ? { confirmed: true } : {}) : setView('library')}><PlayIcon />{nextUnit ? recommendation.action : 'Choose practice'}</button><span className="today-proof"><CheckCircle2 size={16} />{learningProgress.week.completedQuestions} questions this week</span></div></div>
        <div className="today-action-stats"><div><span>Weekly target</span><strong>{learningProgress.week.completedQuestions}/{learningProgress.week.targetQuestions}</strong><div className="progress-track"><span style={{ width: `${Math.min(100, Math.round((learningProgress.week.completedQuestions / learningProgress.week.targetQuestions) * 100))}%` }} /></div></div><div><span>Study streak</span><strong>{learningProgress.streak} day{learningProgress.streak === 1 ? '' : 's'}</strong><small>Based on submitted work</small></div></div>
      </section>
      <div className="student-intro">
        <div>
          <p className="section-label">STEM practice studio</p>
          <h1>Learn from the paper, not from made-up questions.</h1>
          <p>Choose a course, choose the syllabus point, then work through source-backed questions with a teacher beside you.</p>
        </div>
        <div className="streak-note"><span>Weekly target</span><strong>{Math.min(attempts.length, profile.weeklyQuestions)}/{profile.weeklyQuestions}</strong><small>scored questions</small></div>
      </div>

      <section className="course-launcher" aria-label="Choose a course">
        <div className="section-heading-row"><div><p className="section-label">Start here</p><h2>Choose your qualification</h2></div><span>Each route keeps its own syllabus, stages and paper archive.</span></div>
        <div className="course-launcher__grid">{subjects.map((subject) => <button type="button" key={subject.id} onClick={() => openCourse(subject)}><span className="course-launcher__code" style={{ color: subject.accent }}>{subject.code}</span><span><strong>{subject.name}</strong><small>{subject.topics.slice(0, 3).join(' · ')}</small></span><ChevronRight size={17} /></button>)}</div>
      </section>

      <section className="audience-callout" aria-label="Choose workspace">
        <div><p className="section-label">Student / Teacher / School</p><h2>Use the same evidence at the right level.</h2><p>Students get a next action. Teachers get assignable verified work. Schools get programme-level signals without exposing private notebooks.</p></div>
        <button type="button" className="secondary-action" onClick={openWorkspace}><Users size={17} />Open workspace</button>
      </section>

      <div className="decision-panel student-decision">
        <div className="decision-copy">
          <div className="recommendation-kicker"><Sparkles size={15} /> Continue a verified set</div>
          <h1>{nextUnit?.title || 'Choose a syllabus topic'}</h1>
          <p>{nextUnit ? recommendation.reason : 'Choose a syllabus topic to see its indexed source status and available practice.'}</p>
          {nextUnit && <div className="recommendation-meta"><span>{nextUnit.topic}</span><span>{nextUnit.estimatedMinutes} min</span><span>{nextUnit.maxMarks} marks</span></div>}
          <div className="action-row">
            <button className="primary-action" type="button" onClick={() => nextUnit ? startPractice(nextUnit, recommendation.action === 'Resume' ? { confirmed: true } : {}) : openCourse(subjects[2])}>
              <PlayIcon />
              {nextUnit ? recommendation.action : 'Choose topic'}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setActiveTab('topics')
                setView('library')
              }}
            >
              <ListFilter size={18} />
              Build a session
            </button>
          </div>
        </div>

        <div className="goal-panel" aria-label="Learning goal">
          <div className="goal-title">
            <Target size={18} />
            <span>My exam plan</span>
          </div>
          <p className="goal-helper">A small target keeps practice repeatable.</p>
          <label>
            Target grade
            <select value={profile.targetGrade} onChange={(event) => updateProfile({ targetGrade: event.target.value })}>
              {['A*', 'A', 'B', 'C'].map((grade) => (
                <option key={grade}>{grade}</option>
              ))}
            </select>
          </label>
          <label>
            Weekly questions
            <input
              type="number"
              min="1"
              max="80"
              value={profile.weeklyQuestions}
              onChange={(event) => updateProfile({ weeklyQuestions: Number(event.target.value) || 1 })}
            />
          </label>
          <label>
            Exam date
            <input type="date" value={profile.deadline} onChange={(event) => updateProfile({ deadline: event.target.value })} />
          </label>
        </div>
      </div>

      <div className="practice-modes">
        <div className="section-heading-row"><div><p className="section-label">Choose a mode</p><h2>What do you need today?</h2></div><button type="button" className="text-action" onClick={() => { setActiveTab('topics'); setView('library') }}>View all practice <ChevronRight size={16} /></button></div>
        <div className="mode-grid">
          <ModeCard icon={<Dumbbell size={20} />} title="Knowledge drill" detail="One topic, short set, instant direction" accent="blue" onClick={() => { setActiveTab('topics'); setView('library') }} />
          <ModeCard icon={<TimerReset size={20} />} title="Timed mixed set" detail="Switch between question types under time" accent="green" onClick={() => { setActiveTab('exams'); setView('library') }} />
          <ModeCard icon={<GraduationCap size={20} />} title="Mock exam" detail="Build stamina with a full paper" accent="amber" onClick={() => { setActiveTab('papers'); setView('library') }} />
          <ModeCard icon={<RefreshCcw size={20} />} title="Fix mistakes" detail={`${mistakes.length + paperMistakes.length || 'No'} open item${mistakes.length + paperMistakes.length === 1 ? '' : 's'} to revisit`} accent="rose" onClick={() => { setActiveTab('mistakes'); setView('library') }} />
        </div>
      </div>

      <div className="metric-strip" aria-label="Progress summary">
        <Metric icon={<Trophy size={20} />} label="Current score" value={average == null ? 'No verified score' : `${average}%`} detail="Based only on submitted QP/MS drills" />
        <Metric icon={<CheckCircle2 size={20} />} label="Completed" value={`${completedCount}/${Object.keys(completionByUnit).length}`} detail="Valid submissions only" />
        <Metric icon={<FileText size={20} />} label="Source PDFs" value={totalImportedFiles.toLocaleString()} detail="Official papers available for indexing" />
        <Metric icon={<Flag size={20} />} label="Last attempt" value={latest ? `${latest.scoreResult.rawMarks}/${latest.scoreResult.maxMarks}` : 'No attempt'} detail={latest ? formatDate(latest.submittedAt) : 'Start a topic to create history'} />
      </div>

      <section className="syllabus-roadmap" aria-label="Syllabus roadmap">
        <div className="panel-heading"><div><p className="section-label">Syllabus roadmap</p><h2>See where you are and what comes next</h2></div><button type="button" className="text-action" onClick={() => { setActiveTab('topics'); setView('library') }}>Open roadmap <ChevronRight size={16} /></button></div>
        <div className="roadmap-track">{syllabusRoadmap.slice(0, 12).map((topic, index) => <button type="button" key={topic.id} className={`roadmap-node roadmap-${topic.status.toLowerCase().replaceAll(' ', '-')}`} onClick={() => { setSubjectFilter(topic.subjectId === 'physics-9702' ? 'physics' : undefined); setActiveTab('topics'); setView('library') }}><span>{topic.officialTopicNumber || index + 1}</span><strong>{topic.name.replace(/^\d+\s+/, '')}</strong><small>{topic.mastery == null ? topic.status : `${topic.mastery}% mastery`}</small></button>)}</div>
      </section>

      <div className="student-progress-grid">
        <section className="wide-panel weekly-task-panel"><div className="panel-heading"><div><p className="section-label">This week</p><h2>Small tasks, visible progress</h2></div><span className="progress-label">{learningProgress.week.completedSets} set{learningProgress.week.completedSets === 1 ? '' : 's'} submitted</span></div><div className="weekly-task-row"><CheckCircle2 size={18} /><div><strong>Complete {learningProgress.week.targetQuestions} questions</strong><span>{learningProgress.week.completedQuestions} completed from verified attempts</span></div><b>{Math.min(100, Math.round((learningProgress.week.completedQuestions / learningProgress.week.targetQuestions) * 100))}%</b></div><div className="weekly-task-row"><RefreshCcw size={18} /><div><strong>Correct your open mistakes</strong><span>{mistakes.length + paperMistakes.length} question{mistakes.length + paperMistakes.length === 1 ? '' : 's'} ready to revisit</span></div><b>{mistakes.length + paperMistakes.length ? 'Next' : 'Clear'}</b></div></section>
        <section className="wide-panel milestone-panel"><div className="panel-heading"><div><p className="section-label">Milestones</p><h2>Evidence, not points</h2></div><Trophy size={19} /></div><div className="milestone-list">{learningProgress.milestones.slice(0, 3).map((milestone) => <div className="milestone-row" key={milestone.id}><span className={milestone.complete ? 'milestone-dot complete' : 'milestone-dot'}>{milestone.complete ? '✓' : ''}</span><div><strong>{milestone.label}</strong><small>{Math.min(milestone.value, milestone.target)}/{milestone.target} {milestone.unit}</small></div><div className="mini-progress"><i style={{ width: `${milestone.percentage}%` }} /></div></div>)}</div></section>
      </div>

      <div className="dashboard-grid">
        <section className="wide-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Topic progress</p>
              <h2>Where your marks are coming from</h2>
            </div>
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setActiveTab('mistakes')
                setView('library')
              }}
            >
              See weak points
            </button>
          </div>
                <div className="radar-list">
            {topicMastery.map((item) => (
              <div className="radar-row" key={item.id}>
                <span className="topic-icon">{item.icon}</span>
                <span>{item.topic}</span>
                <div className="progress-track" aria-label={`${item.topic} mastery`}>
                  <span style={{ width: `${item.score ?? 18}%` }} />
                </div>
                <strong>{item.score == null ? 'No verified score' : `${item.score}%`}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="source-panel">
          <div className="panel-heading compact">
            <div>
              <p className="section-label">Learning signal</p>
              <h2>Recent feedback</h2>
            </div>
          </div>
          {mistakes.length ? <div className="feedback-list">{mistakes.slice(0, 3).map((mistake) => <div className="feedback-row" key={mistake.id}><span className="feedback-icon"><Flag size={15} /></span><div><strong>{displayPartLabel(mistake.part)} · {mistake.unit.topic}</strong><small>{mistake.criterion.feedback}</small></div><ChevronRight size={16} /></div>)}</div> : <div className="feedback-empty"><CheckCircle2 size={22} /><strong>No weak points yet</strong><span>Submit a set and your mark points will appear here.</span></div>}
        </section>
      </div>

      <section className="study-principle"><div className="principle-icon"><Sparkles size={18} /></div><div><strong>Feedback is the lesson.</strong><p>Every answer is stored with its working. After submission, review the exact mark point you missed and retest the same idea with a new attempt.</p></div></section>
    </section>
  )
}

/* oxlint-enable no-unused-vars */
function StudentDashboard({ activeRoute, routeOptions, selectRoute, profile, attempts, completionByUnit, recommendation, topicMastery, mistakes, paperMistakes, startPractice, setView, setActiveTab, setSubjectFilter, setQuery, allPracticeUnits, recentPractice, favoriteUnitIds, openNotebook, learningProgress, syllabusRoadmap, sharedAccount, onRefreshSharedAccount }) {
  const nextUnit = recommendation.unit
  const unitById = new Map(allPracticeUnits.map((unit) => [unit.id, unit]))
  const scoredAttempts = attempts.filter((attempt) => {
    const unit = unitById.get(attempt.unitId)
    return Boolean(unit && isScoredAttempt(attempt, unit) && completionByUnit[attempt.unitId]?.completed)
  })
  const latest = scoredAttempts.at(-1)
  const average = scoredAttempts.length ? Math.round(scoredAttempts.reduce((total, attempt) => total + attempt.scoreResult.percentage, 0) / scoredAttempts.length) : null
  const weeklyPercent = Math.min(100, Math.round((learningProgress.week.completedQuestions / learningProgress.week.targetQuestions) * 100))
  const goalComplete = learningProgress.week.completedQuestions >= learningProgress.week.targetQuestions
  const recentUnits = recentPractice.map((item) => unitById.get(item.unitId)).filter((unit) => unit?.routeId === activeRoute.routeId).slice(0, 3)
  const favoriteUnits = favoriteUnitIds.map((id) => unitById.get(id)).filter((unit) => unit?.routeId === activeRoute.routeId).slice(0, 3)
  const firstName = String(profile.learnerName || '').trim().split(/\s+/)[0]
  const weakTopic = topicMastery.find((item) => item.score != null && item.score < 65)
  const routeLabel = `${activeRoute.stage} ${activeRoute.subject}`
  const recommendedTopic = String(nextUnit?.topic || nextUnit?.title || 'Choose your first topic').replace(/^\d+\s+/, '')
  const recommendedQuestionCount = nextUnit?.parts?.length || 0
  const weakRoadmapTopic = [...syllabusRoadmap]
    .filter((topic) => topic.mastery != null)
    .sort((a, b) => a.mastery - b.mastery)[0]
  const weakAreaName = weakRoadmapTopic?.name?.replace(/^\d+\s+/, '') || weakTopic?.topic || 'Your first completed topic'
  const weakAreaMastery = weakRoadmapTopic?.mastery ?? weakTopic?.score ?? null

  function openPractice({ tab = 'topics', subjectId, query } = {}) {
    if (subjectId) setSubjectFilter(subjectId)
    if (query != null) setQuery(query)
    setActiveTab(tab)
    setView('library')
  }

  function takeGoalNextStep() {
    if (goalComplete && (mistakes.length || paperMistakes.length)) {
      openNotebook()
      return
    }
    if (nextUnit) {
      startPractice(nextUnit, recommendation.action === 'Resume' ? { confirmed: true } : {})
      return
    }
    openPractice({ subjectId: activeRoute.subjectId })
  }

  return <section className="student-home-guided">
    <main className="student-home-guided__main">
      <header className="student-home-header">
        <div><p>{firstName ? `Hi, ${firstName}.` : 'Your study plan'}</p><h1>Start here today.</h1><span>One focused session for the course you are studying now.</span></div>
        <StudentRoutePicker activeRoute={activeRoute} routes={routeOptions} selectRoute={selectRoute} />
      </header>
      <SharedAccountBanner sharedAccount={sharedAccount} onRefreshSharedAccount={onRefreshSharedAccount} />

      <section className="recommended-session" aria-label="Recommended session">
        <div className="recommended-session__copy">
          <p className="recommended-session__eyebrow"><Sparkles size={16} />Continue learning</p>
          <h2>{routeLabel} · {recommendedTopic}</h2>
          <div className="recommended-session__meta">
            {recommendedQuestionCount > 0 && <span>{recommendedQuestionCount} question{recommendedQuestionCount === 1 ? '' : 's'}</span>}
            {nextUnit?.estimatedMinutes && <span>About {nextUnit.estimatedMinutes} minutes</span>}
            {nextUnit?.maxMarks && <span>{nextUnit.maxMarks} marks</span>}
          </div>
          <div className="recommended-session__actions">
            <button className="primary-action student-primary-start" type="button" onClick={() => nextUnit ? startPractice(nextUnit, recommendation.action === 'Resume' ? { confirmed: true } : {}) : openPractice({ subjectId: activeRoute.subjectId })}><PlayIcon />{nextUnit ? (recommendation.action === 'Resume' ? 'Resume practice' : 'Start this practice') : 'Choose a topic'}</button>
            <button type="button" className="secondary-action" onClick={() => openPractice({ subjectId: nextUnit?.subjectId || activeRoute.subjectId })}>Choose another topic</button>
          </div>
        </div>
        <div className="recommended-session__course" aria-label="Selected course">
          <span>{activeRoute.stage}</span>
          <strong>{activeRoute.subject}</strong>
          <small>Cambridge {activeRoute.subjectCode.toUpperCase()}</small>
        </div>
      </section>

      <div className="today-focus-grid">
        <section className="today-focus-panel today-focus-panel--weak" aria-labelledby="weak-area-title">
          <div className="today-focus-panel__icon"><Target size={20} /></div>
          <div className="today-focus-panel__body">
            <p className="section-label">Weak area</p>
            <h2 id="weak-area-title">{weakAreaName}</h2>
            <p>{weakAreaMastery == null ? 'Complete a short set and STEM will identify the first concept to revisit.' : `${weakAreaMastery}% mastery. This is the clearest place to gain marks next.`}</p>
          </div>
          <button type="button" className="text-action" onClick={() => openPractice({ query: weakRoadmapTopic?.name || weakTopic?.topic || '' })}>{weakAreaMastery == null ? 'Choose a topic' : 'Practise this'}<ChevronRight size={15} /></button>
        </section>

        <section className="today-focus-panel today-focus-panel--plan" aria-labelledby="today-plan-title">
          <div className="today-focus-panel__body">
            <p className="section-label">Today's plan</p>
            <h2 id="today-plan-title">One focused learning loop</h2>
            <ol>
              <li><span>1</span><div><strong>Attempt</strong><small>{recommendedQuestionCount || 'A short set'} verified questions</small></div></li>
              <li><span>2</span><div><strong>Review</strong><small>See exact mark points and an explanation</small></div></li>
              <li><span>3</span><div><strong>Retry</strong><small>Correct one weak idea while it is fresh</small></div></li>
            </ol>
          </div>
        </section>
      </div>

      <section className="study-paths" aria-labelledby="study-paths-title">
        <div><p className="section-label">Quick actions</p><h2 id="study-paths-title">Choose another study mode</h2></div>
        <div className="study-paths__grid">
          <StudyAction icon={<Target size={20} />} tone="green" title="Topic practice" detail="Choose one part of the syllabus" action="Pick a topic" onClick={() => openPractice()} />
          <StudyAction icon={<FileText size={20} />} tone="blue" title="Past papers" detail="Choose a paper and exam session" action="Browse papers" onClick={() => openPractice({ tab: 'papers' })} />
          <StudyAction icon={<RefreshCcw size={20} />} tone="amber" title="Fix mistakes" detail={mistakes.length + paperMistakes.length ? `${mistakes.length + paperMistakes.length} question${mistakes.length + paperMistakes.length === 1 ? '' : 's'} ready to review` : 'Review missed questions after submitting'} action={mistakes.length + paperMistakes.length ? 'Review now' : 'Open notebook'} onClick={openNotebook} />
        </div>
      </section>

      <section className="week-progress-strip" aria-label="Weekly progress">
        <div><p className="section-label">This week</p><h2>{goalComplete ? 'Weekly goal complete' : `${Math.max(0, learningProgress.week.targetQuestions - learningProgress.week.completedQuestions)} questions to reach your goal`}</h2><span>{learningProgress.streak ? `${learningProgress.streak}-day study streak` : 'Your study streak starts with the next question.'}</span></div>
        <div className="week-progress-strip__progress"><strong>{Math.min(learningProgress.week.completedQuestions, learningProgress.week.targetQuestions)} / {learningProgress.week.targetQuestions}</strong><div className="progress-track"><span style={{ width: `${weeklyPercent}%` }} /></div></div>
        <button type="button" className="text-action" onClick={takeGoalNextStep}>{goalComplete && (mistakes.length + paperMistakes.length) ? 'Review mistakes' : 'Continue'}<ChevronRight size={15} /></button>
      </section>

      {(recentUnits.length > 0 || favoriteUnits.length > 0) && <div className="dashboard-feed-grid">
        {recentUnits.length > 0 && <MiniUnitPanel eyebrow="Recent practice" title="Pick up where you left off" empty="" units={recentUnits} icon={<Dumbbell size={19} />} openPractice={startPractice} onManage={() => openPractice()} />}
        {favoriteUnits.length > 0 && <MiniUnitPanel eyebrow="Saved for later" title="Favourite practice" empty="" units={favoriteUnits} icon={<Heart size={19} />} openPractice={startPractice} onManage={() => openPractice({ tab: 'saved' })} favorite />}
      </div>}
      <div className="dashboard-lower-grid"><section className="dashboard-panel performance-panel"><header><div><p className="section-label">Your performance</p><h2>Evidence from submitted work</h2></div><button type="button" className="text-action" onClick={() => setView('history')}>View progress <ChevronRight size={15} /></button></header><div className="performance-stats"><Stat label="Accuracy" value={average == null ? 'Not scored' : `${average}%`} detail={average == null ? 'Submit a set to start' : 'Submitted practice'} /><Stat label="Questions done" value={learningProgress.week.completedQuestions} detail="In the last 7 days" /><Stat label="Open mistakes" value={mistakes.length + paperMistakes.length} detail={weakTopic ? `${weakTopic.topic} needs attention` : 'Review after each result'} /><Stat label="Last attempt" value={latest ? `${latest.scoreResult.rawMarks}/${latest.scoreResult.maxMarks}` : 'Not started'} detail={latest ? formatDate(latest.submittedAt) : 'No submission yet'} /></div></section><section className="dashboard-panel mistakes-panel"><header><div><p className="section-label">Recent mistakes</p><h2>What to revisit</h2></div><button type="button" className="text-action" onClick={openNotebook}>Open notebook</button></header>{mistakes.length ? <div className="mistakes-compact">{mistakes.slice(0, 3).map((mistake) => <button type="button" key={mistake.id} onClick={() => startPractice(mistake.unit, { clearDraft: true, retestOf: mistake.attempt.id, onlyPartId: mistake.part.id })}><span>{mistake.unit.topic}</span><strong>{mistake.part.label}</strong><em>{mistake.criterion.maxMarks - mistake.criterion.awarded} mark{mistake.criterion.maxMarks - mistake.criterion.awarded === 1 ? '' : 's'}</em></button>)}</div> : <div className="compact-empty"><CheckCircle2 size={19} /><span>No weak points yet. Your next submitted set will create a focused review list.</span></div>}</section></div>
      <section className="dashboard-panel roadmap-compact"><header><div><p className="section-label">Skill map</p><h2>Progress through the official syllabus</h2></div><button type="button" className="text-action" onClick={() => openPractice()}>Open all topics <ChevronRight size={15} /></button></header><div>{syllabusRoadmap.slice(0, 6).map((topic, index) => <button type="button" key={topic.id} onClick={() => openPractice({ subjectId: topic.subjectId === 'physics-9702' ? 'physics' : undefined })}><span>{topic.officialTopicNumber || index + 1}</span><strong>{topic.name.replace(/^\d+\s+/, '')}</strong><small>{topic.mastery == null ? 'Not started' : `${topic.mastery}% mastery`}</small><i><b style={{ width: `${topic.mastery || 0}%` }} /></i></button>)}</div></section>
    </main>
  </section>
}

function StudyAction({ icon, tone, title, detail, action, onClick }) {
  return <button type="button" onClick={onClick}><span className={`action-icon ${tone}`}>{icon}</span><strong>{title}</strong><small>{detail}</small><em>{action} <ChevronRight size={15} /></em></button>
}

function Stat({ label, value, detail }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function MiniUnitPanel({ eyebrow, title, empty, units, icon, openPractice, onManage, favorite = false }) {
  return <section className="dashboard-panel recent-panel"><header><div><p className="section-label">{eyebrow}</p><h2>{title}</h2></div><button type="button" className="text-action" onClick={onManage}>Library <ChevronRight size={15} /></button></header>{units.length ? <div className="mini-unit-list">{units.map((unit) => <button type="button" key={unit.id} onClick={() => openPractice(unit)}><span>{favorite ? <Heart size={16} fill="currentColor" /> : unit.code || subjects.find((subject) => subject.id === unit.subjectId)?.code}</span><div><strong>{unit.title}</strong><small>{unit.topic} · {unit.estimatedMinutes} min</small></div><ChevronRight size={16} /></button>)}</div> : <div className="compact-empty">{icon}<span>{empty}</span></div>}</section>
}

function PlayIcon() {
  return <Play className="play-icon" size={16} fill="currentColor" aria-hidden="true" />
}

function ModeCard({ icon, title, detail, accent, onClick }) {
  return <button type="button" className={`mode-card mode-${accent}`} onClick={onClick}><span className="mode-icon">{icon}</span><span className="mode-copy"><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} /></button>
}

function Metric({ icon, label, value, detail }) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function LibraryView({
  activeRoute,
  activeRouteId,
  selectRoute,
  activeTab,
  setActiveTab,
  query,
  onTopicQueryChange,
  visibleUnits,
  completionByUnit,
  favoriteUnitIds,
  onToggleFavorite,
  mistakes,
  paperMistakes,
  startPractice,
  retestPaper,
  paperCatalogState,
  openPaper,
  recommendation,
  onOpenTopic,
  onOpenCoach,
}) {
  const incomingContext = getIncomingProductContext()
  const contextSubject = subjects.find((subject) => subject.id === incomingContext.subjectId)
  const practiceTopics = coachPracticeOptions().find((option) => option.routeId === activeRouteId)?.topics || []
  const selectedTopic = practiceTopics.some((topic) => topic.label === query) ? query : ''
  return (
    <section className="practice-hub page-band">
      <header className="practice-hub__header">
        <div>
          <p className="section-label">Practice</p>
          <h1>Choose how you want to improve.</h1>
          <p className="practice-hub__intro">{activeRoute.stage === 'Competition' ? 'Start with a recommendation, focus on one competition topic, or work through a historical paper.' : activeRoute.stage === 'Admissions' ? 'Start with a recommendation, focus on one test module, or work through official preparation papers.' : 'Start with a recommendation, focus on one syllabus topic, or work through a Cambridge paper.'}</p>
        </div>
        <div className="practice-hub__controls">
          <StudentRoutePicker activeRoute={activeRoute} routes={courseRoutes} selectRoute={selectRoute} compact />
          <label className="practice-topic-filter"><span>Topic focus</span><select aria-label="Topic focus" value={selectedTopic} onChange={(event) => onTopicQueryChange(event.target.value)}><option value="">All topics in this route</option>{practiceTopics.map((topic) => <option value={topic.label} key={topic.id}>{topic.label.replace(/^\d+\s+/, '')}</option>)}</select></label>
        </div>
      </header>

      <nav className="practice-modes" aria-label="Practice modes">
        <button className={activeTab === 'recommended' ? 'active' : ''} type="button" onClick={() => setActiveTab('recommended')}><Target size={17} />Recommended</button>
        <button type="button" onClick={onOpenCoach}><Sparkles size={17} />AI Practice</button>
        <button className={activeTab === 'topics' ? 'active' : ''} type="button" onClick={() => setActiveTab('topics')}><Dumbbell size={17} />Topic Drill</button>
        <button className={activeTab === 'papers' ? 'active' : ''} type="button" onClick={() => setActiveTab('papers')}><FileText size={17} />Past Papers</button>
        <button className={activeTab === 'exams' ? 'active' : ''} type="button" onClick={() => setActiveTab('exams')}><GraduationCap size={17} />Exam Simulation</button>
        <button className={activeTab === 'mistakes' ? 'active' : ''} type="button" onClick={() => setActiveTab('mistakes')}><RefreshCcw size={17} />Mistakes</button>
        <button className={activeTab === 'saved' ? 'active' : ''} type="button" onClick={() => setActiveTab('saved')}><Heart size={17} />Saved</button>
      </nav>

      {incomingContext.from === 'ieltsist' && <div className="product-bridge-band" role="status"><span className="product-bridge-icon"><Brain size={17} /></span><div><strong>From IELTS-ist Vocabulary</strong><p>{contextSubject ? `You are ready to practise ${contextSubject.name} concepts.` : 'Use IELTS-ist for language support, then practise the subject here.'}</p></div><a href="https://ieltsist.com/?from=stem&focus=language#vocabulary" target="_blank" rel="noreferrer">Open IELTS Vocabulary <ChevronRight size={15} /></a></div>}

      {activeTab === 'recommended' && <PracticeOverview recommendation={recommendation} visibleUnits={visibleUnits} completionByUnit={completionByUnit} mistakes={mistakes} paperMistakes={paperMistakes} startPractice={startPractice} onOpenTopic={onOpenTopic} onOpenCoach={onOpenCoach} onOpenPapers={() => setActiveTab('papers')} />}
      {activeTab === 'papers' && <PaperLibrary catalogState={paperCatalogState} initialSubject={activeRoute.subjectCode} activeRoute={activeRoute} onOpenPaper={openPaper} />}

      {activeTab === 'exams' && <PaperLibrary catalogState={paperCatalogState} initialSubject={activeRoute.subjectCode} activeRoute={activeRoute} onOpenPaper={openPaper} />}

      {activeTab === 'topics' && <PracticeTopicDirectory activeRoute={activeRoute} activeRouteId={activeRouteId} practiceOptions={coachPracticeOptions()} visibleUnits={visibleUnits} completionByUnit={completionByUnit} query={query} onOpenTopic={onOpenTopic} />}

      {activeTab === 'mistakes' ? (
        <MistakeList mistakes={mistakes} paperMistakes={paperMistakes} startPractice={startPractice} retestPaper={retestPaper} />
      ) : activeTab === 'papers' || activeTab === 'exams' || activeTab === 'recommended' || activeTab === 'topics' ? null : (activeTab === 'saved' ? visibleUnits.filter((unit) => favoriteUnitIds.includes(unit.id)) : visibleUnits).length ? (
        <div className="unit-grid">
          {(activeTab === 'saved' ? visibleUnits.filter((unit) => favoriteUnitIds.includes(unit.id)) : visibleUnits).map((unit) => (
            <UnitCard key={unit.id} unit={unit} completion={completionByUnit[unit.id]} startPractice={startPractice} favorite={favoriteUnitIds.includes(unit.id)} onToggleFavorite={onToggleFavorite} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Brain size={28} />
          <h2>{activeTab === 'saved' ? 'No saved practice yet' : 'No items match these filters'}</h2>
          <p>{activeTab === 'saved' ? 'Use the heart on any practice card to keep it ready for later.' : 'Clear filters or switch subject to rebuild the practice queue.'}</p>
        </div>
      )}
    </section>
  )
}

function topicMetadata(topicId) {
  const baseId = String(topicId || '').split('@')[0]
  return learningPlan.knowledgeGroups.find((group) => group.id === baseId)
}

function topicMasteryFromUnits(topicId, units, completionByUnit) {
  const scores = units
    .filter((unit) => unit.knowledgeGroupId === topicId || String(unit.knowledgeGroupId || '').split('@')[0] === String(topicId || '').split('@')[0])
    .map((unit) => completionByUnit[unit.id]?.best?.percentage)
    .filter((score) => Number.isFinite(score))
  return scores.length ? Math.max(...scores) : null
}

function masteryLabel(mastery) {
  if (mastery == null) return 'Not started'
  if (mastery >= 80) return 'Strong'
  if (mastery >= 60) return 'Developing'
  return 'Weak'
}

function baseTopicId(topicId) {
  return String(topicId || '').split('@')[0]
}

function topicQuestionMatches(question, routeId, topicId) {
  const requestedTopic = baseTopicId(topicId)
  const questionTopic = baseTopicId(question.knowledgeGroupId || question.topicId)
  return question.routeId === routeId && questionTopic === requestedTopic
}

function sourceQuestionPreview(question) {
  return stripSourceVisualPlaceholders(question.prompt || question.parts?.[0]?.promptFragment || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sourcePaperLabel(question) {
  const source = question.sourceRef || {}
  const season = source.season ? `${source.season} ` : ''
  return `${season}${source.year || ''} · ${source.paper || 'Verified question paper'}`.trim()
}

function PracticeOverview({ recommendation, visibleUnits, completionByUnit, mistakes, paperMistakes, startPractice, onOpenTopic, onOpenCoach, onOpenPapers }) {
  const nextUnit = recommendation?.unit
  const completedCount = visibleUnits.filter((unit) => completionByUnit[unit.id]?.completed).length
  const openMistakes = mistakes.length + paperMistakes.length
  const topicId = nextUnit?.knowledgeGroupId

  return (
    <div className="practice-overview">
      <section className="practice-overview__primary">
        <div>
          <p className="section-label">Recommended next</p>
          <h2>{nextUnit?.title || 'Choose your first syllabus topic'}</h2>
          <p>{nextUnit ? recommendation.reason : 'Build a short route-specific set from verified past-paper questions.'}</p>
          {nextUnit && <div className="practice-overview__meta"><span>{nextUnit.parts.length} questions</span><span>{nextUnit.estimatedMinutes} min</span><span>{nextUnit.maxMarks} marks</span></div>}
        </div>
        <button type="button" className="primary-action" onClick={() => nextUnit ? startPractice(nextUnit, recommendation.action === 'Resume' ? { confirmed: true } : {}) : onOpenTopic(visibleUnits[0]?.knowledgeGroupId)} disabled={!nextUnit && !visibleUnits.length}><PlayIcon />{nextUnit ? (recommendation.action === 'Resume' ? 'Resume practice' : 'Start practice') : 'Choose a topic'}</button>
      </section>

      <section className="practice-overview__choices" aria-label="Practice choices">
        <button type="button" onClick={() => topicId && onOpenTopic(topicId)} disabled={!topicId}><Target size={20} /><span><strong>Focus on this topic</strong><small>{nextUnit?.topic || 'Select from the syllabus'}</small></span><ChevronRight size={17} /></button>
        <button type="button" onClick={onOpenCoach}><Sparkles size={20} /><span><strong>Ask AI Tutor to build a set</strong><small>Describe the concept or skill you need</small></span><ChevronRight size={17} /></button>
        <button type="button" onClick={onOpenPapers}><FileText size={20} /><span><strong>Take a past paper</strong><small>Full official paper in exam conditions</small></span><ChevronRight size={17} /></button>
      </section>

      <div className="practice-overview__status"><span><strong>{completedCount}</strong> topics practised</span><span><strong>{openMistakes}</strong> open mistakes</span><span><strong>{visibleUnits.length}</strong> verified sets in this route</span></div>
    </div>
  )
}

function PracticeTopicDirectory({ activeRoute, activeRouteId, practiceOptions, visibleUnits, completionByUnit, query, onOpenTopic }) {
  const routeOption = practiceOptions.find((option) => option.routeId === activeRouteId)
  const normalizedQuery = query.trim().toLowerCase()
  const topics = (routeOption?.topics || []).filter((topic) => {
    const metadata = topicMetadata(topic.id)
    return !normalizedQuery || [topic.label, metadata?.description, ...(metadata?.themes || [])].join(' ').toLowerCase().includes(normalizedQuery)
  })

  return (
    <section className="topic-directory">
      <header><div><p className="section-label">Official syllabus</p><h2>{activeRoute.stage} {activeRoute.subject}</h2><p>Choose one topic. Every set stays inside this course and remains linked to its original paper and mark scheme.</p></div><a href={activeRoute.syllabus.url} target="_blank" rel="noreferrer">View syllabus <ChevronRight size={15} /></a></header>
      {topics.length ? <div className="topic-directory__list">{topics.map((topic, index) => {
        const metadata = topicMetadata(topic.id)
        const mastery = topicMasteryFromUnits(topic.id, visibleUnits, completionByUnit)
        const available = topic.inventory || 0
        return <button type="button" className="topic-directory__row" key={topic.id} onClick={() => onOpenTopic(topic.id)}>
          <span className="topic-directory__number">{metadata?.officialTopicNumber || String(index + 1).padStart(2, '0')}</span>
          <span className="topic-directory__copy"><strong>{topic.label.replace(/^\d+\s+/, '')}</strong><small>{metadata?.description || `${activeRoute.stage} ${activeRoute.subject} syllabus topic`}</small></span>
          <span className={`topic-directory__mastery mastery-${masteryLabel(mastery).toLowerCase().replace(' ', '-')}`}><strong>{mastery == null ? '--' : `${mastery}%`}</strong><small>{masteryLabel(mastery)}</small></span>
          <span className="topic-directory__available">{available} verified question{available === 1 ? '' : 's'}</span>
          <ChevronRight size={18} />
        </button>
      })}</div> : <div className="empty-state"><Search size={28} /><h2>No syllabus topic matches</h2><p>Try a shorter topic or concept name.</p></div>}
    </section>
  )
}

function TopicDetail({ activeRoute, activeRouteId, topicId, practiceOptions, learningProgress, mistakes, practiceUnits, completionByUnit, startPractice, startKnowledgeDrill, onBack, onOpenCoach }) {
  const [startError, setStartError] = useState('')
  const routeOption = practiceOptions.find((option) => option.routeId === activeRouteId)
  const topic = routeOption?.topics.find((item) => item.id === topicId)
  const metadata = topicMetadata(topicId)
  const progress = learningProgress.topicProgress.find((item) => item.id === topicId || String(item.id || '').split('@')[0] === String(topicId).split('@')[0])
  const mastery = progress?.mastery ?? null
  const available = topic?.inventory || 0
  const questionCount = Math.min(10, available)
  const practiceReady = available >= MIN_VERIFIED_GROUPS_FOR_PRACTICE
  const topicPracticeUnits = practiceUnits
    .filter((unit) => unit.knowledgeGroupId === topicId)
    .toSorted((left, right) => (left.sourceSetIndex || 0) - (right.sourceSetIndex || 0))
  const markingCapabilityCounts = topicPracticeUnits.reduce((counts, unit) => {
    for (const part of unit.parts || []) {
      counts.practice += 1
      if (part.aiAssistedMarkingAvailable || part.reviewStatus === 'reviewed') counts.aiAssisted += 1
      else if (part.deterministicScoringAvailable || part.answerKey) counts.deterministic += 1
      else counts.selfMark += 1
    }
    return counts
  }, { practice: 0, deterministic: 0, aiAssisted: 0, selfMark: 0 })
  const nextPracticeUnit = topicPracticeUnits.find((unit) => !completionByUnit[unit.id]?.completed) || topicPracticeUnits[0]
  const topicMistakes = mistakes.filter((mistake) => mistake.unit.knowledgeGroupId === topicId).length
  const topicQuestions = verifiedPracticeQuestionGroups
    .filter((question) => topicQuestionMatches(question, activeRouteId, topicId))
    .toSorted((left, right) => (
      (Number(right.sourceRef?.year) || 0) - (Number(left.sourceRef?.year) || 0)
      || String(left.sourceRef?.season || '').localeCompare(String(right.sourceRef?.season || ''))
      || String(left.sourceRef?.paper || '').localeCompare(String(right.sourceRef?.paper || ''))
      || String(left.sourceRef?.question || '').localeCompare(String(right.sourceRef?.question || ''), undefined, { numeric: true })
    ))
  const topicPaperGroups = [...topicQuestions.reduce((groups, question) => {
    const key = question.sourceRef?.paperId || question.sourceRef?.paper || question.bankId
    const current = groups.get(key) || []
    current.push(question)
    groups.set(key, current)
    return groups
  }, new Map()).values()]
  const chapterItems = (metadata?.themes?.length ? metadata.themes : ['Core method selection', 'Complete working', 'Accuracy and checking']).map((theme, index) => {
    const normalizedTheme = theme.toLowerCase()
    const count = topicQuestions.filter((question) => (question.topicTags || []).some((tag) => String(tag).toLowerCase().includes(normalizedTheme) || normalizedTheme.includes(String(tag).toLowerCase()))).length
    return { theme, index, count }
  })
  const checkpoints = metadata?.mastery?.stageIds?.map((stageId) => ({
    id: stageId,
    label: stageId === 'exam-ready' ? 'Exam ready' : stageId.charAt(0).toUpperCase() + stageId.slice(1),
    description: metadata.mastery.checkpoints[stageId],
  })) || []

  function startTopicPractice() {
    try {
      setStartError('')
      if (!available) {
        throw new Error('This topic has no verified source question yet. Source indexing is still in progress.')
      }
      if (nextPracticeUnit) startPractice(nextPracticeUnit)
      else startKnowledgeDrill({ routeId: activeRouteId, knowledgeGroupId: topicId, questionCount: Math.max(10, questionCount), allowPartial: true })
    } catch (error) {
      setStartError(error.message || 'This topic is still being indexed.')
    }
  }

  if (!topic) return <section className="topic-detail page-band"><button type="button" className="topic-detail__back" onClick={onBack}><ArrowLeft size={17} />Back to topics</button><div className="empty-state"><AlertTriangle size={28} /><h2>This topic is not available for the selected course</h2><p>Return to the route-specific syllabus list.</p></div></section>

  return (
    <section className="topic-detail page-band">
      <button type="button" className="topic-detail__back" onClick={onBack}><ArrowLeft size={17} />Back to {activeRoute.stage} {activeRoute.subject}</button>
      <header className="topic-detail__header">
        <div><p className="section-label">{activeRoute.stage} {activeRoute.subject} · syllabus topic</p><h1>{topic.label.replace(/^\d+\s+/, '')}</h1><p>{metadata?.description || `Practise this ${activeRoute.stage} topic using verified source questions.`}</p></div>
        <div className="topic-detail__mastery"><span>Mastery</span><strong>{mastery == null ? '--' : `${mastery}%`}</strong><small>{masteryLabel(mastery)}</small></div>
      </header>

      <div className="topic-detail__layout">
        <main>
          <section className="topic-detail__concepts"><header><div><p className="section-label">Topic content</p><h2>Chapters inside this topic</h2><p>Each chapter is a syllabus skill cluster. The question bank stays separate, then links real exam questions back to the right chapter.</p></div></header><div>{chapterItems.map(({ theme, index, count }) => <div key={theme}><span>{String(index + 1).padStart(2, '0')}</span><strong>{theme}</strong><small>{count ? `${count} linked question${count === 1 ? '' : 's'}` : 'No indexed source question yet'}</small></div>)}</div></section>
          {checkpoints.length > 0 && <section className="topic-detail__checkpoints"><header><div><p className="section-label">Progression</p><h2>What good looks like</h2></div><span>Move from recall to exam application</span></header><div>{checkpoints.map((checkpoint) => <article key={checkpoint.id}><strong>{checkpoint.label}</strong><p>{checkpoint.description}</p></article>)}</div></section>}
          <section className="topic-detail__past-papers"><header><div><p className="section-label">Real exam collection</p><h2>Past-paper questions by chapter</h2><p>These are question-level records, grouped by their original paper. Open the source page or mark scheme without losing the topic mapping.</p></div><strong>{topicQuestions.length} questions · {topicPaperGroups.length} paper{topicPaperGroups.length === 1 ? '' : 's'}</strong></header>{topicPaperGroups.length ? <div className="topic-detail__paper-groups">{topicPaperGroups.map((paperQuestions) => { const first = paperQuestions[0]; const source = first.sourceRef || {}; return <article className="topic-detail__paper-group" key={source.paperId || source.paper}><header><div><strong>{sourcePaperLabel(first)}</strong><span>{source.component ? `Component ${source.component}` : 'Official source'} · {paperQuestions.length} linked question{paperQuestions.length === 1 ? '' : 's'}</span></div><div><a href={`${source.localUrl}#page=${source.pageStart || 1}`} target="_blank" rel="noreferrer">Open QP</a><a href={`${first.answerRef?.localUrl || '#'}#page=${first.answerRef?.pageStart || 1}`} target="_blank" rel="noreferrer">Open MS</a></div></header><div>{paperQuestions.map((question) => <div className="topic-detail__question-row" key={question.questionGroupId || question.bankId}><span>{question.sourceRef?.question || 'Question'}</span><p>{sourceQuestionPreview(question) || 'Indexed question text is available in the source paper.'}</p><small>{question.totalMarks || question.marks || 1} mark{(question.totalMarks || question.marks || 1) === 1 ? '' : 's'} · QP p.{question.sourceRef?.pageStart || '?'} · MS p.{question.answerRef?.pageStart || '?'}</small></div>)}</div></article> })}</div> : <div className="topic-detail__empty-source"><FileText size={20} /><strong>No question-level source records yet</strong><p>This topic is in the syllabus map, but its verified paper index has not been attached to this route.</p></div>}</section>
          <section className="topic-detail__source"><FileText size={20} /><div><strong>Verified source questions</strong><p>Questions and answers stay paired with their original paper. No cross-stage items and no unverified generated questions.</p></div><span>{available} available{practiceReady ? '' : ` · ${MIN_VERIFIED_GROUPS_FOR_PRACTICE - available} more needed`}</span></section>
        </main>
        <aside className="topic-detail__start"><p className="section-label">Next session</p><h2>{questionCount || 0} source question{questionCount === 1 ? '' : 's'}</h2><ul><li>{topicPracticeUnits.length} practice set{topicPracticeUnits.length === 1 ? '' : 's'} · {available} verified groups</li><li>{markingCapabilityCounts.practice} answer parts: {markingCapabilityCounts.selfMark} self-mark, {markingCapabilityCounts.deterministic} deterministic, {markingCapabilityCounts.aiAssisted} AI-assisted</li><li>{topicMistakes ? `${topicMistakes} mistake${topicMistakes === 1 ? '' : 's'} linked` : practiceReady ? 'Ready for a ten-question source set' : available ? `Limited source inventory · ${MIN_VERIFIED_GROUPS_FOR_PRACTICE} groups needed for a full set` : 'Source indexing in progress'}</li></ul>{available > 0 ? <button type="button" className="primary-action" onClick={startTopicPractice}><PlayIcon />{practiceReady ? (nextPracticeUnit ? `Start set ${nextPracticeUnit.sourceSetIndex}` : `Practice ${questionCount}`) : `Limited · practice ${questionCount} verified`}</button> : <button type="button" className="primary-action" disabled>Still indexing this topic</button>}{topicPracticeUnits.length > 1 && <div className="topic-detail__set-list" aria-label="Past-paper practice sets">{topicPracticeUnits.map((unit) => <button type="button" key={unit.id} data-completed={Boolean(completionByUnit[unit.id]?.completed)} onClick={() => startPractice(unit)}><span>Set {unit.sourceSetIndex}</span><small>{unit.questionGroupCount} source groups · {unit.parts.length} answer parts · {unit.referencePapers.length} papers</small></button>)}</div>}<button type="button" className="topic-detail__ai" onClick={onOpenCoach}><Sparkles size={16} />Ask AI Tutor about this topic</button>{startError && <p className="topic-detail__error" role="alert">{startError}</p>}</aside>
      </div>
    </section>
  )
}

function LegacyKnowledgeMap({ subjectFilter, setSubjectFilter, completionByUnit, startPractice, startKnowledgeDrill, openPapers, catalogItems, verifiedUnits, practiceOptions }) {
  // oxlint-disable-next-line react-hooks/rules-of-hooks
  const [inventoryError, setInventoryError] = useState('')
  const planSubjectByAppSubject = { 'igcse-math': 'math-0580', 'additional-math': 'math-0606', physics: 'physics-9702', 'igcse-physics': 'physics-0625', biology: 'biology-9700', 'igcse-biology': 'biology-0610', chemistry: 'chemistry-9701', economics: 'economics-9708', math: 'math-9709', 'further-math': 'math-9231' }
  const appSubjectByPlanSubject = Object.fromEntries(Object.entries(planSubjectByAppSubject).map(([appSubject, planSubject]) => [planSubject, appSubject]))
  const selectedPlanSubject = subjectFilter === 'all' ? 'physics-9702' : planSubjectByAppSubject[subjectFilter]
  const planSubject = learningPlan.subjects.find((subject) => subject.id === selectedPlanSubject)
  const contestSubject = practiceOptions.find((subject) => subject.id === subjectFilter)
  const groups = planSubject ? (planSubject.knowledgeGroupIds || [])
    .map((groupId) => learningPlan.knowledgeGroups.find((group) => group.id === groupId))
    .filter((group) => group && !group.hidden) : (contestSubject?.topics || []).map((topic) => ({
      id: topic.id,
      name: topic.label,
      description: `${contestSubject.label} official archive questions with paired source answers.`,
      themes: [],
      skills: ['choose a method', 'show complete working', 'check the conclusion'],
      stageTags: contestSubject.stages,
      contestStages: contestSubject.stages,
      subjectId: contestSubject.id,
    }))

  function unitsForGroup(group) {
    return verifiedUnits.filter((unit) => unit.knowledgeGroupId === group.id)
  }

  function stageOptionsForGroup(group) {
    if (group.contestStages) return group.contestStages
    if (group.subjectId === 'math-0580' || group.subjectId === 'math-0606' || group.subjectId === 'physics-0625') return ['IGCSE']
    return stagesForComponentTags(group.stageTags)
  }

  function startGroupDrill(group, fallbackUnit, stage, available) {
    const appSubjectId = appSubjectByPlanSubject[group.subjectId] || subjectFilter
    if (startKnowledgeDrill && appSubjectId && appSubjectId !== 'all' && available > 0) {
      try {
        setInventoryError('')
        startKnowledgeDrill({ subjectId: appSubjectId, stage, knowledgeGroupId: group.id, questionCount: Math.min(10, available), allowPartial: true })
      } catch (error) {
        setInventoryError(error.message || 'This topic has no verified source question yet.')
      }
      return
    }
    if (fallbackUnit) startPractice(fallbackUnit)
    else openPapers(appSubjectId || 'all')
  }

  return (
    <section className="knowledge-map">
      <header><div><p className="section-label">Syllabus practice</p><h2>Pick the course, stage and topic you need today.</h2><p>Each drill follows the current Cambridge syllabus and uses only question-level items that are already indexed to their paired QP and mark scheme. Smaller inventories remain available and are labelled by stage.</p><div className="knowledge-links">{planSubject?.syllabusUrl && <a className="syllabus-link" href={planSubject.syllabusUrl} target="_blank" rel="noreferrer">Cambridge {planSubject.code} official syllabus <ChevronRight size={14} /></a>}<a className="syllabus-link" href="https://ieltsist.com/?from=stem&focus=language#vocabulary" target="_blank" rel="noreferrer">Review subject vocabulary <ChevronRight size={14} /></a></div></div><div className="subject-segments">{subjects.map((subject) => <button type="button" className={(subjectFilter === subject.id || (subjectFilter === 'all' && subject.id === 'physics')) ? 'active' : ''} key={subject.id} onClick={() => setSubjectFilter(subject.id)}><strong>{subject.code}</strong><span>{subject.name}</span></button>)}</div></header>
      {inventoryError && <div className="inventory-alert" role="alert"><AlertTriangle size={18} /><span>{inventoryError}</span></div>}
      <div className="knowledge-rows">{groups.map((group) => {
        const units = unitsForGroup(group)
        const unit = units[0]
        const percentages = units.map((item) => completionByUnit[item.id]?.best?.percentage).filter((value) => value != null)
        const percentage = percentages.length ? Math.max(...percentages) : null
        const stage = percentage == null ? 'Not started' : percentage >= 80 ? 'Secure' : 'Practising'
        const appSubjectId = appSubjectByPlanSubject[group.subjectId] || subjectFilter
        const stageOptions = stageOptionsForGroup(group)
        const previews = stageOptions.map((stageName) => ({
          stage: stageName,
          sourceMix: previewCoachPracticeSourceMix({
            subjectId: appSubjectId,
            stage: stageName,
            knowledgeGroupId: group.id,
            questionCount: 10,
            catalogItems,
          }),
        }))
        const primaryPreview = previews[0]?.sourceMix
        const subjectCode = subjects.find((subject) => subject.id === appSubjectId)?.code || 'selected'
        return <article className="knowledge-row" key={group.id}><div className="knowledge-stage"><span>{stage}</span>{group.stageTags?.length > 0 && <small>{group.stageTags.join(' / ')}</small>}<div className="mini-progress"><i style={{ width: `${percentage ?? 4}%` }} /></div></div><div className="knowledge-copy"><h3>{group.name}</h3><p>{group.description}</p><div className="knowledge-themes">{group.themes.map((theme) => <span key={theme}>{theme}</span>)}</div><small className="knowledge-skill-line">Skills: {(group.skills || []).slice(0, 3).join(' · ')}</small><div className="knowledge-source-preview" aria-label={`${group.name} drill source inventory`}>{previews.map((preview) => <span className={preview.sourceMix.status === 'empty' ? 'not-ready' : preview.sourceMix.partial ? 'partial' : 'ready'} key={preview.stage}><strong>{preview.stage}</strong>{preview.sourceMix.available} verified{preview.sourceMix.partial ? ' · partial' : ''}</span>)}</div><small className="knowledge-source-policy">Stage availability is real question-level inventory. It never blocks access to other indexed content.</small></div><div className="knowledge-action"><strong>{percentage == null ? `${primaryPreview?.available || 0} verified questions` : `${percentage}% best`}</strong><div className="knowledge-drill-buttons">{stageOptions.map((stageName) => { const preview = previews.find((item) => item.stage === stageName)?.sourceMix; const count = Math.min(10, preview?.available || 0); return <button type="button" className="card-action" key={stageName} disabled={!count} onClick={() => startGroupDrill(group, unit, stageName, count)}>{count ? `Build ${stageName} drill · ${count} question${count === 1 ? '' : 's'}` : `${stageName} · no source indexed`}<ChevronRight size={15} /></button> })}</div><button type="button" className="text-action" onClick={() => openPapers(appSubjectId)}>Open {subjectCode} papers</button></div></article>
      })}</div>
    </section>
  )
}

LegacyKnowledgeMap.displayName = 'LegacyKnowledgeMap'

function KnowledgeMap({ activeRoute, activeRouteId, selectRoute, completionByUnit, startPractice, startKnowledgeDrill, openPapers, verifiedUnits, practiceOptions }) {
  const [inventoryError, setInventoryError] = useState('')
  const routeOption = practiceOptions.find((item) => item.routeId === activeRouteId)
  const vocabularyCoverage = vocabularyCoverageForRoute(activeRoute)
  const qualificationRoutes = courseRoutes.filter((route) => route.qualification === activeRoute.qualification)
  const subjectRoutes = qualificationRoutes.filter((route) => route.subjectId === activeRoute.subjectId)
  const stageRoutes = subjectRoutes.filter((route) => route.stage === activeRoute.stage)
  const appSubject = subjects.find((subject) => subject.routeIds?.includes(activeRouteId))

  const chooseFirst = (routes) => routes[0] && selectRoute(routes[0].routeId)
  const topics = routeOption?.topics || []

  function startDrill(topic, fallbackUnit) {
    const available = topic.inventory || 0
    if (!available) return
    try {
      setInventoryError('')
      startKnowledgeDrill({ routeId: activeRouteId, knowledgeGroupId: topic.id, questionCount: Math.min(10, available), allowPartial: true })
    } catch (error) {
      if (fallbackUnit) startPractice(fallbackUnit)
      else setInventoryError(error.message || 'This syllabus topic has no verified source question yet.')
    }
  }

  return <section className="knowledge-map">
    <header>
      <div><p className="section-label">Syllabus practice</p><h2>{activeRoute.stage} {activeRoute.subject} · choose a syllabus topic.</h2><p>All drills are restricted to this route. Each question remains bound to its original question paper and exact mark scheme.</p><div className="knowledge-links">{activeRoute.syllabus.url && <a className="syllabus-link" href={activeRoute.syllabus.url} target="_blank" rel="noreferrer">Cambridge {activeRoute.subjectCode} official syllabus <ChevronRight size={14} /></a>}<a className="syllabus-link" href="https://ieltsist.com/?from=stem&focus=language#vocabulary" target="_blank" rel="noreferrer">Vocabulary <ChevronRight size={14} /></a></div><div className="knowledge-vocabulary-band" data-vocabulary-taxonomy={vocabularyCoverage.taxonomyId}><Brain size={17} /><div><strong>{vocabularyCoverage.label}</strong><span>{vocabularyCoverage.sourceStatus} · {vocabularyCoverage.termInventoryStatusLabel}</span></div><small>{vocabularyCoverage.coverageNote}</small></div></div>
      <div className="route-selector-grid" aria-label="Choose learning route">
        <label><span>Qualification</span><select value={activeRoute.qualification} onChange={(event) => chooseFirst(courseRoutes.filter((route) => route.qualification === event.target.value))}>{[...new Set(courseRoutes.map((route) => route.qualification))].map((qualification) => <option value={qualification} key={qualification}>{qualification}</option>)}</select></label>
        <label><span>Subject</span><select value={activeRoute.subjectId} onChange={(event) => chooseFirst(qualificationRoutes.filter((route) => route.subjectId === event.target.value))}>{[...new Map(qualificationRoutes.map((route) => [route.subjectId, route])).values()].map((route) => <option value={route.subjectId} key={route.subjectId}>{route.subjectCode.toUpperCase()} {route.subject}</option>)}</select></label>
        <label><span>Stage</span><select value={activeRoute.stage} onChange={(event) => chooseFirst(subjectRoutes.filter((route) => route.stage === event.target.value))}>{[...new Set(subjectRoutes.map((route) => route.stage))].map((stage) => <option value={stage} key={stage}>{stage}</option>)}</select></label>
        {stageRoutes.length > 1 && <label><span>Paper route</span><select value={activeRouteId} onChange={(event) => selectRoute(event.target.value)}>{stageRoutes.map((route) => <option value={route.routeId} key={route.routeId}>{formatRouteComponents(route.paperComponents)}</option>)}</select></label>}
      </div>
    </header>
    {inventoryError && <div className="inventory-alert" role="alert"><AlertTriangle size={18} /><span>{inventoryError}</span></div>}
    <div className="knowledge-rows">{topics.map((topic) => {
      const baseId = topic.id.split('@')[0]
      const metadata = learningPlan.knowledgeGroups.find((item) => item.id === baseId)
      const units = verifiedUnits.filter((unit) => unit.routeId === activeRouteId && unit.knowledgeGroupId === topic.id)
      const percentage = Math.max(...units.map((unit) => completionByUnit[unit.id]?.best?.percentage).filter((value) => value != null), -1)
      const status = percentage < 0 ? 'Not started' : percentage >= 80 ? 'Secure' : 'Practising'
      const available = topic.inventory || 0
      return <article className="knowledge-row" key={topic.id}><div className="knowledge-stage"><span>{status}</span><small>{activeRoute.stage}</small><div className="mini-progress"><i style={{ width: `${percentage < 0 ? 4 : percentage}%` }} /></div></div><div className="knowledge-copy"><h3>{topic.label}</h3><p>{metadata?.description || `${activeRoute.syllabus.board} syllabus topic.`}</p><div className="knowledge-themes">{(metadata?.themes || []).slice(0, 5).map((theme) => <span key={theme}>{theme}</span>)}</div><div className="knowledge-source-preview"><span className={available ? available < MIN_VERIFIED_GROUPS_FOR_PRACTICE ? 'partial' : 'ready' : 'not-ready'}><strong>{activeRoute.stage}</strong>{available} verified</span></div></div><div className="knowledge-action"><strong>{percentage < 0 ? `${available} verified questions` : `${percentage}% best`}</strong><button type="button" className="card-action" disabled={!available} onClick={() => startDrill(topic, units[0])}>{available >= MIN_VERIFIED_GROUPS_FOR_PRACTICE ? `Build ${activeRoute.stage} drill · ${MIN_VERIFIED_GROUPS_FOR_PRACTICE} questions` : available ? `Limited · practice ${available} verified` : 'No source indexed'}<ChevronRight size={15} /></button><button type="button" className="text-action" onClick={() => openPapers(appSubject?.id || 'all')}>Open {activeRoute.subjectCode} papers</button></div></article>
    })}</div>
  </section>
}

KnowledgeMap.displayName = 'KnowledgeMap'

function UnitCard({ unit, completion, startPractice, favorite, onToggleFavorite }) {
  const subject = subjects.find((item) => item.id === unit.subjectId)

  return (
    <article className="unit-card">
      <div className="unit-topline">
        <span className="large-icon" style={{ color: subject?.accent }}>
          {unit.icon}
        </span>
        <span className="status-pill">{unit.agentGenerated ? 'AI Coach set' : unit.priority}</span>
        <button type="button" className={`unit-favorite ${favorite ? 'saved' : ''}`} onClick={() => onToggleFavorite(unit.id)} aria-label={favorite ? `Remove ${unit.title} from saved practice` : `Save ${unit.title} for later`}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /></button>
      </div>
      <h2>{unit.title}</h2>
      <p>{unit.topic} · {unit.subtopic || unit.specification}</p>
      <div className="unit-meta">
        <span>{unit.board}</span>
        <span>{unit.estimatedMinutes} min</span>
        <span>{unit.maxMarks} marks</span>
        {unit.referencePapers?.length > 0 && <span>{unit.referencePapers.length} paper refs</span>}
      </div>
      <div className="completion-line">
        <span>{completion.completed ? 'Completed' : 'Not completed'}</span>
        <strong>{completion.latest ? `${completion.latest.rawMarks}/${completion.latest.maxMarks}` : 'No score'}</strong>
      </div>
      <button type="button" className="card-action" onClick={() => startPractice(unit)}>
        {completion.completed ? 'Practise again' : 'Start'}
      </button>
    </article>
  )
}

function StudentNotebook({ activeRoute, routeOptions, selectRoute, attempts, units, mistakes, paperMistakes, note, onChangeNote, onDeleteNote, startPractice, retestPaper, openPractice }) {
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState('all')
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const search = query.trim().toLowerCase()
  const filteredMistakes = mistakes.filter((mistake) => {
    const searchable = `${mistake.unit.title} ${mistake.unit.topic} ${mistake.part.label} ${mistake.criterion.feedback}`.toLowerCase()
    return (!search || searchable.includes(search)) && (severity === 'all' || mistake.severity.toLowerCase() === severity)
  })
  const filteredPaperMistakes = paperMistakes.filter((mistake) => !search || `${mistake.session.file} ${mistake.status}`.toLowerCase().includes(search))
  const recentAttempts = attempts
    .filter((attempt) => {
      const unit = unitById.get(attempt.unitId)
      return Boolean(unit && isScoredAttempt(attempt, unit))
    })
    .toSorted((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .slice(0, 4)
  const savedNote = note?.body || ''
  const masteredTopics = new Set(units.filter((unit) => {
    const best = getUnitAttempts(attempts, unit).map((attempt) => attempt.scoreResult?.percentage).filter(Number.isFinite).sort((a, b) => b - a)[0]
    return best >= 80
  }).map((unit) => unit.knowledgeGroupId || unit.topic)).size
  const noteStatus = note?.deleted
    ? note.syncStatus === 'error' ? 'Server deletion failed; the note stays hidden on this device' : note.syncStatus === 'pending' ? 'Deleting privately…' : note.syncStatus === 'synced' ? 'Deleted from this device and your IELTSist ID' : 'Deleted from this device'
    : note?.syncStatus === 'error' ? 'Sync failed; your local note is safe' : note?.syncStatus === 'pending' ? 'Syncing privately…' : note?.syncStatus === 'synced' ? 'Synced to your IELTSist ID' : 'Saved on this device'

  return (
    <section className="notebook-view page-band">
      <header className="notebook-header">
        <div>
          <p className="section-label">Notebook</p>
          <h1>Turn mistakes into your next marks.</h1>
          <p className="page-intro">Review open mark points, keep a private route note, and retest without replacing the original attempt.</p>
        </div>
        <StudentRoutePicker activeRoute={activeRoute} routes={routeOptions} selectRoute={selectRoute} compact />
      </header>

      <div className="notebook-summary" aria-label="Notebook summary">
        <div><strong>{mistakes.length + paperMistakes.length}</strong><span>open items</span></div>
        <div><strong>{mistakes.filter((item) => item.severity === 'High').length}</strong><span>high priority</span></div>
        <div><strong>{masteredTopics}</strong><span>mastered topics</span></div>
        <div><strong>{recentAttempts.length}</strong><span>recent results</span></div>
      </div>

      <div className="notebook-layout">
        <section className="notebook-queue">
          <header className="notebook-section-heading"><div><p className="section-label">Review queue</p><h2>What needs another look</h2></div><button type="button" className="secondary-action compact-action" onClick={openPractice}><Dumbbell size={16} />Find practice</button></header>
          <div className="notebook-filters"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mistakes" aria-label="Search notebook mistakes" /></label><label><span>Priority</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option></select></label></div>
          {filteredMistakes.length || filteredPaperMistakes.length ? <div className="notebook-mistake-list">
            {filteredMistakes.map((mistake) => {
              const response = mistake.attempt.answers?.[mistake.part.id] || mistake.attempt.working?.[mistake.part.id] || 'No typed response saved'
              const pointEvidenceMissing = mistake.criterion.scoringSource === 'student-self-mark' && mistake.criterion.evidenceStatus === 'not-recorded'
              const missedPoints = pointEvidenceMissing ? [] : mistake.criterion.evidence?.filter((point) => !point.awarded) || []
              return <article className="notebook-mistake" key={mistake.id}><header><span className={`status-pill danger ${mistake.severity.toLowerCase()}`}>{mistake.severity} priority</span><span>{mistake.status}</span></header><h3>{mistake.unit.title} - part {displayPartLabel(mistake.part)}</h3><p className="notebook-mistake__topic">{mistake.unit.topic} - {mistake.part.marks} marks - {formatDate(mistake.attempt.submittedAt)}</p><p>{mistake.criterion.feedback}</p><details><summary>{pointEvidenceMissing ? 'Review your response and official mark scheme' : 'Review your response and missed points'}</summary><div className="notebook-evidence-copy"><strong>Your response</strong><pre>{response}</pre>{pointEvidenceMissing && <><p className="self-mark-evidence-note">Your total self-mark is saved, but the specific awarded and missed mark-scheme points were not recorded.</p>{mistake.part.answerRef?.localUrl && <a className="mark-scheme-link" href={mistake.part.answerRef.localUrl} target="_blank" rel="noreferrer">Open exact mark scheme for {displayPartLabel(mistake.part)}</a>}{mistake.part.markPoints?.length > 0 && <><strong>Official mark-scheme points</strong><ul>{mistake.part.markPoints.map((point, index) => <li key={`${mistake.part.id}-official-${index + 1}`}>{point}</li>)}</ul></>}</>}{missedPoints.length > 0 && <><strong>Mark points to add next time</strong><ul>{missedPoints.map((point) => <li key={point.pointId}>{point.point}</li>)}</ul></>}</div></details><footer><span>{mistake.criterion.awarded}/{mistake.criterion.maxMarks} marks</span><button type="button" className="primary-action compact-action" onClick={() => startPractice(mistake.unit, { clearDraft: true, retestOf: mistake.attempt.id, onlyPartId: mistake.part.id })}><RefreshCcw size={15} />Retest this part</button></footer></article>
            })}
            {filteredPaperMistakes.map((mistake) => <article className="notebook-mistake" key={mistake.id}><header><span className="status-pill danger">Paper review</span><span>{mistake.status}</span></header><h3>{mistake.session.file} - question {mistake.questionNumber}</h3><p className="notebook-mistake__topic">{mistake.paper.subject} - {formatDate(mistake.session.completedAt)}</p><p>{mistake.status === 'Blank response' ? 'No final response was submitted for this printed question.' : 'Compare your response with the exact mark scheme and record the awarded marks.'}</p><footer><span>{mistake.awarded == null ? 'Not self-marked' : `${mistake.awarded}/${mistake.maxMarks} marks`}</span><button type="button" className="primary-action compact-action" onClick={() => retestPaper(mistake.paper, mistake.session.attemptId)}><RefreshCcw size={15} />Retest paper</button></footer></article>)}
          </div> : <div className="empty-state notebook-empty"><CheckCircle2 size={28} /><h2>{search || severity !== 'all' ? 'No notebook items match' : 'Your review queue is clear'}</h2><p>{search || severity !== 'all' ? 'Try a different search or priority.' : 'Complete a practice set and missed mark points will be saved here.'}</p>{(search || severity !== 'all') && <button type="button" className="secondary-action" onClick={() => { setQuery(''); setSeverity('all') }}>Clear filters</button>}</div>}
        </section>

        <aside className="notebook-side">
           <section className="notebook-note-tool"><header><div><p className="section-label">Private note</p><h2>What will you remember?</h2></div><div className="notebook-note-tool__actions"><BookOpen size={18} />{savedNote && <button type="button" className="icon-button" onClick={onDeleteNote} aria-label="Delete private note" title="Delete private note"><Trash2 size={16} /></button>}</div></header><textarea value={savedNote} onChange={(event) => onChangeNote(event.target.value)} placeholder="Write a short method, formula, or reminder for this route..." aria-label="Private route notebook note" /><small>{note?.updatedAt ? `${noteStatus} · ${formatDate(note.updatedAt)}` : noteStatus}</small></section>
          <section className="notebook-recent"><header><div><p className="section-label">Progress</p><h2>Recent results</h2></div><BarChart3 size={18} /></header>{recentAttempts.length ? <div>{recentAttempts.map((attempt) => { const unit = unitById.get(attempt.unitId); return <div className="notebook-result-row" key={attempt.id}><span><strong>{unit?.topic || 'Practice set'}</strong><small>{unit?.title || 'Verified question set'}</small></span><b>{attempt.scoreResult.percentage}%</b></div> })}</div> : <p className="notebook-side-empty">Your completed sets will appear here.</p>}</section>
        </aside>
      </div>
    </section>
  )
}

function MistakeList({ mistakes, paperMistakes, startPractice, retestPaper }) {
  if (!mistakes.length && !paperMistakes.length) {
    return (
      <div className="empty-state">
        <CheckCircle2 size={28} />
        <h2>No mistakes yet</h2>
        <p>Submit a practice attempt and weak parts will appear here with linked retests.</p>
      </div>
    )
  }

  return (
    <div className="mistake-list">
      {mistakes.map((mistake) => (
        <article className="mistake-row" key={mistake.id}>
          <div>
            <span className="status-pill danger">{mistake.severity}</span>
            <h2>{mistake.unit.title} · part {displayPartLabel(mistake.part)}</h2>
            <p>{mistake.criterion.feedback}</p>
          </div>
          <div className="mistake-score">
            <strong>{mistake.criterion.awarded}/{mistake.criterion.maxMarks}</strong>
            <small>{mistake.status}</small>
          </div>
          <button type="button" className="secondary-action compact-action" onClick={() => startPractice(mistake.unit, { clearDraft: true, retestOf: mistake.attempt.id, onlyPartId: mistake.part.id })}>
            <RefreshCcw size={16} />
            Retest
          </button>
        </article>
      ))}
      {paperMistakes.map((mistake) => (
        <article className="mistake-row paper-mistake-row" key={mistake.id}>
          <div>
            <span className="status-pill danger">{mistake.severity}</span>
            <h2>{mistake.session.file} · question {mistake.questionNumber}</h2>
            <p>{mistake.status === 'Blank response' ? 'No final response was submitted for this printed question.' : mistake.status === 'Self-mark needed' ? 'Compare this response with the exact mark scheme and record the awarded marks.' : 'The latest self-mark is below the recorded available marks.'}</p>
          </div>
          <div className="mistake-score">
            <strong>{mistake.awarded == null ? '—' : mistake.awarded}/{mistake.maxMarks == null ? '?' : mistake.maxMarks}</strong>
            <small>{mistake.status}</small>
          </div>
          <button type="button" className="secondary-action compact-action" onClick={() => retestPaper(mistake.paper, mistake.session.attemptId)}>
            <RefreshCcw size={16} />
            Retest paper
          </button>
        </article>
      ))}
    </div>
  )
}

function ResultView({ attempt, unit, sourceCurrent = true, startPractice, goLibrary, recordSelfMark, initialSelfMarks, onSelfMarksChange }) {
  const safeInitialSelfMarks = initialSelfMarks || EMPTY_SELF_MARKS
  const [selfMarks, setSelfMarks] = useState(() => safeInitialSelfMarks)
  const result = attempt.scoreResult || null
  const answeredParts = unit.parts.filter((part) => Boolean(String(attempt.answers?.[part.id] || attempt.working?.[part.id] || '').trim()) || Boolean(attempt.evidence?.[part.id])).length
  const pendingSelfMark = isPendingSelfMarkAttempt(attempt)

  useEffect(() => {
    setSelfMarks(safeInitialSelfMarks)
  }, [attempt.id, safeInitialSelfMarks])

  if (!sourceCurrent) {
    return (
      <section className="result-view page-band">
        <div className="result-hero" role="status">
          <div>
            <p className="section-label">Saved record</p>
            <h1>Source review has changed</h1>
            <p>Your answers and handwriting remain in this private record, but this attempt cannot be self-marked, retested, scored or counted because its original QP/MS binding is no longer current.</p>
          </div>
          <div className="result-actions"><button type="button" className="secondary-action" onClick={goLibrary}><ArrowLeft size={18} />Back to library</button></div>
        </div>
      </section>
    )
  }

  if (pendingSelfMark) {
    const markingLifecycle = attempt.markingLifecycle || buildPartMarkingLifecycle(unit, attempt.answers, attempt.elapsedSec, attempt.visionReviews)
    const pendingParts = pendingPartsForLifecycle(unit, markingLifecycle)
    const marksComplete = hasCompleteStudentMarks(unit, markingLifecycle, selfMarks)
    const resolvedCount = markingLifecycle.provisionalCriteria?.length || 0
    const updateSelfMark = (part, raw) => {
      const nextValue = raw === '' ? '' : Math.max(0, Math.min(part.marks, Number(raw)))
      setSelfMarks((current) => {
        const next = { ...current, [part.id]: nextValue }
        onSelfMarksChange?.(next)
        return next
      })
    }
    return (
      <section className="result-view page-band self-mark-result">
        <div className="result-hero">
          <div>
            <p className="section-label">Submission saved</p>
            <h1>Ready to self-mark</h1>
            <p><span className="result-status result-status--in-progress">Pending</span>Your responses are saved. No total score, mastery, mistake or learning event is created until every pending part has a valid mark.</p>
          </div>
          <div className="result-actions"><button type="button" className="secondary-action" onClick={goLibrary}><ArrowLeft size={18} />Back to library</button></div>
        </div>
        <section className="self-mark-result__guide" aria-label="Record self-mark">
          <header className="self-mark-result__heading"><div><p className="section-label">Paired mark scheme</p><h2>Finish the unresolved parts</h2><p>Use the exact paired mark scheme. AI failures and missing handwriting stay pending instead of becoming automatic zeroes.</p></div>{resolvedCount > 0 && <div className="self-mark-result__subtotal"><span>Checked so far</span><strong>{markingLifecycle.provisionalRawMarks}/{markingLifecycle.provisionalMaxMarks}</strong><small>Provisional only; not in progress</small></div>}</header>
          <div className="self-mark-result__rows">
            {pendingParts.map((part) => {
              const index = unit.parts.findIndex((item) => item.id === part.id)
              const partState = markingLifecycle.partStates?.[part.id]
              const isAiPending = partState?.capability === 'ai-assisted'
              return <div className="self-mark-result__row" key={part.id}><div className="self-mark-result__question"><span className={`self-mark-result__state self-mark-result__state--${isAiPending ? 'ai' : 'manual'}`}>{isAiPending ? 'AI unresolved' : 'Self-mark'}</span><strong>{displayPartLabel(part, `Question ${index + 1}`)}</strong><small>{partState?.reason || 'Compare your response with the paired mark scheme.'}</small></div><label className="self-mark-result__input"><span>Mark</span><span><input type="number" min="0" max={part.marks} step="1" inputMode="numeric" aria-label={`Self-mark for ${displayPartLabel(part, `Question ${index + 1}`)}`} value={selfMarks[part.id] ?? ''} onChange={(event) => updateSelfMark(part, event.target.value)} /><b>/ {part.marks}</b></span></label>{part.answerRef?.localUrl ? <a className="self-mark-result__scheme" href={part.answerRef.localUrl} target="_blank" rel="noreferrer"><BookOpen size={16} />Mark scheme</a> : <span className="self-mark-result__scheme is-missing">Scheme unavailable</span>}</div>
            })}
          </div>
          <footer className="self-mark-result__footer"><p className={marksComplete ? 'self-mark-result__validation is-complete' : 'self-mark-result__validation'} role="status">{marksComplete ? 'Every unresolved part has an explicit mark. Saving appends a canonical scored result.' : `Enter all ${pendingParts.length} pending marks. Blank or partial entries remain unscored.`}</p><button type="button" className="primary-action" disabled={!marksComplete} onClick={() => recordSelfMark?.(attempt.id, selfMarks)}>Record self-mark</button></footer>
        </section>
      </section>
    )
  }

  if (!result) {
    return (
      <section className="result-view page-band">
        <div className="result-hero" role="alert"><div><p className="section-label">Result unavailable</p><h1>This attempt has no valid score record.</h1><p>Your submitted work remains saved, but this attempt cannot update mastery or mistakes. Return to the library and start a fresh attempt.</p></div><div className="result-actions"><button type="button" className="secondary-action" onClick={goLibrary}><ArrowLeft size={18} />Back to library</button></div></div>
      </section>
    )
  }

  const assisted = attempt.assistedReview
  const weakest = result.weakestPartId ? unit.parts.find((part) => part.id === result.weakestPartId) : null
  const assessmentState = answeredParts ? (result.percentage >= 80 ? 'Secure' : result.percentage >= 50 ? 'In progress' : 'Needs review') : 'Not assessed'
  const assessmentCopy = answeredParts ? `${answeredParts}/${unit.parts.length} responses submitted` : 'No answer evidence was submitted'
  const stemReturnUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/?from=ieltsist&focus=${encodeURIComponent(unit.subjectId || '')}&routeId=${encodeURIComponent(unit.routeId || '')}&topicId=${encodeURIComponent(unit.topicId || unit.syllabusTopic || '')}&attemptId=${encodeURIComponent(attempt.id)}`
  const termsUrl = professionalTermsUrl({
    subject: unit.code || unit.board || '',
    subjectCode: unit.subjectCode || unit.code || '',
    stage: unit.stage || '',
    topic: unit.topic || '',
    routeId: unit.routeId,
    topicId: unit.topicId || unit.syllabusTopic || '',
    termIds: termIdsForStemContext({ topicId: unit.topicId || unit.syllabusTopic || '', topicTags: weakest?.topicTags || [] }),
    attemptId: attempt.id,
    returnTo: stemReturnUrl,
  })
  const hasAiReview = Object.values(attempt.visionReviews || {}).some((review) => ['success', 'unconfigured', 'error'].includes(review?.status))
  const hasSavedHandwriting = attempt.imageEvidence?.length > 0
  const hasCanonicalAiMarks = result.criteria.some((criterion) => criterion.scoringSource === 'vision-assisted')
  const markingLabel = result.selfMarked
    ? (hasCanonicalAiMarks ? 'AI-reviewed + student self-mark' : 'Student self-mark from official scheme')
    : hasCanonicalAiMarks ? 'AI-reviewed handwriting' : 'Objective answer check'

  return (
    <section className="result-view page-band">
      <div className="result-hero">
        <div>
          <p className="section-label">Result</p>
          <h1>{result.rawMarks}/{result.maxMarks} marks</h1>
          <p><span className={`result-status result-status--${assessmentState.toLowerCase().replaceAll(' ', '-')}`}>{assessmentState}</span>{assessmentCopy} · {result.gradeEstimate}</p>
        </div>
        <div className="result-actions">
          <button type="button" className="primary-action" onClick={() => startPractice(unit, { clearDraft: true, retestOf: attempt.id })}>
            <RefreshCcw size={18} />
            Retest
          </button>
          <button type="button" className="secondary-action" onClick={goLibrary}>
            <ArrowLeft size={18} />
            Back to library
          </button>
        </div>
      </div>

      <section className="result-learning-signal" aria-label="Mastery change">
        <div><p className="section-label">Learning signal</p><h2>What changed after this attempt</h2><p>{attempt.learningSignal?.masteryBefore == null ? 'This is the first verified result for this set. Keep the evidence and compare it after your retest.' : 'The change is based on your prior submitted attempts for this same verified set.'}</p></div>
        <div className="mastery-delta"><span>Mastery</span><strong>{attempt.learningSignal?.masteryBefore == null ? `${result.percentage}%` : `${attempt.learningSignal.masteryBefore}% → ${attempt.learningSignal.masteryAfter}%`}</strong><small className={attempt.learningSignal?.masteryDelta > 0 ? 'up' : attempt.learningSignal?.masteryDelta < 0 ? 'down' : ''}>{attempt.learningSignal?.masteryDelta == null ? 'Baseline recorded' : `${attempt.learningSignal.masteryDelta > 0 ? '+' : ''}${attempt.learningSignal.masteryDelta}% from your previous average`}</small></div>
        <a className="terms-recommendation" href={termsUrl} target="_blank" rel="noreferrer"><Brain size={18} /><span><strong>Professional terms for this question</strong><small>{(weakest?.topicTags || [unit.topic]).slice(0, 3).join(' · ')}</small></span><ChevronRight size={16} /></a>
      </section>

      {hasAiReview && assisted && (
        <section className="ai-review-summary">
          <header><span className="ai-review-icon"><Sparkles size={19} /></span><div><p className="section-label">Process review</p><h2>{assisted.overallLabel}</h2><p>Objective typed answers use deterministic checks. Handwriting marks are AI-assisted suggestions with confidence and review status, not an official Cambridge decision.</p></div><div className="confidence-meter"><span>Confidence</span><strong>{Math.round(assisted.confidence * 100)}%</strong></div></header>
          <div className="ai-review-grid"><div><span className="review-label secure">What worked</span>{assisted.strengths.length ? <ul>{assisted.strengths.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : <p>No secure evidence yet.</p>}</div><div><span className="review-label gap">Marks still available</span>{assisted.gaps.length ? <ul>{assisted.gaps.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : <p>No missing mark points detected.</p>}</div><div><span className="review-label next">Do this next</span><p>{assisted.nextStep}</p>{assisted.suggestedRetest.recommended && <button type="button" className="text-action" onClick={() => startPractice(unit, { clearDraft: true, retestOf: attempt.id })}>Build focused retest <ChevronRight size={15} /></button>}</div></div>
          {attempt.imageEvidence?.length > 0 && <div className="image-evidence-review"><div><strong>Handwritten responses</strong><span>{attempt.imageEvidence.length} response image{attempt.imageEvidence.length === 1 ? '' : 's'} saved with this attempt. Configured vision results are shown beside each question below.</span></div>{attempt.imageEvidence.map((evidence) => <figure key={evidence.partId}><img src={evidence.dataUrl} alt={`Handwritten response for part ${evidence.partId}`} /><figcaption>Part {unit.parts.find((part) => part.id === evidence.partId)?.label || evidence.partId}</figcaption></figure>)}</div>}
        </section>
      )}
      {hasSavedHandwriting && !hasAiReview && <section className="handwriting-self-mark-note"><strong>Handwritten responses saved</strong><span>Your handwriting is attached to this attempt. Compare it with the paired official mark scheme and record your self-mark.</span></section>}

      <section className="result-next-step" aria-label="Next study step"><div><p className="section-label">Next step</p><h2>Turn this feedback into another attempt</h2><p>{weakest ? `Revisit ${weakest.topic || unit.topic}, then retest the specific mark point you missed.` : 'Keep the method active with a short retest and the related professional terms.'}</p></div><div className="result-next-actions"><button type="button" className="primary-action" onClick={() => startPractice(unit, { clearDraft: true, retestOf: attempt.id })}><RefreshCcw size={17} />Retest this idea</button><a className="secondary-action" href={termsUrl} target="_blank" rel="noreferrer"><Brain size={17} />Review professional terms</a></div></section>

      <div className="result-grid">
        <section className="wide-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Evidence</p>
              <h2>{weakest ? `Weakest part: ${displayPartLabel(weakest)}` : 'All seed checks secure'}</h2>
            </div>
            <strong>{result.percentage}%</strong>
          </div>
          <div className="criteria-list">
            {result.criteria.map((criterion, criterionIndex) => {
              const part = unit.parts.find((item) => item.id === criterion.partId)
              const assistedPart = hasAiReview ? assisted?.parts?.[criterionIndex] : null
              const visionPart = attempt.visionReviews?.[criterion.partId]
              return (
                <article className="criterion" key={criterion.partId}>
                  <div>
                    <h3>Part {displayPartLabel(part)}: {criterion.awarded}/{criterion.maxMarks}</h3>
                    <p>{criterion.feedback}</p>
                    <div className="student-submission">
                      <span>Your response</span>
                      <strong>{attempt.answers[part.id] || (attempt.evidence?.[part.id] ? 'Handwritten response submitted' : 'No answer submitted')}</strong>
                      {attempt.working?.[part.id] && !attempt.answers[part.id] && <pre>{attempt.working[part.id]}</pre>}
                    </div>
                    {visionPart?.status === 'success' && <div className="vision-result-inline"><header><Sparkles size={14} /><strong>Handwriting review: {visionPart.rawMarks}/{visionPart.maxMarks}</strong><span>{Math.round(visionPart.confidence * 100)}% confidence{visionPart.reviewRequired ? ' · check required' : ''}</span></header>{visionPart.recognizedWork && <p>{visionPart.recognizedWork}</p>}{visionPart.correctedSolution && <details><summary>Correction</summary><p>{visionPart.correctedSolution}</p></details>}</div>}
                    {visionPart?.status === 'unconfigured' && <p className="vision-result-inactive">AI handwriting marking was not configured; this image is saved for manual review.</p>}
                    {visionPart?.status === 'error' && <p className="vision-result-inactive">{visionPart.error}</p>}
                    {visionPart?.status === 'self_mark_only' && <p className="vision-result-inactive">Handwriting is saved with this attempt. Compare it with the exact mark scheme and record your self-mark.</p>}
                    {part.sourceRef?.markSchemeUrl && <a className="mark-scheme-link" href={part.sourceRef.markSchemeUrl} target="_blank" rel="noreferrer">Open exact mark scheme for {displayPartLabel(part)}</a>}
                    {part.answerRef && <div className="official-answer"><header><strong>Official mark scheme</strong><a className="mark-scheme-link" href={part.answerRef.localUrl} target="_blank" rel="noreferrer">Open {part.answerRef.file}</a></header>{part.answerRef.assetUrls?.map((url) => <img src={url} alt={`${part.answerRef.file}, answer for ${part.sourceRef?.question}`} loading="lazy" key={url} />)}{part.exactAnswer && <details><summary>Extracted mark-scheme text</summary><p>{part.exactAnswer}</p></details>}</div>}
                  </div>
                  <div className="mark-points">
                    {criterion.evidenceStatus === 'not-recorded' && <p className="self-mark-evidence-note">Specific awarded and missed mark-scheme points were not recorded for this self-mark. Review the official mark scheme without treating any individual point as awarded.</p>}
                    {(criterion.evidence || []).map((point) => (
                      <span className={point.awarded ? 'awarded' : ''} key={point.pointId}>
                        {point.awarded ? '✓' : '○'} {point.point}
                      </span>
                    ))}
                    {assistedPart && <div className="assisted-part-note"><Sparkles size={14} /><span>{assistedPart.nextStep}</span></div>}
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <aside className="source-panel">
          <p className="section-label">Attempt record</p>
          <dl className="record-list">
            <div>
              <dt>Started</dt>
              <dd>{formatDate(attempt.startedAt)}</dd>
            </div>
            <div>
              <dt>Elapsed</dt>
              <dd>{formatTime(result.elapsedSec)}</dd>
            </div>
            <div>
              <dt>Scoring</dt>
              <dd>{markingLabel}</dd>
            </div>
            {hasCanonicalAiMarks && Number.isFinite(result.confidence) && <div><dt>AI confidence</dt><dd>{Math.round(result.confidence * 100)}%</dd></div>}
          </dl>
        </aside>
      </div>
    </section>
  )
}

export default App
