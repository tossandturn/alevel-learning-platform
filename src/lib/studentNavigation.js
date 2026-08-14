const VIEW_PATHS = Object.freeze({
  dashboard: '/today',
  library: '/practice',
  topic: '/practice/topic',
  history: '/progress',
  notebook: '/notebook',
  workspace: '/workspace',
  practice: '/attempt',
  result: '/result',
  paper: '/papers',
})

const PATH_VIEWS = new Map(Object.entries(VIEW_PATHS).map(([view, path]) => [path, view]))
const SAFE_VALUE = /^[A-Za-z0-9._:@-]{1,320}$/
const SAFE_TAB = new Set(['recommended', 'ai-practice', 'topics', 'papers', 'exams', 'mistakes', 'saved'])
const SAFE_PAPER_MODES = new Set(['past-paper-practice', 'exam-simulation'])

function safeValue(value, fallback = '') {
  const text = String(value || '').trim()
  return SAFE_VALUE.test(text) ? text : fallback
}

function safeStage(value) {
  const stage = String(value || '').trim()
  return ['IGCSE', 'AS', 'A2', 'Competition', 'Admissions'].includes(stage) ? stage : ''
}

export function studentNavigationFromLocation(href = typeof window === 'undefined' ? 'https://stem.ieltsist.com/' : window.location.href) {
  let url
  try {
    url = new URL(href, 'https://stem.ieltsist.com/')
  } catch {
    return { view: 'dashboard', routeId: '', stage: '', course: '', tab: 'recommended', topicId: '', unitId: '', paperId: '', attemptId: '', partId: '', mode: '', paperMode: '' }
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const paperId = safeValue(url.searchParams.get('paperId'))
  const view = pathname === '/papers' && !paperId
    ? 'library'
    : PATH_VIEWS.get(pathname) || 'dashboard'
  const tab = String(url.searchParams.get('tab') || '')
  return {
    view,
    routeId: safeValue(url.searchParams.get('routeId')),
    stage: safeStage(url.searchParams.get('stage')),
    course: safeValue(url.searchParams.get('course')),
    tab: pathname === '/papers' && !paperId ? 'papers' : SAFE_TAB.has(tab) ? tab : 'recommended',
    topicId: safeValue(url.searchParams.get('topicId')),
    unitId: safeValue(url.searchParams.get('unitId')),
    paperId,
    attemptId: safeValue(url.searchParams.get('attemptId')),
    partId: safeValue(url.searchParams.get('partId')),
    mode: safeValue(url.searchParams.get('mode')),
    paperMode: SAFE_PAPER_MODES.has(url.searchParams.get('paperMode')) ? url.searchParams.get('paperMode') : '',
  }
}

export function studentNavigationHref(state = {}) {
  const view = Object.hasOwn(VIEW_PATHS, state.view) ? state.view : 'dashboard'
  const params = new URLSearchParams()
  const append = (key, value) => {
    const normalized = safeValue(value)
    if (normalized) params.set(key, normalized)
  }
  append('routeId', state.routeId)
  const stage = safeStage(state.stage)
  if (stage) params.set('stage', stage)
  append('course', state.course)
  const libraryTab = SAFE_TAB.has(state.tab) ? state.tab : 'recommended'
  if (view === 'library' && libraryTab !== 'papers') params.set('tab', libraryTab)
  append('topicId', state.topicId)
  append('unitId', state.unitId)
  append('paperId', state.paperId)
  append('attemptId', state.attemptId)
  append('partId', state.partId)
  append('mode', state.mode)
  if (view === 'paper' && SAFE_PAPER_MODES.has(state.paperMode)) params.set('paperMode', state.paperMode)
  const query = params.toString()
  const pathname = view === 'library' && libraryTab === 'papers' ? '/papers' : VIEW_PATHS[view]
  return `${pathname}${query ? `?${query}` : ''}`
}
