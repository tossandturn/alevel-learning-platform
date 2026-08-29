import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { courseRoutes, routeForStageDeepLink } from '../src/data/routeRegistry.js'
import { studentNavigationFromLocation, studentNavigationHref } from '../src/lib/studentNavigation.js'

const href = studentNavigationHref({
  view: 'practice',
  routeId: 'cie-0580-igcse-mathematics',
  stage: 'IGCSE',
  course: '0580',
  unitId: 'verified-cie-0580-number-set-1',
  attemptId: 'att_private_123',
  partId: 'q1',
  mode: 'practice',
})

assert.equal(href, '/attempt?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580&unitId=verified-cie-0580-number-set-1&attemptId=att_private_123&partId=q1&mode=practice')
assert.deepEqual(studentNavigationFromLocation(`https://stem.ieltsist.com${href}`), {
  view: 'practice',
  routeId: 'cie-0580-igcse-mathematics',
  stage: 'IGCSE',
  course: '0580',
  tab: 'recommended',
  topicId: '',
  unitId: 'verified-cie-0580-number-set-1',
  paperId: '',
  attemptId: 'att_private_123',
  partId: 'q1',
  mode: 'practice',
  paperMode: '',
  coach: false,
})
assert.equal(studentNavigationHref({ view: 'notebook', routeId: 'cie-9702-as-physics', stage: 'AS', course: '9702' }), '/notebook?routeId=cie-9702-as-physics&stage=AS&course=9702')
assert.equal(studentNavigationHref({ view: 'library', routeId: 'cie-0580-igcse-mathematics', stage: 'IGCSE', course: '0580', tab: 'papers' }), '/papers?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580')
assert.deepEqual(studentNavigationFromLocation('https://stem.ieltsist.com/papers?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580'), {
  view: 'library',
  routeId: 'cie-0580-igcse-mathematics',
  stage: 'IGCSE',
  course: '0580',
  tab: 'papers',
  topicId: '',
  unitId: '',
  paperId: '',
  attemptId: '',
  partId: '',
  mode: '',
  paperMode: '',
  coach: false,
}, 'the paper library must have a shareable, refresh-safe route distinct from a paper attempt')
assert.equal(studentNavigationHref({ view: 'paper', routeId: 'cie-0580-igcse-mathematics', stage: 'IGCSE', course: '0580', paperId: 'cie-0580-0580_m25_qp_12', attemptId: 'paper-attempt-1', paperMode: 'exam-simulation' }), '/papers?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580&paperId=cie-0580-0580_m25_qp_12&attemptId=paper-attempt-1&paperMode=exam-simulation')
assert.equal(studentNavigationFromLocation('https://stem.ieltsist.com/papers?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580&paperId=paper-1&paperMode=exam-simulation').paperMode, 'exam-simulation')
assert.equal(studentNavigationFromLocation('https://stem.ieltsist.com/?routeId=cie-9702-as-physics').view, 'dashboard', 'the legacy root URL remains a valid dashboard link')
assert.equal(studentNavigationHref({ view: 'result', attemptId: 'att-1', routeId: 'bad route with spaces' }), '/result?attemptId=att-1', 'invalid query data must not enter shareable URLs')
assert.equal(
  routeForStageDeepLink({ stage: 'A2', preferredRouteId: 'cie-9702-as-physics', routes: courseRoutes })?.routeId,
  'cie-9702-a2-physics',
  'an A2 deep link must resolve to an A2 route instead of keeping the AS default',
)
assert.equal(
  routeForStageDeepLink({ stage: 'IGCSE', preferredRouteId: 'cie-9702-as-physics', routes: courseRoutes })?.stage,
  'IGCSE',
  'an IGCSE deep link must resolve away from the AS default route',
)
assert.equal(
  routeForStageDeepLink({ stage: 'IGCSE', subjectId: '0625', routes: courseRoutes })?.routeId,
  'cie-0625-igcse-physics',
  'the IGCSE Physics deep link must resolve to the canonical 0625 route',
)
assert.equal(
  routeForStageDeepLink({ stage: 'AS', subjectId: '9702', routes: courseRoutes })?.routeId,
  'cie-9702-as-physics',
  'the AS Physics deep link must resolve to the canonical 9702 AS route',
)
assert.equal(
  routeForStageDeepLink({ stage: 'A2', subjectId: '9702', routes: courseRoutes })?.routeId,
  'cie-9702-a2-physics',
  'the A2 Physics deep link must resolve to the canonical 9702 A2 route',
)
assert.equal(studentNavigationFromLocation('https://stem.ieltsist.com/notebook?routeId=cie-0580-igcse-mathematics&answer=secret&note=private').attemptId, '', 'only documented safe navigation identifiers may be parsed from notebook URLs')
assert.equal(studentNavigationFromLocation('https://stem.ieltsist.com/workspace').view, 'dashboard', 'teacher and school workspace must not be a student route')
assert.equal(studentNavigationHref({ view: 'workspace', routeId: 'cie-0580-igcse-mathematics' }), '/today?routeId=cie-0580-igcse-mathematics', 'workspace navigation must fall back to the student dashboard')
assert.equal(studentNavigationHref({ view: 'dashboard', routeId: 'cie-9702-as-physics', stage: 'AS', course: '9702', coach: true }), '/today?routeId=cie-9702-as-physics&stage=AS&course=9702&coach=1', 'the dashboard must preserve an explicit AI Coach deep link')
assert.deepEqual(studentNavigationFromLocation('https://stem.ieltsist.com/today?routeId=cie-9702-as-physics&stage=AS&course=9702&coach=1'), {
  view: 'dashboard',
  routeId: 'cie-9702-as-physics',
  stage: 'AS',
  course: '9702',
  tab: 'recommended',
  topicId: '',
  unitId: '',
  paperId: '',
  attemptId: '',
  partId: '',
  mode: '',
  paperMode: '',
  coach: true,
}, 'the dashboard must restore the AI Coach deep link from the URL')

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const historySource = readFileSync(new URL('../src/components/HistoryView.jsx', import.meta.url), 'utf8')
assert.doesNotMatch(
  appSource,
  /private from teachers and schools|with teacher support/,
  'student-facing copy must not advertise teacher or school features while those product surfaces are hidden',
)
assert.match(
  appSource,
  /if \(currentHref === navigationHref\) \{\s*navigationInitializedRef\.current = true\s*return\s*\}/,
  'an initial deep link must initialize history before the first in-app navigation so Back returns to that deep link',
)
assert.match(
  appSource,
  /window\.addEventListener\('hashchange', restoreLocation\)/,
  'student navigation must restore state when legacy hash links or vocabulary return fragments change',
)
assert.match(
  appSource,
  /navigationRestorePendingRef/,
  'paper deep links must retry restoration after the paper catalog finishes loading',
)
assert.match(
  appSource,
  /\.filter\(\(unit\) => unit\.agentGenerated \|\| unit\.focusedRetestOf \|\| unit\.sourceAuthority === 'server-syllabus'\)/,
  'a current server-syllabus AI Practice set must remain a restoration candidate after refresh',
)
assert.match(
  appSource,
  /navigation\.view === 'paper' && paperCatalogState\.status === 'loading'/,
  'paper restoration must wait for catalog readiness instead of falling back to the library',
)
assert.match(
  appSource,
  /if \(navigationRestorePendingRef\.current\) return/,
  'URL synchronization must not erase a deep link while its paper catalog is loading',
)
assert.match(
  appSource,
  /routeForStageDeepLink\(\{\s*stage: navigation\.stage,\s*subjectId: navigation\.course/,
  'stage/course deep links must resolve through the canonical route helper during history restoration',
)
assert.match(
  appSource,
  /isPendingSelfMarkAttempt\(attempt\) \|\| isProvisionalAttempt\(attempt, unit\) \|\| isStudyOnlyAttempt\(attempt, unit\) \|\| isScoredAttempt\(attempt, unit\)/,
  'a partial result must remain addressable by its result URL after refresh',
)
assert.match(
  historySource,
  /isProvisionalAttempt\(attempt, unit\)/,
  'History must retain partial results as read-only attempt evidence without promoting them to a scored result',
)

console.log('Student History API navigation contract checks passed')
