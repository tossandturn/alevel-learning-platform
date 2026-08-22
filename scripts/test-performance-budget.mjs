import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetRoot = path.join(root, 'dist', 'assets')
assert.ok(fs.existsSync(assetRoot), 'run npm run build before the performance budget')

const assetNames = fs.readdirSync(assetRoot)
const jsAssets = assetNames.filter((name) => name.endsWith('.js'))
const entryName = jsAssets.find((name) => /^index-/.test(name))
assert.ok(entryName, 'built client entry chunk is missing')
const entry = fs.readFileSync(path.join(assetRoot, entryName))
const entryGzip = gzipSync(entry, { level: 9 })
const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8')
assert.match(html, /rel="modulepreload"[^>]+App-[^>]+\.js/, 'the first screen must preload the App chunk to avoid an entry-to-App waterfall')
const paperWorkspaceName = jsAssets.find((name) => /^PaperWorkspace-/.test(name))
const paperLibraryName = jsAssets.find((name) => /^PaperLibrary-/.test(name))
const pdfViewerName = jsAssets.find((name) => /^PdfViewer-/.test(name))
const practiceWorkspaceName = jsAssets.find((name) => /^PracticeWorkspace-/.test(name))
const aiCoachName = jsAssets.find((name) => /^AiCoach-/.test(name))
const practiceRuntimeName = jsAssets.find((name) => /^verifiedPracticeCatalog-/.test(name))
const studyQuestionRuntimeName = jsAssets.find((name) => /^studyQuestionRuntime-/.test(name))

assert.ok(entry.length < 625_000, `client entry is too large: ${entry.length} bytes`)
assert.ok(entryGzip.length < 180_000, `gzipped client entry is too large: ${entryGzip.length} bytes`)
assert.ok(!entry.includes('importedQuestionIndex'), 'the full imported question index must not be embedded in the client entry')
assert.ok(!entry.includes('sourceContentManifest'), 'the source evidence manifest must not be embedded in the client entry')
assert.ok(!html.includes('practice-catalog-'), 'the initial HTML must not preload the full verified practice catalog')
assert.ok(!html.includes('source-content-manifest-'), 'the initial HTML must not preload the source evidence manifest')
assert.ok(practiceRuntimeName, 'the verified practice runtime must remain an on-demand client chunk')
assert.ok(studyQuestionRuntimeName, 'the full study question runtime must remain a separate on-demand client chunk')
assert.ok(practiceWorkspaceName, 'the question workspace must remain an on-demand client chunk')
assert.ok(aiCoachName, 'AI Coach must remain an on-demand client chunk')
assert.ok(paperLibraryName, 'the past-paper catalog must remain an on-demand client chunk')
assert.ok(paperWorkspaceName, 'paper workspace must remain an on-demand client chunk')
assert.ok(pdfViewerName, 'PDF viewer must remain an on-demand client chunk')
assert.ok(!entry.includes('pdfjs-dist'), 'the initial client entry must not include PDF parsing code')
assert.ok(!entry.includes('curriculumPracticeUnits'), 'legacy seed practice units must not be embedded in the initial client entry')

const paperWorkspace = fs.readFileSync(path.join(assetRoot, paperWorkspaceName))
const verifiedRuntime = fs.readFileSync(path.join(assetRoot, practiceRuntimeName))
const studyQuestionRuntime = fs.readFileSync(path.join(assetRoot, studyQuestionRuntimeName))
assert.ok(verifiedRuntime.length < 100_000, `verified runtime is too large: ${verifiedRuntime.length} bytes`)
assert.ok(!verifiedRuntime.includes('importedQuestionIndex'), 'the verified runtime must not embed the full study question index')
assert.ok(studyQuestionRuntime.length < 120_000, `study question runtime is too large: ${studyQuestionRuntime.length} bytes`)
assert.ok(!studyQuestionRuntime.includes('importedQuestionIndex'), 'the study question runtime must not embed the full study question index')
assert.ok(!paperWorkspace.includes('pdfjs-dist'), 'the paper workspace must defer PDF parsing until the document pane renders')

