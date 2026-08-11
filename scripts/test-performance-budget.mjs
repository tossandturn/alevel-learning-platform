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

assert.ok(entry.length < 1_400_000, `client entry is too large: ${entry.length} bytes`)
assert.ok(entryGzip.length < 300_000, `gzipped client entry is too large: ${entryGzip.length} bytes`)
assert.ok(!entry.includes('importedQuestionIndex'), 'the full imported question index must not be embedded in the client entry')

const pdfViewer = fs.readFileSync(path.join(root, 'src', 'components', 'PdfViewer.jsx'), 'utf8')
assert.ok(pdfViewer.includes('IntersectionObserver'), 'PDF pages must be observed before rendering')
assert.ok(pdfViewer.includes('requestedPages'), 'PDF viewer must retain a rendered-page cache')
assert.ok(pdfViewer.includes('rootMargin: \'720px 0px\''), 'PDF viewer must pre-render a bounded viewport margin')

console.log(JSON.stringify({
  entry: entryName,
  entryBytes: entry.length,
  entryGzipBytes: entryGzip.length,
  pdfWorkerBytes: fs.statSync(path.join(assetRoot, assetNames.find((name) => name.startsWith('pdf.worker')) || entryName)).size,
}))
