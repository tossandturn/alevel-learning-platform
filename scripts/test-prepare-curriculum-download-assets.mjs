import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareCurriculumDownloadAssets } from './prepare-curriculum-download-assets.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stem-curriculum-download-assets-'))
const source = path.join(root, 'source')
const assets = path.join(root, 'assets')
const catalogPath = path.join(root, 'catalog.json')
const apSourcesPath = path.join(root, 'ap-sources.json')
const apLocalPath = path.join(root, 'ap-local.json')
const ibInventoryPath = path.join(root, 'ib.json')
const outputCatalog = path.join(root, 'output-catalog.json')
const outputManifest = path.join(root, 'output-manifest.json')
const pdf = Buffer.from('%PDF-1.7\nlicensed test PDF\n%%EOF\n', 'ascii')
const sha256 = crypto.createHash('sha256').update(pdf).digest('hex')

try {
  await fs.mkdir(path.join(source, 'ib-files', 'physics'), { recursive: true })
  await fs.writeFile(path.join(source, 'ap.pdf'), pdf)
  await fs.writeFile(path.join(source, 'ib-files', 'physics', 'ib.pdf'), pdf)
  const file = { id: `file-${sha256.slice(0, 32)}`, name: 'Test paper.pdf', bytes: pdf.length, pages: 1, sha256, relativePath: `${sha256}.pdf`, sourceUrl: null, rightsStatus: 'unverified', integrityStatus: 'verified' }
  await fs.writeFile(catalogPath, JSON.stringify({ schemaVersion: 'curriculum-paper-source-v1', generatedAt: '2026-10-01T00:00:00.000Z', courses: [{ id: 'physics', board: 'ap', label: 'AP Physics 1', subject: 'physics' }, { id: 'ib-physics', board: 'ib', label: 'IB Physics', subject: 'physics' }], papers: [
    { id: 'ap-paper', board: 'ap', course: 'physics', courseLabel: 'AP Physics 1', subject: 'physics', level: '', year: 2025, session: 'Annual', paper: 'FRQ', variant: 'standard', title: 'AP test', section: 'FRQ', fullExam: false, practiceReady: false, pairStatus: 'missing', questionPaper: file, markScheme: null },
    { id: 'ib-paper', board: 'ib', course: 'ib-physics', courseLabel: 'IB Physics', subject: 'physics', level: 'HL', year: 2025, session: 'May', paper: 'P1', variant: 'TZ1', title: 'IB test', section: 'P1', fullExam: false, practiceReady: false, pairStatus: 'missing', questionPaper: { ...file, id: `file-${sha256.slice(0, 31)}x` }, markScheme: null },
  ] }), 'utf8')
  await fs.writeFile(apSourcesPath, JSON.stringify({ records: [{ id: 'ap-source', status: 'verified', bytes: pdf.length, pages: 1, sha256, localPath: path.join(source, 'ap.pdf') }] }), 'utf8')
  await fs.writeFile(apLocalPath, JSON.stringify({ files: [] }), 'utf8')
  await fs.writeFile(ibInventoryPath, JSON.stringify({ records: [{ id: 'ib-source', status: 'downloaded', bytes: pdf.length, pages: 1, sha256, relativePath: 'physics/ib.pdf' }] }), 'utf8')
  const dry = await prepareCurriculumDownloadAssets({ catalogPath, apSourcesPath, apLocalInventoryPath: apLocalPath, ibInventoryPath, apLocalRoot: source, ibFilesRoot: path.join(source, 'ib-files'), assetRoot: assets, outputCatalogPath: outputCatalog, assetManifestPath: outputManifest, apply: false, generatedAt: '2026-10-01T00:00:00.000Z' })
  assert.equal(dry.manifest.summary.downloadableFiles, 2)
  assert.equal(await fs.stat(path.join(assets, `${sha256}.pdf`)).catch(() => null), null, 'dry run must not write assets')
  const applied = await prepareCurriculumDownloadAssets({ catalogPath, apSourcesPath, apLocalInventoryPath: apLocalPath, ibInventoryPath, apLocalRoot: source, ibFilesRoot: path.join(source, 'ib-files'), assetRoot: assets, outputCatalogPath: outputCatalog, assetManifestPath: outputManifest, apply: true, generatedAt: '2026-10-01T00:00:00.000Z' })
  assert.equal(applied.manifest.summary.downloadableFiles, 2)
  assert.equal(applied.manifest.summary.copied, 1, 'identical bytes share one immutable checksum asset')
  const output = JSON.parse(await fs.readFile(outputCatalog, 'utf8'))
  assert.ok(output.papers.every(paper => paper.questionPaper.rightsStatus === 'licensed'))
  const manifest = JSON.parse(await fs.readFile(outputManifest, 'utf8'))
  assert.equal(manifest.summary.reused, 1)
  await fs.writeFile(path.join(assets, `${sha256}.pdf`), Buffer.from('%PDF-tampered', 'ascii'))
  await assert.rejects(
    () => prepareCurriculumDownloadAssets({ catalogPath, apSourcesPath, apLocalInventoryPath: apLocalPath, ibInventoryPath, apLocalRoot: source, ibFilesRoot: path.join(source, 'ib-files'), assetRoot: assets, outputCatalogPath: outputCatalog, assetManifestPath: outputManifest, apply: true }),
    /Existing target has different content/,
  )
  process.stdout.write('PASS curriculum download asset preparation: matching, shared checksums, dry-run, and tamper rejection\n')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