const pdfViewer = fs.readFileSync(path.join(root, 'src', 'components', 'PdfViewer.jsx'), 'utf8')
const paperWorkspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
assert.ok(pdfViewer.includes('requestedPages'), 'PDF viewer must retain a rendered-page cache')
assert.ok(pdfViewer.includes('PAGE_WINDOW_BUFFER = 2'), 'PDF viewer must retain only a bounded page window')
assert.ok(pdfViewer.includes('data-virtualized-pages="true"'), 'PDF viewer must mark the bounded virtualized page stack')
assert.ok(pdfViewer.includes('for (const pageNumber of requestedPages)'), 'PDF rendering must iterate the bounded visible page set, not every document page')
assert.ok(pdfViewer.includes('if (!active) return nextDocument.destroy().catch(() => {})'), 'PDF loading must dispose the document only after an in-flight worker reaches a terminal state')
assert.ok(!pdfViewer.includes('task.destroy()'), 'PDF viewer must not terminate a worker while its document initialization is still in flight')
assert.ok(pdfViewer.includes('if (loadedDocument) void loadedDocument.destroy().catch(() => {})'), 'a ready PDF document must still be released on viewer unmount')
assert.ok(paperWorkspaceSource.includes("import('./PdfViewer')"), 'the paper workspace must lazy-load the PDF viewer')
assert.ok(paperWorkspaceSource.includes('Suspense fallback={<PdfViewerLoading />}'), 'PDF loading must expose an accessible loading state')
const paperAnswerSheet = fs.readFileSync(path.join(root, 'src', 'components', 'PaperAnswerSheet.jsx'), 'utf8')
assert.ok(paperAnswerSheet.includes('const renderedQuestionNumbers = [currentQuestion]'), 'structured paper answer sheets must mount only the active question')
assert.ok(paperAnswerSheet.includes('QUESTION_INDEX_WINDOW = 11'), 'answer navigation must keep a bounded question-index window')
const runtimePerformance = fs.readFileSync(path.join(root, 'src', 'lib', 'runtimePerformance.js'), 'utf8')
const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
const paperCatalogHook = fs.readFileSync(path.join(root, 'src', 'hooks', 'usePaperCatalog.js'), 'utf8')
assert.ok(runtimePerformance.includes("observe('largest-contentful-paint'"), 'runtime monitoring must observe LCP where supported')
assert.ok(runtimePerformance.includes("observe('event'"), 'runtime monitoring must observe interaction latency where supported')
assert.ok(runtimePerformance.includes('performance.memory'), 'runtime monitoring must sample supported memory metrics')
assert.ok(appSource.includes("view === 'library' && ['papers', 'exams'].includes(activeTab)"), 'the paper catalog must load only when the student opens a paper workflow')
assert.ok(paperCatalogHook.includes('if (enabled) void load()'), 'the paper catalog request must remain gated behind the enabled state')
assert.ok(fs.existsSync(path.join(root, 'public', 'data', 'study-question-index', 'manifest.json')), 'route-scoped study question fragments must be generated before build')

console.log(JSON.stringify({
  entry: entryName,
  entryBytes: entry.length,
  entryGzipBytes: entryGzip.length,
  practiceRuntime: practiceRuntimeName,
  studyQuestionRuntime: studyQuestionRuntimeName,
  practiceWorkspace: practiceWorkspaceName,
  aiCoach: aiCoachName,
  paperLibrary: paperLibraryName,
  paperWorkspace: paperWorkspaceName,
  paperWorkspaceBytes: paperWorkspace.length,
  pdfViewer: pdfViewerName,
  pdfViewerBytes: fs.statSync(path.join(assetRoot, pdfViewerName)).size,
  pdfWorkerBytes: fs.statSync(path.join(assetRoot, assetNames.find((name) => name.startsWith('pdf.worker')) || entryName)).size,
  runtimeMetricsContract: '__stemPerformanceMetrics',
}))
