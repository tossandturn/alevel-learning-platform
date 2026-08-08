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
  Library,
  ListFilter,
  Play,
  RefreshCcw,
  Search,
  Sparkles,
  Target,
  TimerReset,
  Trophy,
  Users,
} from 'lucide-react'
import { fullPaperUnits, importedPdfLibrary, subjects, topicUnits } from './data/catalog'
import { learningPlan, stagesForComponentTags } from './data/learningPlan'
import { courseRoutes, formatRouteComponents, routeById, routesForSubject } from './data/routeRegistry'
import { HistoryView } from './components/HistoryView'
import { AiCoach } from './components/AiCoach'
import { RoleWorkspace } from './components/RoleWorkspace'
import { PaperLibrary } from './components/PaperLibrary'
import { PracticeWorkspace } from './components/PracticeWorkspace'
import { usePaperCatalog } from './hooks/usePaperCatalog'
import { loadState, makeAttemptId, normalizeState, saveState } from './lib/storage'
import { scoreAttempt } from './lib/scoring'
import { reviewAttempt } from './lib/aiReview'
import { buildCoachPractice, coachPracticeOptions, previewCoachPracticeSourceMix } from './lib/coachPractice'
import { latestBphoSpcPaper } from './lib/coachIntent'
import { buildCompletionByUnit, buildLearningProgress, recommendForRoute } from './lib/learningProgress'
import { requestSharedAccount, requestSharedWorkspace, sharedAccountRequest } from './lib/sharedAccount'
import './App.css'
import './StudentV2.css'

const PaperWorkspace = lazy(() =>
  import('./components/PaperWorkspace').then((module) => ({ default: module.PaperWorkspace })),
)

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
  return `${route.stage} ${route.subject} (${route.subjectCode.toUpperCase()})${componentLabel}`
}

function focusedRetestUnit(unit, partId) {
  if (!partId || unit.parts.length === 1) return unit
  const part = unit.parts.find((item) => item.id === partId)
  if (!part) return unit
  const ratio = 1 / Math.max(1, unit.parts.length)
  return {
    ...unit,
    id: `${unit.id}:focused:${part.id}`,
    title: `${unit.title} · ${part.label}`,
    parts: [part],
    maxMarks: part.marks,
    estimatedMinutes: Math.max(5, Math.ceil((unit.estimatedMinutes || 10) * ratio)),
    durationSec: Math.max(300, Math.ceil((unit.durationSec || 600) * ratio)),
    focusedRetestOf: unit.id,
  }
}

function getUnitAttempts(attempts, unitId) {
  return attempts.filter((attempt) => attempt.unitId === unitId && (attempt.attemptStatus === 'result' || attempt.stage === 'result'))
}

function bestResultFor(attempts, unitId) {
  return getUnitAttempts(attempts, unitId)
    .map((attempt) => attempt.scoreResult)
    .sort((a, b) => b.percentage - a.percentage)[0]
}

function gradeEstimate(percentage) {
  return percentage >= 80 ? 'A/A* range' : percentage >= 65 ? 'B range' : percentage >= 50 ? 'C range' : 'Needs rebuild'
}

