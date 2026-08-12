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
const paperWorkspaceName = jsAssets.find((name) => /^PaperWorkspace-/.test(name))
const pdfViewerName = jsAssets.find((name) => /^PdfViewer-/.test(name))

assert.ok(entry.length < 1_150_000, `client entry is too large: ${entry.length} bytes`)
assert.ok(entryGzip.length < 220_000, `gzipped client entry is too large: ${entryGzip.length} bytes`)
assert.ok(!entry.includes('importedQuestionIndex'), 'the full imported question index must not be embedded in the client entry')
assert.ok(paperWorkspaceName, 'paper workspace must remain an on-demand client chunk')
assert.ok(pdfViewerName, 'PDF viewer must remain an on-demand client chunk')
assert.ok(!entry.includes('pdfjs-dist'), 'the initial client entry must not include PDF parsing code')

const paperWorkspace = fs.readFileSync(path.join(assetRoot, paperWorkspaceName))
assert.ok(!paperWorkspace.includes('pdfjs-dist'), 'the paper workspace must defer PDF parsing until the document pane renders')

const pdfViewer = fs.readFileSync(path.join(root, 'src', 'components', 'PdfViewer.jsx'), 'utf8')
const paperWorkspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
assert.ok(pdfViewer.includes('IntersectionObserver'), 'PDF pages must be observed before rendering')
assert.ok(pdfViewer.includes('requestedPages'), 'PDF viewer must retain a rendered-page cache')
assert.ok(pdfViewer.includes('rootMargin: \'720px 0px\''), 'PDF viewer must pre-render a bounded viewport margin')
assert.ok(paperWorkspaceSource.includes("import('./PdfViewer')"), 'the paper workspace must lazy-load the PDF viewer')
assert.ok(paperWorkspaceSource.includes('Suspense fallback={<PdfViewerLoading />}'), 'PDF loading must expose an accessible loading state')

console.log(JSON.stringify({
  entry: entryName,
  entryBytes: entry.length,
  entryGzipBytes: entryGzip.length,
  paperWorkspace: paperWorkspaceName,
  paperWorkspaceBytes: paperWorkspace.length,
  pdfViewer: pdfViewerName,
  pdfViewerBytes: fs.statSync(path.join(assetRoot, pdfViewerName)).size,
  pdfWorkerBytes: fs.statSync(path.join(assetRoot, assetNames.find((name) => name.startsWith('pdf.worker')) || entryName)).size,
}))
