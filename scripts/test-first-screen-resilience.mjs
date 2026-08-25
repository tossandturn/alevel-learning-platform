import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.jsx'), 'utf8')
const bootRecoverySource = fs.readFileSync(path.join(root, 'src', 'lib', 'bootRecovery.js'), 'utf8')
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
const questionSearchSource = fs.readFileSync(path.join(root, 'src', 'lib', 'questionSearch.js'), 'utf8')
const studyRuntimeSource = fs.readFileSync(path.join(root, 'src', 'lib', 'studyQuestionRuntime.js'), 'utf8')
const indexHtmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const indexCssSource = fs.readFileSync(path.join(root, 'src', 'index.css'), 'utf8')
const verifiedRuntimeSource = fs.readFileSync(path.join(root, 'src', 'lib', 'verifiedPracticeCatalog.js'), 'utf8')
const packageSource = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const { validateSyllabusInventoryPayload } = await import('../src/hooks/useSyllabusInventory.js')
const { stableSorted } = await import('../src/lib/arrayOrder.js')
const { sourceBindingSnapshotForUnit } = await import('../src/lib/attemptAudit.js')

function sourceFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(entryPath)
    return /\.(?:js|jsx)$/.test(entry.name) ? [entryPath] : []
  })
}

assert.match(indexHtmlSource, /id="boot-fallback"/, 'the HTML shell must contain a visible fallback before JavaScript runs')
assert.match(indexHtmlSource, /STEM Studio/, 'the no-JavaScript fallback must identify the product')
assert.match(indexHtmlSource, /position:\s*fixed/, 'the boot fallback must cover the viewport while React is unavailable')
assert.match(mainSource, /class AppErrorBoundary extends Component/, 'the root must render through a recoverable error boundary')
assert.match(mainSource, /function AppLoadingFallback\(\)/, 'the initial module loading state must have a bounded failure path')
assert.match(mainSource, /setTimedOut\(true\)[\s\S]*8000/, 'a stalled app module must reach recovery instead of waiting forever')
assert.match(mainSource, /const rootElement = document\.getElementById\('root'\)/, 'the root element must be captured once for HMR-safe mounting')
assert.match(mainSource, /rootElement\.__stemReactRoot/, 'the root must be reused when the entry module is evaluated again')
assert.doesNotMatch(
  mainSource,
  /function AppLoadingFallback\(\)[\s\S]{0,700}setBootFallback\(\)\s*;/,
  'the HTML fallback must stay visible until the real App has committed',
)
assert.match(mainSource, /vite:preloadError/, 'Vite chunk preload failures must be handled before React renders a blank page')
assert.match(mainSource, /unhandledrejection/, 'dynamic import failures must surface through the boot recovery shell')
assert.match(mainSource, /isBootFailure/, 'startup failures must use the shared boot failure classifier')
assert.match(mainSource, /STEM is taking too long to open/, 'the HTML boot fallback must update when the app module times out')
assert.match(mainSource, /__stemAppReady/, 'the boot shell must only hide after the real App has committed')
assert.match(mainSource, /let appReady = false/, 'boot readiness must be tracked separately from the ready callback')
assert.match(mainSource, /appReady = true/, 'the ready callback must mark the app as committed')
assert.match(mainSource, /location\.replace/, 'stale chunk recovery must force a fresh document request')
assert.match(mainSource, /sessionStorage/, 'chunk recovery must be guarded against an infinite reload loop')
assert.match(mainSource, /boot-fallback/, 'runtime failures must update the HTML boot fallback instead of leaving a blank root')
assert.match(mainSource, /if \(!rootElement\)/, 'a missing or replaced root element must enter the visible recovery shell instead of throwing a blank-page error')
assert.match(mainSource, /Try again|Reload STEM/, 'the root failure state must expose an actionable recovery control')
assert.match(mainSource, /retry = \(\) =>[\s\S]*window\.location\.reload\(\)/, 'retry must reload the module graph instead of reusing a rejected lazy promise')
assert.match(mainSource, /lazy\(\(\) => import\('\.\/App\.jsx'\)/, 'the app shell must load behind a guarded dynamic import')
assert.match(appSource, /const \[coachMounted, setCoachMounted\] = useState\(false\)/, 'AI Coach must not mount its heavy chunk on the first screen')
assert.match(appSource, /setCoachMounted\(true\)/, 'opening Coach must mount it on demand')
assert.match(appSource, /view === 'dashboard' && !coachMounted && !accountDialogMode && !accountPopoverOpen/, 'Dashboard must keep a lightweight Coach launch control without mounting the heavy Coach chunk')
assert.match(appSource, /initialOpen=\{coachOpenPending\}/, 'the lazy Coach mount must carry the user open intent across the async chunk load')
assert.match(appSource, /onInitialOpenHandled=\{\(\) => setCoachOpenPending\(false\)\}/, 'the lazy Coach mount must acknowledge its open intent after mounting')
assert.match(appSource, /view !== 'dashboard' \|\| coachMounted/, 'the delayed dashboard preload must not mount Coach')
assert.match(appSource, /if \(view === 'dashboard'\) return undefined/, 'the heavy practice runtime must stay unloaded on the dashboard')
assert.match(appSource, /import\('\.\/data\/catalog'\)/, 'legacy seed units must load only when deferred state migration needs them')
assert.doesNotMatch(appSource, /from ['"]\.\/data\/catalog['"]/, 'the first screen must not statically import the legacy catalog')
assert.match(appSource, /loadStudyQuestionRuntime/, 'the full study question index must load only for source-question workflows')
assert.match(appSource, /loadStudyQuestionGroupsForRoute/, 'source-question workflows must fetch only the active route fragment')
assert.match(appSource, /onOpenPastPaperQuestions=\{openPastPaperQuestions\}/, 'the full study question index must load from the past-paper question workflow')
assert.match(appSource, /if \(detailTab === 'papers'\) onOpenPastPaperQuestions\(\)/, 'opening a topic must not load the full study question index before the source-question tab is opened')
assert.match(appSource, /studyQuestionRuntimeStatus === 'loading' \|\| studyQuestionRuntimeStatus === 'idle'/, 'source-question loading must have an explicit non-blank state')
assert.match(appSource, /supportsSyllabusPracticeRoute\(activeRouteId\) && \(view === 'library' \|\| view === 'topic'\)/, 'syllabus topic pages must use lightweight inventory data before loading the full catalog')
assert.match(appSource, /syllabusPracticeFallbackOptions/, 'syllabus topic pages must have a lightweight route option fallback')
assert.doesNotMatch(appSource, /\.toSorted\(/, 'the App must not depend on Array.prototype.toSorted at render time')
assert.doesNotMatch(bootRecoverySource, /\.toSorted\(/, 'boot recovery must not depend on Array.prototype.toSorted at startup')
for (const sourcePath of sourceFilesUnder(path.join(root, 'src'))) {
  assert.doesNotMatch(fs.readFileSync(sourcePath, 'utf8'), /\.toSorted\(/, `${path.relative(root, sourcePath)} must use the sorting compatibility helper`)
}
assert.match(appSource, /stableSorted/, 'the App must use a compatibility helper for ordered lists')
assert.match(bootRecoverySource, /freshReloadUrl/, 'boot recovery should preserve the current release when reloading')
assert.doesNotMatch(verifiedRuntimeSource, /from ['"]\.\.\/data\/questionBank\.js['"]/, 'the verified practice runtime must not import the full study question index')
assert.doesNotMatch(studyRuntimeSource, /from ['"]\.\.\/data\/questionBank\.js['"]/, 'the study question runtime must not embed the full study question index')
assert.match(studyRuntimeSource, /fetch/, 'the study question runtime must fetch an on-demand route fragment')
assert.match(studyRuntimeSource, /study-question-index/, 'the study question runtime must use route-scoped static fragments')
assert.match(bootRecoverySource, /appReady/, 'boot failure detection must stop reloading after the app is ready')
assert.doesNotMatch(questionSearchSource, /from ['"]\.\/questionContent['"]/, 'search helpers must not pull the source manifest into the first screen')
assert.match(questionSearchSource, /from ['"]\.\/questionText\.js['"]/, 'search helpers must use the lightweight question text helper')
assert.match(indexCssSource, /\.app-recovery__actions \.primary-action/, 'the recovery action styles must work before App.css loads')
assert.match(indexCssSource, /background: #f4f7fb/, 'the recovery surface must have standalone fallback colors')
assert.equal(packageSource.scripts['test:first-screen'], 'node scripts/test-first-screen-resilience.mjs')

const sortedInput = [{ value: 3 }, { value: 1 }, { value: 2 }]
const sortedOutput = stableSorted(sortedInput, (left, right) => left.value - right.value)
assert.deepEqual(sortedOutput.map((item) => item.value), [1, 2, 3], 'stableSorted must keep comparator order')
assert.deepEqual(sortedInput.map((item) => item.value), [3, 1, 2], 'stableSorted must not mutate the input array')

const sourceBoundUnit = {
  id: 'first-screen-source-unit',
  parts: [
    {
      sourceKind: 'past-paper',
      sourceQuestionId: 'cie-9702-q2',
      questionPartId: 'b',
      sourceBindingProvenance: {
        bindingSignature: 'binding-q2',
        reviewVersion: 'v1',
        sourceDocumentSha256: 'a'.repeat(64),
        answerDocumentSha256: 'b'.repeat(64),
        sourceIndexSha256: 'c'.repeat(64),
        sourceManifestChecksum: 'd'.repeat(64),
      },
    },
    {
      sourceKind: 'past-paper',
      sourceQuestionId: 'cie-9702-q1',
      questionPartId: 'a',
      sourceBindingProvenance: {
        bindingSignature: 'binding-q1',
        reviewVersion: 'v1',
        sourceDocumentSha256: 'e'.repeat(64),
        answerDocumentSha256: 'f'.repeat(64),
        sourceIndexSha256: '1'.repeat(64),
        sourceManifestChecksum: '2'.repeat(64),
      },
    },
  ],
}
const originalToSorted = Array.prototype.toSorted
try {
  Object.defineProperty(Array.prototype, 'toSorted', { configurable: true, value: undefined, writable: true })
  const snapshot = sourceBindingSnapshotForUnit(sourceBoundUnit)
  assert.deepEqual(snapshot.parts.map((part) => part.sourceQuestionId), ['cie-9702-q1', 'cie-9702-q2'], 'saved source bindings must remain readable without toSorted')
} finally {
  Object.defineProperty(Array.prototype, 'toSorted', { configurable: true, value: originalToSorted, writable: true })
}

const validated = validateSyllabusInventoryPayload({
  routeId: 'cie-9702-a2-physics',
  assessmentComponents: [{ component: '4', stage: 'A2', track: 'theory', label: 'Paper 4' }],
  topics: [{ id: 'physics-9702-topic-01', code: '1', name: 'Motion in a circle', availableQuestionCount: '7' }],
})
assert.equal(validated.topics[0].availableQuestionCount, 7)
assert.equal(validated.assessmentComponents[0].component, 4)
assert.throws(() => validateSyllabusInventoryPayload({ assessmentComponents: [], topics: [{}] }), /missing id, code, or name/i)
assert.throws(() => validateSyllabusInventoryPayload({ assessmentComponents: [{}], topics: [] }), /missing component or label/i)

console.log('first-screen resilience checks passed')