async function requestVisionReviews(unit, attempt) {
  const entries = Object.entries(attempt.evidence || {}).filter(([, evidence]) => Boolean(evidence?.dataUrl))
  if (!entries.length) return {}
  try {
    const statusResponse = await fetch('/api/ai/status')
    const status = await statusResponse.json()
    if (!status.visionEnabled) return Object.fromEntries(entries.map(([partId]) => [partId, { status: 'unconfigured' }]))
  } catch {
    return Object.fromEntries(entries.map(([partId]) => [partId, { status: 'error', error: 'AI service status could not be checked.' }]))
  }

  const subjectCode = subjects.find((subject) => subject.id === unit.subjectId)?.code || String(unit.specification || '').match(/\b\d{4}\b/)?.[0] || ''
  const results = await Promise.all(entries.map(async ([partId, evidence]) => {
    const part = unit.parts.find((item) => item.id === partId)
    if (!part) return [partId, { status: 'error', error: 'Question context is unavailable.' }]
    try {
      const [questionImageDataUrls, markSchemeImageDataUrls] = await Promise.all([
        Promise.all((part.sourceRef?.assetUrls || []).slice(0, 2).map(assetToDataUrl)),
        Promise.all((part.answerRef?.assetUrls || []).slice(0, 2).map(assetToDataUrl)),
      ])
      const response = await fetch('/api/ai/mark-handwriting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: evidence.dataUrl,
          questionImageDataUrls,
          markSchemeImageDataUrls,
          subject: subjectCode,
          syllabus: unit.specification,
          questionNumber: Number(String(part.sourceRef?.question || '').match(/\d+/)?.[0]) || unit.parts.indexOf(part) + 1,
          question: {
            prompt: part.prompt,
            answerType: part.answerType,
            acceptedValue: part.acceptedValue,
            acceptedUnits: part.acceptedUnits,
            tolerance: part.tolerance,
            officialAnswer: part.exactAnswer,
          },
          expectedMarkPoints: part.markPoints,
          maxMarks: part.marks,
          typedResponse: attempt.answers[partId] || attempt.working?.[partId] || '',
          paper: part.sourceRef && part.answerRef ? {
            subject: subjectCode,
            questionFile: part.sourceRef.paper,
            markSchemeFile: part.answerRef.file,
          } : undefined,
          provenance: part.answerBinding ? {
            questionId: part.bankId,
            answerId: part.answerBinding.answerId,
            verificationStatus: part.answerBinding.verificationStatus,
            questionDocumentSha256: part.answerBinding.questionDocumentSha256,
            answerDocumentSha256: part.answerBinding.answerDocumentSha256,
          } : undefined,
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
  return Object.fromEntries(results)
}

async function assetToDataUrl(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('An indexed source page is unavailable.')
  const blob = await response.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('An indexed source page could not be prepared.'))
    reader.readAsDataURL(blob)
  })
}

function mergeVisionScore(scoreResult, unit, answers, visionReviews) {
  const criteria = scoreResult.criteria.map((criterion) => {
    const part = unit.parts.find((item) => item.id === criterion.partId)
    const review = visionReviews[criterion.partId]
    const typed = Boolean(String(answers[criterion.partId] || '').trim())
    const canUseVision = review?.status === 'success'
      && review.confidence >= 0.55
      && (!typed || ['written', 'handwritten'].includes(part.answerType))
    if (!canUseVision) return criterion
    return {
      ...criterion,
      awarded: Math.min(part.marks, review.rawMarks),
      status: review.reviewRequired ? 'review-needed' : review.rawMarks >= part.marks ? 'secure' : review.rawMarks > 0 ? 'partial' : 'missed',
      feedback: review.summary,
      confidence: review.confidence,
      evidence: review.markPoints?.length
        ? review.markPoints.map((point, index) => ({ pointId: point.id || `${part.id}-AI${index + 1}`, awarded: point.awarded, point: point.reason }))
        : criterion.evidence,
      scoringSource: 'vision-assisted',
    }
  })
  const rawMarks = criteria.reduce((sum, criterion) => sum + criterion.awarded, 0)
  const percentage = Math.round((rawMarks / unit.maxMarks) * 100)
  const weakest = criteria.find((criterion) => criterion.awarded < criterion.maxMarks)
  return {
    ...scoreResult,
    schemaVersion: Object.values(visionReviews).some((review) => review.status === 'success') ? 'deterministic-plus-vision-v1' : scoreResult.schemaVersion,
    rawMarks,
    percentage,
    gradeEstimate: gradeEstimate(percentage),
    weakestPartId: weakest?.partId || null,
    confidence: criteria.length ? Number((criteria.reduce((sum, criterion) => sum + (criterion.confidence ?? 0.9), 0) / criteria.length).toFixed(2)) : 0,
    criteria,
  }
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
  const params = new URLSearchParams(window.location.search)
  const focus = params.get('focus') || ''
  const subjectId = {
    physics: 'physics',
    biology: 'biology',
    mathematics: 'math',
    chemistry: 'chemistry',
    economics: 'economics',
  }[focus] || 'all'
  return { from: params.get('from') || '', focus, subjectId }
}

function App() {
  const [appState, setAppState] = useState(() => loadState())
  const paperCatalogState = usePaperCatalog()
  const incomingContext = getIncomingProductContext()
  const [view, setView] = useState(() => incomingContext.from === 'ieltsist' || incomingContext.focus ? 'library' : 'dashboard')
  const [activeTab, setActiveTab] = useState('recommended')
  const [selectedTopicId, setSelectedTopicId] = useState(null)
  const [activeRouteId, setActiveRouteId] = useState(() => {
    if (routeById(appState.profile?.activeRouteId)) return appState.profile.activeRouteId
    return routesForSubject(incomingContext.subjectId).find((route) => route.stage === 'AS')?.routeId
      || routesForSubject(incomingContext.subjectId)[0]?.routeId
      || 'cie-9702-as-physics'
  })
  const activeRoute = routeById(activeRouteId) || courseRoutes[0]
  const activeSubject = subjects.find((subject) => subject.routeIds?.includes(activeRoute.routeId)) || subjects[0]
  const [_subjectFilter, setSubjectFilter] = useState(() => activeSubject.id)
  const [completionFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [currentAttempt, setCurrentAttempt] = useState(null)
  const [resultAttempt, setResultAttempt] = useState(null)
  const [activePaper, setActivePaper] = useState(null)
  const [pendingSession, setPendingSession] = useState(null)
  const [coachOpenRequest, setCoachOpenRequest] = useState(0)
  const [sharedAccount, setSharedAccount] = useState({ status: 'loading', token: '', workspace: null, error: '' })
  const migrationAttemptedRef = useRef(false)
  const verifiedStarterUnits = useMemo(() => {
    try {
      return [buildCoachPractice({ routeId: 'cie-9702-as-physics', knowledgeGroupId: 'physics-9702-topic-03', questionCount: 10 })]
    } catch {
      return []
    }
  }, [])
  const visibleVerifiedUnits = useMemo(() => {
    const persisted = (appState.generatedUnits || []).filter((unit) => unit.agentGenerated && unit.parts?.length > 0 && unit.parts.every((part) => part.sourceKind === 'past-paper' && part.sourceRef?.sha256 && part.answerRef?.sha256 && part.answerBinding?.answerId))
    const labelled = [...persisted, ...verifiedStarterUnits.filter((starter) => !persisted.some((unit) => unit.focusedRetestOf !== starter.id && unit.knowledgeGroupId === starter.knowledgeGroupId && unit.routeId === starter.routeId))]
    return labelled.map((unit) => {
      const route = routeById(unit.routeId)
      return route && !String(unit.title || '').startsWith(`${route.stage} `)
        ? { ...unit, title: `${route.stage} ${route.subject} · ${unit.topic || unit.title}` }
        : unit
    })
  }, [appState.generatedUnits, verifiedStarterUnits])
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
    saveState(appState)
  }, [appState])

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
    const latestRetestCriterion = (sourceAttempt, partId) => [...appState.attempts].reverse().find((candidate) => {
      let parentId = candidate.retestOf
      while (parentId) {
        if (parentId === sourceAttempt.id) {
          return candidate.scoreResult?.criteria?.some((criterion) => criterion.partId === partId)
        }
        parentId = attemptById.get(parentId)?.retestOf
      }
      return false
    })?.scoreResult?.criteria?.find((criterion) => criterion.partId === partId)

    return appState.attempts.flatMap((attempt) => {
      const unit = allPracticeUnits.find((item) => item.id === attempt.unitId)
      if (!unit || unit.routeId !== activeRouteId || !attempt.scoreResult) return []
      return attempt.scoreResult.criteria
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
    setAppState((state) => ({
      ...state,
      notebookNotes: {
        ...(state.notebookNotes || {}),
        [activeRouteId]: {
          body: value,
          updatedAt: new Date().toISOString(),
        },
      },
    }))
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
    if (!route || route.stage !== draft.stage) throw new Error('Choose one valid IGCSE, AS or A2 route before publishing.')
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
        sourceScope: { routeId: route.routeId, stage: route.stage, questionIds: verifiedUnit.parts.map((part) => part.bankId), provenanceVersion: 'qp-ms-v2' },
      }),
    })
    const workspace = await requestSharedWorkspace(account.token)
    setSharedAccount((current) => ({ ...current, status: 'ready', workspace }))
    return result.assignment
  }

  function startAssignedAssignment(assignment) {
    const unit = buildCoachPractice({
      routeId: assignment.routeId,
      knowledgeGroupId: assignment.syllabusPointId,
      questionCount: assignment.sourceScope?.questionIds?.length || 10,
    })
    startPractice(unit, { assignmentId: assignment.id })
  }

  function startPractice(unit, options = {}) {
    if (!routeById(unit.routeId)) throw new Error('This question set is not bound to a current learning route.')
    selectRoute(unit.routeId)
    const sessionUnit = focusedRetestUnit(unit, options.onlyPartId)
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
        { unitId: sessionUnit.id, openedAt: new Date().toISOString() },
        ...(state.recentPractice || []).filter((item) => item.unitId !== sessionUnit.id),
      ].slice(0, 8),
    }))
    const draft = options.clearDraft ? null : appState.drafts[sessionUnit.id]
    setCurrentAttempt({
      id: makeAttemptId(),
      unitId: sessionUnit.id,
      routeId: sessionUnit.routeId,
      qualification: sessionUnit.qualification,
      courseStage: sessionUnit.stage,
      mode: sessionUnit.type,
      stage: sessionUnit.stage,
      attemptStatus: 'practice',
      startedAt: new Date().toISOString(),
      elapsedSec: draft?.elapsedSec || 0,
      durationSec: sessionUnit.durationSec,
      activePartId: draft?.activePartId || sessionUnit.parts[0].id,
      answers: migratePracticeAnswers(sessionUnit, draft),
      working: draft?.working || {},
      evidence: draft?.evidence || {},
      saveStatus: draft ? 'Restored draft' : 'Ready',
      retestOf: options.retestOf || null,
      assignmentId: options.assignmentId || null,
      settings: options.settings || draft?.settings || { mode: sessionUnit.type === 'paper' ? 'exam' : 'practice', timing: 'recommended', hints: true },
    })
    setPendingSession(null)
    setResultAttempt(null)
    setView('practice')
  }

  function openPaper(paper, routeOverride = activeRoute) {
    const paperNumber = paper.examProfile?.paperNumber == null ? null : Number(paper.examProfile.paperNumber)
    const routeMatches = String(paper.subject) === String(routeOverride.subjectCode)
      && (paperNumber == null || !Number.isFinite(paperNumber) || routeOverride.paperComponents.includes(paperNumber))
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
      const paper = latestBphoSpcPaper(paperCatalogState.catalog?.items || [])
      if (!paper) {
        return {
          handled: true,
          message: 'BPhO SPC 的本地 PDF 目录还没有加载好，或没有找到已配对的最新 QP/MS。请稍后再试。',
        }
      }
      const bphoRoute = routeById('bpho-admissions-physics')
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
        const matchingRoutes = routesForSubject(intent.subjectId).filter((route) => route.stage === intent.stage)
        if (matchingRoutes.length !== 1) {
          return { handled: true, message: 'Please choose the exact paper route first so the set cannot mix stages or component combinations.' }
        }
        const unit = generateCoachPractice({ ...intent, routeId: matchingRoutes[0].routeId })
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

  function exportLearningData() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...appState }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `alevel-studio-export-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
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

  async function submitAttempt() {
    if (!currentAttempt) return
    if (currentAttempt.submitting) return
    const attemptSnapshot = { ...currentAttempt, submitting: true }
    setCurrentAttempt(attemptSnapshot)
    const unit = allPracticeUnits.find((item) => item.id === currentAttempt.unitId)
    const deterministicScore = scoreAttempt(unit, attemptSnapshot.answers, attemptSnapshot.elapsedSec)
    const visionReviews = await requestVisionReviews(unit, attemptSnapshot)
    const scoreResult = mergeVisionScore(deterministicScore, unit, attemptSnapshot.answers, visionReviews)
    const assistedReview = reviewAttempt(unit, attemptSnapshot.answers, attemptSnapshot.working)
    const imageEvidence = Object.entries(attemptSnapshot.evidence || {}).filter(([, evidence]) => Boolean(evidence)).map(([partId, evidence]) => ({ partId, ...evidence }))
    const completedAttempt = {
      ...attemptSnapshot,
      submitting: false,
      routeId: unit.routeId,
      stage: unit.stage,
      attemptStatus: 'result',
      submittedAt: new Date().toISOString(),
      scoreResult,
      assistedReview,
      imageEvidence,
      visionReviews,
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
      .filter((attempt) => (attempt.attemptStatus === 'result' || attempt.stage === 'result') && attempt.routeId === unit.routeId && attempt.unitId === unit.id && Number.isFinite(attempt.scoreResult?.percentage))
      .map((attempt) => attempt.scoreResult.percentage)
    const masteryBefore = previousScores.length
      ? Math.round(previousScores.reduce((total, score) => total + score, 0) / previousScores.length)
      : null
    completedAttempt.learningSignal = {
      masteryBefore,
      masteryAfter: scoreResult.percentage,
      masteryDelta: masteryBefore == null ? null : scoreResult.percentage - masteryBefore,
    }

    if (attemptSnapshot.assignmentId && sharedAccount.status === 'ready') {
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

  const currentUnit = currentAttempt ? allPracticeUnits.find((unit) => unit.id === currentAttempt.unitId) : null
  const resultUnit = resultAttempt ? allPracticeUnits.find((unit) => unit.id === resultAttempt.unitId) : null

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
    <main className="app-shell">
      {view !== 'practice' && view !== 'paper' && <TopNav view={view} setView={setView} profile={appState.profile} openNotebook={() => setView('notebook')} openRoleWorkspace={() => setView('workspace')} openPractice={() => { setActiveTab('recommended'); setView('library') }} />}

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
          openNotebook={() => setView('notebook')}
          openRoleWorkspace={() => setView('workspace')}
        />
      )}

      {view === 'workspace' && <RoleWorkspace profile={appState.profile} updateProfile={updateProfile} assignments={sharedAccount.workspace?.assignments || []} classrooms={sharedAccount.workspace?.classrooms || []} submissions={sharedAccount.workspace?.submissions || []} serverSummaries={sharedAccount.workspace?.serverSummaries || {}} attempts={appState.attempts} learningProgress={learningProgress} account={sharedAccount} onRefreshAccount={refreshSharedAccount} onCreateClassroom={createClassroom} onJoinClassroom={joinClassroom} onCreateAssignment={createAssignment} onStartAssignedAssignment={startAssignedAssignment} />}

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
          setQuery={setQuery}
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
        <HistoryView
          attempts={routeAttempts}
          paperSessions={routePaperSessions}
          paperReviews={routePaperReviews}
          onRetest={startPractice}
          units={routePracticeUnits}
          onExport={exportLearningData}
        />
      )}

      {view === 'paper' && activePaper && paperCatalogState.catalog && (
        <Suspense fallback={<div className="paper-state workspace-loading"><span className="loading-line" />Loading the PDF study desk...</div>}>
          <PaperWorkspace
            paper={activePaper}
            catalog={paperCatalogState.catalog}
            draft={appState.paperDrafts[activePaper.pairKey || activePaper.id]}
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
          goBack={() => returnToLibrary('topics')}
        />
      )}

      {view === 'result' && resultUnit && resultAttempt && (
        <ResultView
          attempt={resultAttempt}
          unit={resultUnit}
          startPractice={startPractice}
          goLibrary={() => returnToLibrary('recommended')}
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
      {view !== 'practice' && view !== 'paper' && (
        <AiCoach
          key={`${view}:${resultAttempt?.id || 'general'}`}
          context={{
            attemptId: resultAttempt?.id,
            view,
            routeId: resultUnit?.routeId || activeRouteId,
            subject: activeSubject,
            stage: resultUnit?.stage || activeRoute.stage,
            question: resultAttempt && resultUnit ? {
              label: 'Latest result',
              prompt: resultUnit.parts.find((part) => part.id === resultAttempt.scoreResult.weakestPartId)?.prompt || resultUnit.title,
            } : null,
            response: resultAttempt && resultUnit ? resultAttempt.answers[resultAttempt.scoreResult.weakestPartId] || '' : '',
            submitted: view === 'result',
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
  return (
    <div className="setup-backdrop" role="presentation" onMouseDown={onCancel}>
      <section className="session-setup" role="dialog" aria-modal="true" aria-labelledby="setup-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="section-label">Session setup</p><h2 id="setup-title">{unit.title}</h2><p>{unit.topic} · {unit.parts.length} questions · {unit.maxMarks} marks</p></div><button type="button" className="setup-close" onClick={onCancel} aria-label="Close setup">×</button></header>
        <div className="setup-section"><span className="setup-label">How do you want to practise?</span><div className="mode-segments"><button type="button" className={session.mode === 'guided' ? 'active' : ''} onClick={() => onChange({ mode: 'guided', hints: true })}><Sparkles size={16} /><strong>Guided</strong><small>Hints available</small></button><button type="button" className={session.mode === 'practice' ? 'active' : ''} onClick={() => onChange({ mode: 'practice' })}><Dumbbell size={16} /><strong>Practice</strong><small>Independent set</small></button><button type="button" className={session.mode === 'exam' ? 'active' : ''} onClick={() => onChange({ mode: 'exam', timing: 'timed', hints: false })}><GraduationCap size={16} /><strong>Exam</strong><small>Answers hidden</small></button></div></div>
        <div className="setup-options"><label><span>Timing</span><select value={session.timing} onChange={(event) => onChange({ timing: event.target.value })}><option value="recommended">Recommended · {unit.estimatedMinutes} min</option><option value="timed">Strict timer</option><option value="untimed">Untimed</option></select></label><label className="toggle-row"><span><strong>Question hints</strong><small>Hints never reveal the final answer.</small></span><input type="checkbox" checked={session.hints} disabled={session.mode === 'exam'} onChange={(event) => onChange({ hints: event.target.checked })} /></label></div>
        <div className="setup-summary"><ListFilter size={18} /><div><strong>{unit.parts.length} questions ready</strong><span>{isPaper ? 'Mixed paper practice' : `${unit.subtopic || unit.topic} knowledge drill`} · autosave on</span></div></div>
        <footer><button type="button" className="secondary-action" onClick={onCancel}>Cancel</button><button type="button" className="primary-action" onClick={onStart}><PlayIcon />Start session</button></footer>
      </section>
    </div>
  )
}

function TopNav({ view, setView, profile, openNotebook, openRoleWorkspace, openPractice }) {
  const [campusOpen, setCampusOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const learnerName = String(profile?.learnerName || 'Student').trim() || 'Student'
  const firstName = learnerName.split(/\s+/)[0]
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
        <button className={view === 'library' || view === 'topic' ? 'active' : ''} type="button" onClick={openPractice}>
          <Dumbbell size={17} />
          Practice
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
      <div className="nav-context"><a className="vocabulary-link" href="https://ieltsist.com/?from=stem&focus=language#vocabulary" target="_blank" rel="noreferrer"><Brain size={15} />Terms</a><button type="button" className="notification-button" aria-label="Notifications"><span /></button><div className="account-menu"><button type="button" className="account-trigger" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}><span className="account-avatar">{firstName.slice(0, 1).toUpperCase()}</span><span>{learnerName}</span><ChevronRight size={14} /></button>{accountOpen && <div className="account-popover"><strong>{learnerName}</strong><small>IELTSist Account</small><div><span>Student</span><b>STEM</b></div><a href="https://ieltsist.com/" target="_blank" rel="noreferrer">Open IELTS campus <ChevronRight size={14} /></a><button type="button" onClick={() => { openRoleWorkspace(); setAccountOpen(false) }}>Teacher &amp; school workspace <ChevronRight size={14} /></button></div>}</div></div>
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
}) {
  const verifiedAttempts = attempts.filter((attempt) => completionByUnit[attempt.unitId])
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
          {mistakes.length ? <div className="feedback-list">{mistakes.slice(0, 3).map((mistake) => <div className="feedback-row" key={mistake.id}><span className="feedback-icon"><Flag size={15} /></span><div><strong>{mistake.part.label} · {mistake.unit.topic}</strong><small>{mistake.criterion.feedback}</small></div><ChevronRight size={16} /></div>)}</div> : <div className="feedback-empty"><CheckCircle2 size={22} /><strong>No weak points yet</strong><span>Submit a set and your mark points will appear here.</span></div>}
        </section>
      </div>

      <section className="study-principle"><div className="principle-icon"><Sparkles size={18} /></div><div><strong>Feedback is the lesson.</strong><p>Every answer is stored with its working. After submission, review the exact mark point you missed and retest the same idea with a new attempt.</p></div></section>
    </section>
  )
}

/* oxlint-enable no-unused-vars */
function StudentDashboard({ activeRoute, routeOptions, selectRoute, profile, attempts, completionByUnit, recommendation, topicMastery, mistakes, paperMistakes, startPractice, setView, setActiveTab, setSubjectFilter, setQuery, allPracticeUnits, recentPractice, favoriteUnitIds, openNotebook, learningProgress, syllabusRoadmap }) {
  const nextUnit = recommendation.unit
  const latest = attempts.filter((attempt) => completionByUnit[attempt.unitId]).at(-1)
  const average = latest ? Math.round(attempts.filter((attempt) => completionByUnit[attempt.unitId]).reduce((total, attempt) => total + attempt.scoreResult.percentage, 0) / attempts.filter((attempt) => completionByUnit[attempt.unitId]).length) : null
  const weeklyPercent = Math.min(100, Math.round((learningProgress.week.completedQuestions / learningProgress.week.targetQuestions) * 100))
  const goalComplete = learningProgress.week.completedQuestions >= learningProgress.week.targetQuestions
  const unitById = new Map(allPracticeUnits.map((unit) => [unit.id, unit]))
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
        <label className="student-course-picker"><span>Current course</span><select aria-label="Current course" value={activeRoute.routeId} onChange={(event) => selectRoute(event.target.value)}>{routeOptions.map((route) => <option value={route.routeId} key={route.routeId}>{routePickerLabel(route)}</option>)}</select></label>
      </header>

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
  setQuery,
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
  const routeOptions = courseRoutes.filter((route) => route.qualification === activeRoute.qualification)
  return (
    <section className="practice-hub page-band">
      <header className="practice-hub__header">
        <div>
          <p className="section-label">Practice</p>
          <h1>Choose how you want to improve.</h1>
          <p className="practice-hub__intro">Start with a recommendation, focus on one syllabus topic, or work through a Cambridge paper.</p>
        </div>
        <div className="practice-hub__controls">
          <label><span>Current course</span><select aria-label="Current course" value={activeRoute.routeId} onChange={(event) => selectRoute(event.target.value)}>{routeOptions.map((route) => <option value={route.routeId} key={route.routeId}>{routePickerLabel(route)}</option>)}</select></label>
          <label className="practice-hub__search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this course" aria-label="Search this course" /></label>
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

function TopicDetail({ activeRoute, activeRouteId, topicId, practiceOptions, learningProgress, mistakes, startKnowledgeDrill, onBack, onOpenCoach }) {
  const [startError, setStartError] = useState('')
  const routeOption = practiceOptions.find((option) => option.routeId === activeRouteId)
  const topic = routeOption?.topics.find((item) => item.id === topicId)
  const metadata = topicMetadata(topicId)
  const progress = learningProgress.topicProgress.find((item) => item.id === topicId || String(item.id || '').split('@')[0] === String(topicId).split('@')[0])
  const mastery = progress?.mastery ?? null
  const available = topic?.inventory || 0
  const questionCount = Math.min(10, available)
  const topicMistakes = mistakes.filter((mistake) => mistake.unit.knowledgeGroupId === topicId).length

  function startTopicPractice() {
    try {
      setStartError('')
      startKnowledgeDrill({ routeId: activeRouteId, knowledgeGroupId: topicId, questionCount: Math.max(10, questionCount), allowPartial: true })
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
          <section className="topic-detail__concepts"><header><div><p className="section-label">Concepts</p><h2>What you will practise</h2></div></header><div>{(metadata?.themes?.length ? metadata.themes : ['Choose the correct method', 'Show complete working', 'Check units and conclusion']).map((theme, index) => <div key={theme}><span>{String(index + 1).padStart(2, '0')}</span><strong>{theme}</strong><small>{index === 0 && mastery != null && mastery < 70 ? 'Recommended focus' : mastery == null ? 'Not assessed yet' : 'Included in this set'}</small></div>)}</div></section>
          <section className="topic-detail__source"><FileText size={20} /><div><strong>Verified source questions</strong><p>Questions and answers stay paired with their original paper. No cross-stage items and no unverified generated questions.</p></div><span>{available} available</span></section>
        </main>
        <aside className="topic-detail__start"><p className="section-label">Next session</p><h2>{questionCount || 0} question{questionCount === 1 ? '' : 's'}</h2><ul><li>About {Math.max(10, questionCount * 3)} minutes</li><li>AI marking after submit</li><li>{topicMistakes ? `${topicMistakes} mistake${topicMistakes === 1 ? '' : 's'} linked` : 'Hints available in practice mode'}</li></ul>{available > 0 ? <button type="button" className="primary-action" onClick={startTopicPractice}><PlayIcon />Practice {questionCount} question{questionCount === 1 ? '' : 's'}</button> : <button type="button" className="primary-action" disabled>Still indexing this topic</button>}<button type="button" className="topic-detail__ai" onClick={onOpenCoach}><Sparkles size={16} />Ask AI Tutor about this topic</button>{startError && <p className="topic-detail__error" role="alert">{startError}</p>}</aside>
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
      <div><p className="section-label">Syllabus practice</p><h2>{activeRoute.stage} {activeRoute.subject} · choose a syllabus topic.</h2><p>All drills are restricted to this route. Each question remains bound to its original question paper and exact mark scheme.</p><div className="knowledge-links">{activeRoute.syllabus.url && <a className="syllabus-link" href={activeRoute.syllabus.url} target="_blank" rel="noreferrer">Cambridge {activeRoute.subjectCode} official syllabus <ChevronRight size={14} /></a>}<a className="syllabus-link" href="https://ieltsist.com/?from=stem&focus=language#vocabulary" target="_blank" rel="noreferrer">Professional terms <ChevronRight size={14} /></a></div></div>
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
      return <article className="knowledge-row" key={topic.id}><div className="knowledge-stage"><span>{status}</span><small>{activeRoute.stage}</small><div className="mini-progress"><i style={{ width: `${percentage < 0 ? 4 : percentage}%` }} /></div></div><div className="knowledge-copy"><h3>{topic.label}</h3><p>{metadata?.description || `${activeRoute.syllabus.board} syllabus topic.`}</p><div className="knowledge-themes">{(metadata?.themes || []).slice(0, 5).map((theme) => <span key={theme}>{theme}</span>)}</div><div className="knowledge-source-preview"><span className={available ? available < 10 ? 'partial' : 'ready' : 'not-ready'}><strong>{activeRoute.stage}</strong>{available} verified</span></div></div><div className="knowledge-action"><strong>{percentage < 0 ? `${available} verified questions` : `${percentage}% best`}</strong><button type="button" className="card-action" disabled={!available} onClick={() => startDrill(topic, units[0])}>{available ? `Build ${activeRoute.stage} drill · ${Math.min(10, available)} questions` : 'No source indexed'}<ChevronRight size={15} /></button><button type="button" className="text-action" onClick={() => openPapers(appSubject?.id || 'all')}>Open {activeRoute.subjectCode} papers</button></div></article>
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

function StudentNotebook({ activeRoute, routeOptions, selectRoute, attempts, units, mistakes, paperMistakes, note, onChangeNote, startPractice, retestPaper, openPractice }) {
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState('all')
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const search = query.trim().toLowerCase()
  const filteredMistakes = mistakes.filter((mistake) => {
    const searchable = `${mistake.unit.title} ${mistake.unit.topic} ${mistake.part.label} ${mistake.criterion.feedback}`.toLowerCase()
    return (!search || searchable.includes(search)) && (severity === 'all' || mistake.severity.toLowerCase() === severity)
  })
  const filteredPaperMistakes = paperMistakes.filter((mistake) => !search || `${mistake.session.file} ${mistake.status}`.toLowerCase().includes(search))
  const recentAttempts = [...attempts].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)).slice(0, 4)
  const savedNote = note?.body || ''

  return (
    <section className="notebook-view page-band">
      <header className="notebook-header">
        <div>
          <p className="section-label">Notebook</p>
          <h1>Turn mistakes into your next marks.</h1>
          <p className="page-intro">Review open mark points, keep a private route note, and retest without replacing the original attempt.</p>
        </div>
        <label className="notebook-route"><span>Current route</span><select value={activeRoute.routeId} onChange={(event) => selectRoute(event.target.value)}>{routeOptions.map((route) => <option value={route.routeId} key={route.routeId}>{routePickerLabel(route)}</option>)}</select></label>
      </header>

      <div className="notebook-summary" aria-label="Notebook summary">
        <div><strong>{mistakes.length + paperMistakes.length}</strong><span>open items</span></div>
        <div><strong>{mistakes.filter((item) => item.severity === 'High').length}</strong><span>high priority</span></div>
        <div><strong>{recentAttempts.length}</strong><span>recent results</span></div>
      </div>

      <div className="notebook-layout">
        <section className="notebook-queue">
          <header className="notebook-section-heading"><div><p className="section-label">Review queue</p><h2>What needs another look</h2></div><button type="button" className="secondary-action compact-action" onClick={openPractice}><Dumbbell size={16} />Find practice</button></header>
          <div className="notebook-filters"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mistakes" aria-label="Search notebook mistakes" /></label><label><span>Priority</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option></select></label></div>
          {filteredMistakes.length || filteredPaperMistakes.length ? <div className="notebook-mistake-list">
            {filteredMistakes.map((mistake) => {
              const response = mistake.attempt.answers?.[mistake.part.id] || mistake.attempt.working?.[mistake.part.id] || 'No typed response saved'
              const missedPoints = mistake.criterion.evidence?.filter((point) => !point.awarded) || []
              return <article className="notebook-mistake" key={mistake.id}><header><span className={`status-pill danger ${mistake.severity.toLowerCase()}`}>{mistake.severity} priority</span><span>{mistake.status}</span></header><h3>{mistake.unit.title} - part {mistake.part.label}</h3><p className="notebook-mistake__topic">{mistake.unit.topic} - {mistake.part.marks} marks - {formatDate(mistake.attempt.submittedAt)}</p><p>{mistake.criterion.feedback}</p><details><summary>Review your response and missed points</summary><div className="notebook-evidence-copy"><strong>Your response</strong><pre>{response}</pre>{missedPoints.length > 0 && <><strong>Mark points to add next time</strong><ul>{missedPoints.map((point) => <li key={point.pointId}>{point.point}</li>)}</ul></>}</div></details><footer><span>{mistake.criterion.awarded}/{mistake.criterion.maxMarks} marks</span><button type="button" className="primary-action compact-action" onClick={() => startPractice(mistake.unit, { clearDraft: true, retestOf: mistake.attempt.id, onlyPartId: mistake.part.id })}><RefreshCcw size={15} />Retest this part</button></footer></article>
            })}
            {filteredPaperMistakes.map((mistake) => <article className="notebook-mistake" key={mistake.id}><header><span className="status-pill danger">Paper review</span><span>{mistake.status}</span></header><h3>{mistake.session.file} - question {mistake.questionNumber}</h3><p className="notebook-mistake__topic">{mistake.paper.subject} - {formatDate(mistake.session.completedAt)}</p><p>{mistake.status === 'Blank response' ? 'No final response was submitted for this printed question.' : 'Compare your response with the exact mark scheme and record the awarded marks.'}</p><footer><span>{mistake.awarded == null ? 'Not self-marked' : `${mistake.awarded}/${mistake.maxMarks} marks`}</span><button type="button" className="primary-action compact-action" onClick={() => retestPaper(mistake.paper, mistake.session.attemptId)}><RefreshCcw size={15} />Retest paper</button></footer></article>)}
          </div> : <div className="empty-state notebook-empty"><CheckCircle2 size={28} /><h2>{search || severity !== 'all' ? 'No notebook items match' : 'Your review queue is clear'}</h2><p>{search || severity !== 'all' ? 'Try a different search or priority.' : 'Complete a practice set and missed mark points will be saved here.'}</p>{(search || severity !== 'all') && <button type="button" className="secondary-action" onClick={() => { setQuery(''); setSeverity('all') }}>Clear filters</button>}</div>}
        </section>

        <aside className="notebook-side">
          <section className="notebook-note-tool"><header><div><p className="section-label">Private note</p><h2>What will you remember?</h2></div><BookOpen size={18} /></header><textarea value={savedNote} onChange={(event) => onChangeNote(event.target.value)} placeholder="Write a short method, formula, or reminder for this route..." aria-label="Private route notebook note" /><small>{note?.updatedAt ? `Saved locally ${formatDate(note.updatedAt)}` : 'Saved locally for this route'}</small></section>
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
            <h2>{mistake.unit.title} · part {mistake.part.label}</h2>
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

function ResultView({ attempt, unit, startPractice, goLibrary }) {
  const result = attempt.scoreResult
  const assisted = attempt.assistedReview
  const weakest = result.weakestPartId ? unit.parts.find((part) => part.id === result.weakestPartId) : null
  const answeredParts = unit.parts.filter((part) => Boolean(String(attempt.answers?.[part.id] || attempt.working?.[part.id] || '').trim()) || Boolean(attempt.evidence?.[part.id])).length
  const assessmentState = answeredParts ? (result.percentage >= 80 ? 'Secure' : result.percentage >= 50 ? 'In progress' : 'Needs review') : 'Not assessed'
  const assessmentCopy = answeredParts ? `${answeredParts}/${unit.parts.length} responses submitted` : 'No answer evidence was submitted'
  const stemReturnUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/?from=ieltsist&focus=${encodeURIComponent(unit.subjectId || '')}&return_attempt=${encodeURIComponent(attempt.id)}`
  const termsUrl = `https://ieltsist.com/?from=stem&focus=language&subject=${encodeURIComponent(unit.code || unit.board || '')}&topic=${encodeURIComponent(unit.topic || '')}&term_ids=${encodeURIComponent((weakest?.topicTags || []).join(','))}&return_to=${encodeURIComponent(stemReturnUrl)}#vocabulary`

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
            <Library size={18} />
            Back to library
          </button>
        </div>
      </div>

      <section className="result-learning-signal" aria-label="Mastery change">
        <div><p className="section-label">Learning signal</p><h2>What changed after this attempt</h2><p>{attempt.learningSignal?.masteryBefore == null ? 'This is the first verified result for this set. Keep the evidence and compare it after your retest.' : 'The change is based on your prior submitted attempts for this same verified set.'}</p></div>
        <div className="mastery-delta"><span>Mastery</span><strong>{attempt.learningSignal?.masteryBefore == null ? `${result.percentage}%` : `${attempt.learningSignal.masteryBefore}% → ${attempt.learningSignal.masteryAfter}%`}</strong><small className={attempt.learningSignal?.masteryDelta > 0 ? 'up' : attempt.learningSignal?.masteryDelta < 0 ? 'down' : ''}>{attempt.learningSignal?.masteryDelta == null ? 'Baseline recorded' : `${attempt.learningSignal.masteryDelta > 0 ? '+' : ''}${attempt.learningSignal.masteryDelta}% from your previous average`}</small></div>
        <a className="terms-recommendation" href={termsUrl} target="_blank" rel="noreferrer"><Brain size={18} /><span><strong>Professional terms for this question</strong><small>{(weakest?.topicTags || [unit.topic]).slice(0, 3).join(' · ')}</small></span><ChevronRight size={16} /></a>
      </section>

      {assisted && (
        <section className="ai-review-summary">
          <header><span className="ai-review-icon"><Sparkles size={19} /></span><div><p className="section-label">Process review</p><h2>{assisted.overallLabel}</h2><p>Objective typed answers use deterministic checks. Handwriting marks are AI-assisted suggestions with confidence and review status, not an official Cambridge decision.</p></div><div className="confidence-meter"><span>Confidence</span><strong>{Math.round(assisted.confidence * 100)}%</strong></div></header>
          <div className="ai-review-grid"><div><span className="review-label secure">What worked</span>{assisted.strengths.length ? <ul>{assisted.strengths.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : <p>No secure evidence yet.</p>}</div><div><span className="review-label gap">Marks still available</span>{assisted.gaps.length ? <ul>{assisted.gaps.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : <p>No missing mark points detected.</p>}</div><div><span className="review-label next">Do this next</span><p>{assisted.nextStep}</p>{assisted.suggestedRetest.recommended && <button type="button" className="text-action" onClick={() => startPractice(unit, { clearDraft: true, retestOf: attempt.id })}>Build focused retest <ChevronRight size={15} /></button>}</div></div>
          {attempt.imageEvidence?.length > 0 && <div className="image-evidence-review"><div><strong>Handwritten responses</strong><span>{attempt.imageEvidence.length} response image{attempt.imageEvidence.length === 1 ? '' : 's'} saved with this attempt. Configured vision results are shown beside each question below.</span></div>{attempt.imageEvidence.map((evidence) => <figure key={evidence.partId}><img src={evidence.dataUrl} alt={`Handwritten response for part ${evidence.partId}`} /><figcaption>Part {unit.parts.find((part) => part.id === evidence.partId)?.label || evidence.partId}</figcaption></figure>)}</div>}
        </section>
      )}

      <section className="result-next-step" aria-label="Next study step"><div><p className="section-label">Next step</p><h2>Turn this feedback into another attempt</h2><p>{weakest ? `Revisit ${weakest.topic || unit.topic}, then retest the specific mark point you missed.` : 'Keep the method active with a short retest and the related professional terms.'}</p></div><div className="result-next-actions"><button type="button" className="primary-action" onClick={() => startPractice(unit, { clearDraft: true, retestOf: attempt.id })}><RefreshCcw size={17} />Retest this idea</button><a className="secondary-action" href={termsUrl} target="_blank" rel="noreferrer"><Brain size={17} />Review professional terms</a></div></section>

      <div className="result-grid">
        <section className="wide-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Evidence</p>
              <h2>{weakest ? `Weakest part: ${weakest.label}` : 'All seed checks secure'}</h2>
            </div>
            <strong>{result.percentage}%</strong>
          </div>
          <div className="criteria-list">
            {result.criteria.map((criterion, criterionIndex) => {
              const part = unit.parts.find((item) => item.id === criterion.partId)
              const assistedPart = assisted?.parts?.[criterionIndex]
              const visionPart = attempt.visionReviews?.[criterion.partId]
              return (
                <article className="criterion" key={criterion.partId}>
                  <div>
                    <h3>Part {part.label}: {criterion.awarded}/{criterion.maxMarks}</h3>
                    <p>{criterion.feedback}</p>
                    <div className="student-submission">
                      <span>Your response</span>
                      <strong>{attempt.answers[part.id] || (attempt.evidence?.[part.id] ? 'Handwritten response submitted' : 'No answer submitted')}</strong>
                      {attempt.working?.[part.id] && !attempt.answers[part.id] && <pre>{attempt.working[part.id]}</pre>}
                    </div>
                    {visionPart?.status === 'success' && <div className="vision-result-inline"><header><Sparkles size={14} /><strong>Handwriting review: {visionPart.rawMarks}/{visionPart.maxMarks}</strong><span>{Math.round(visionPart.confidence * 100)}% confidence{visionPart.reviewRequired ? ' · check required' : ''}</span></header>{visionPart.recognizedWork && <p>{visionPart.recognizedWork}</p>}{visionPart.correctedSolution && <details><summary>Correction</summary><p>{visionPart.correctedSolution}</p></details>}</div>}
                    {visionPart?.status === 'unconfigured' && <p className="vision-result-inactive">AI handwriting marking was not configured; this image is saved for manual review.</p>}
                    {visionPart?.status === 'error' && <p className="vision-result-inactive">{visionPart.error}</p>}
                    {part.sourceRef?.markSchemeUrl && <a className="mark-scheme-link" href={part.sourceRef.markSchemeUrl} target="_blank" rel="noreferrer">Open exact mark scheme for {part.sourceRef.question}</a>}
                    {part.answerRef && <div className="official-answer"><header><strong>Official mark scheme</strong><a className="mark-scheme-link" href={part.answerRef.localUrl} target="_blank" rel="noreferrer">Open {part.answerRef.file}</a></header>{part.answerRef.assetUrls?.map((url) => <img src={url} alt={`${part.answerRef.file}, answer for ${part.sourceRef?.question}`} loading="lazy" key={url} />)}{part.exactAnswer && <details><summary>Extracted mark-scheme text</summary><p>{part.exactAnswer}</p></details>}</div>}
                  </div>
                  <div className="mark-points">
                    {criterion.evidence.map((point) => (
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
              <dd>{result.schemaVersion}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{Math.round(result.confidence * 100)}%</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  )
}

export default App
