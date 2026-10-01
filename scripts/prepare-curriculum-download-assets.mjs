import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHA256 = /^[a-f0-9]{64}$/
const PDF_PREFIX = Buffer.from('%PDF-', 'ascii')

function option(argumentsList, name) {
  const index = argumentsList.indexOf(name)
  return index >= 0 ? argumentsList[index + 1] || '' : ''
}

function requiredOption(argumentsList, name) {
  const value = option(argumentsList, name)
  assert.ok(value, `Pass ${name} <path>`)
  return path.resolve(value)
}

function safeRelativePdf(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\0')) return false
  const pieces = value.split(/[\\/]+/)
  return pieces.every(piece => /^[a-z0-9][a-z0-9._-]{0,255}$/i.test(piece)) && /\.pdf$/i.test(value)
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

async function localPdfEvidence(filePath, expected) {
  const stat = await fsp.stat(filePath)
  if (!stat.isFile() || stat.size !== expected.bytes || stat.size < PDF_PREFIX.length) return null
  const handle = await fsp.open(filePath, 'r')
  try {
    const prefix = Buffer.alloc(PDF_PREFIX.length)
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0)
    if (bytesRead !== PDF_PREFIX.length || !prefix.equals(PDF_PREFIX)) return null
  } finally {
    await handle.close()
  }
  const sha256 = await sha256File(filePath)
  return sha256 === expected.sha256 ? { bytes: stat.size, sha256 } : null
}

function addCandidate(byHash, candidate) {
  if (!SHA256.test(candidate.sha256 || '') || !Number.isSafeInteger(candidate.bytes) || candidate.bytes < PDF_PREFIX.length || !Number.isInteger(candidate.pages) || candidate.pages < 1) return
  const list = byHash.get(candidate.sha256) || []
  list.push(candidate)
  byHash.set(candidate.sha256, list)
}

function sourceCandidates({ apSources, apLocalInventory, ibInventory, apLocalRoot, ibFilesRoot }) {
  const byHash = new Map()
  for (const row of apSources.records || []) {
    if (row.status === 'verified' && typeof row.localPath === 'string') addCandidate(byHash, {
      board: 'ap', sourceId: row.id, bytes: row.bytes, pages: row.pages, sha256: row.sha256, filePath: path.resolve(row.localPath),
    })
  }
  for (const row of apLocalInventory.files || []) {
    if (String(row.pdfStatus || '').startsWith('ok')) addCandidate(byHash, {
      board: 'ap', sourceId: `local:${row.relativePath}`, bytes: row.bytes, pages: row.pageCount, sha256: row.sha256, filePath: path.resolve(apLocalRoot, row.relativePath),
    })
  }
  for (const row of ibInventory.records || []) {
    if (row.status === 'downloaded') addCandidate(byHash, {
      board: 'ib', sourceId: row.id, bytes: row.bytes, pages: row.pages, sha256: row.sha256, filePath: path.resolve(ibFilesRoot, row.relativePath),
    })
  }
  return byHash
}

function filesForCatalog(catalog) {
  const result = []
  for (const paper of catalog.papers || []) {
    for (const [role, file] of [['questionPaper', paper.questionPaper], ['markScheme', paper.markScheme]]) {
      if (file) result.push({ paperId: paper.id, board: paper.board, role, file })
    }
  }
  return result
}

async function copyVerifiedPdf(source, target, expected) {
  if (fs.existsSync(target)) {
    const existing = await localPdfEvidence(target, expected)
    assert.ok(existing, `Existing target has different content: ${target}`)
    return 'reused'
  }
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.partial-${process.pid}-${crypto.randomUUID()}`
  try {
    await fsp.copyFile(source, temporary, fs.constants.COPYFILE_EXCL)
    const copied = await localPdfEvidence(temporary, expected)
    assert.ok(copied, `Copied target failed integrity validation: ${target}`)
    await fsp.rename(temporary, target)
    return 'copied'
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {})
  }
}

function licensedCatalog(catalog, licensedHashes, generatedAt) {
  const next = structuredClone(catalog)
  next.generatedAt = generatedAt
  for (const paper of next.papers) {
    for (const file of [paper.questionPaper, paper.markScheme].filter(Boolean)) {
      if (licensedHashes.has(file.sha256)) file.rightsStatus = 'licensed'
    }
  }
  return next
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.partial-${process.pid}-${crypto.randomUUID()}`
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fsp.rename(temporary, filePath)
}

export async function prepareCurriculumDownloadAssets({ catalogPath, apSourcesPath, apLocalInventoryPath, ibInventoryPath, apLocalRoot, ibFilesRoot, assetRoot, outputCatalogPath, assetManifestPath, apply = false, generatedAt = new Date().toISOString() }) {
  const [catalog, apSources, apLocalInventory, ibInventory] = await Promise.all([
    fsp.readFile(catalogPath, 'utf8').then(JSON.parse),
    fsp.readFile(apSourcesPath, 'utf8').then(JSON.parse),
    fsp.readFile(apLocalInventoryPath, 'utf8').then(JSON.parse),
    fsp.readFile(ibInventoryPath, 'utf8').then(JSON.parse),
  ])
  assert.equal(catalog.schemaVersion, 'curriculum-paper-source-v1', 'Unsupported catalog schema')
  assert.ok(path.isAbsolute(assetRoot), 'Asset root must be absolute')
  assert.ok(path.isAbsolute(outputCatalogPath), 'Output catalog path must be absolute')
  assert.ok(path.isAbsolute(assetManifestPath), 'Asset manifest path must be absolute')
  const candidatesByHash = sourceCandidates({ apSources, apLocalInventory, ibInventory, apLocalRoot, ibFilesRoot })
  const records = filesForCatalog(catalog)
  const licensedHashes = new Set()
  const reportFiles = []
  let totalBytes = 0
  let copied = 0
  let reused = 0

  for (const record of records) {
    const { file } = record
    if (!safeRelativePdf(file.relativePath) || !SHA256.test(file.sha256 || '') || !Number.isSafeInteger(file.bytes) || !Number.isInteger(file.pages)) {
      throw new Error(`Invalid catalog file metadata: ${record.paperId}/${record.role}`)
    }
    const candidates = (candidatesByHash.get(file.sha256) || []).filter(candidate => candidate.board === record.board && candidate.bytes === file.bytes && candidate.pages === file.pages)
    let selected = null
    for (const candidate of candidates) {
      try {
        if (await localPdfEvidence(candidate.filePath, file)) {
          selected = candidate
          break
        }
      } catch {
        // A stale source ledger must not make a catalog file downloadable.
      }
    }
    if (!selected) {
      reportFiles.push({ id: file.id, paperId: record.paperId, board: record.board, role: record.role, availability: 'source-only', reason: candidates.length ? 'source_integrity_failed' : 'local_asset_missing' })
      continue
    }
    const target = path.resolve(assetRoot, file.relativePath)
    const relativeTarget = path.relative(assetRoot, target)
    assert.ok(relativeTarget && !relativeTarget.startsWith('..') && !path.isAbsolute(relativeTarget), `Asset target escapes root: ${file.id}`)
    let operation = 'validated'
    if (apply) operation = await copyVerifiedPdf(selected.filePath, target, file)
    if (operation === 'copied') copied++
    if (operation === 'reused') reused++
    licensedHashes.add(file.sha256)
    totalBytes += file.bytes
    reportFiles.push({ id: file.id, paperId: record.paperId, board: record.board, role: record.role, availability: 'downloadable', relativePath: file.relativePath, bytes: file.bytes, pages: file.pages, sha256: file.sha256, sourceId: selected.sourceId, operation })
  }

  const nextCatalog = licensedCatalog(catalog, licensedHashes, generatedAt)
  const downloadableFiles = reportFiles.filter(file => file.availability === 'downloadable').length
  const manifest = {
    schemaVersion: 'curriculum-download-assets-v1',
    generatedAt,
    catalogSha256: crypto.createHash('sha256').update(JSON.stringify(nextCatalog)).digest('hex'),
    assetRootLayout: 'sha256.pdf',
    summary: {
      catalogFiles: records.length,
      downloadableFiles,
      sourceOnlyFiles: records.length - downloadableFiles,
      downloadableBytes: totalBytes,
      copied,
      reused,
    },
    files: reportFiles,
  }
  if (apply) {
    await writeJsonAtomic(outputCatalogPath, nextCatalog)
    await writeJsonAtomic(assetManifestPath, manifest)
  }
  return { catalog: nextCatalog, manifest }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argumentsList = process.argv.slice(2)
  const catalogPath = requiredOption(argumentsList, '--catalog')
  const apSourcesPath = requiredOption(argumentsList, '--ap-sources')
  const apLocalInventoryPath = requiredOption(argumentsList, '--ap-local-inventory')
  const ibInventoryPath = requiredOption(argumentsList, '--ib-inventory')
  const apLocalRoot = requiredOption(argumentsList, '--ap-local-root')
  const ibFilesRoot = requiredOption(argumentsList, '--ib-files-root')
  const assetRoot = requiredOption(argumentsList, '--asset-root')
  const outputCatalogPath = path.resolve(option(argumentsList, '--output-catalog') || catalogPath)
  const assetManifestPath = path.resolve(option(argumentsList, '--asset-manifest') || path.join(assetRoot, 'curriculum-download-assets-manifest.json'))
  const apply = argumentsList.includes('--apply')
  const result = await prepareCurriculumDownloadAssets({ catalogPath, apSourcesPath, apLocalInventoryPath, ibInventoryPath, apLocalRoot, ibFilesRoot, assetRoot, outputCatalogPath, assetManifestPath, apply })
  process.stdout.write(`${JSON.stringify({ ok: true, mode: apply ? 'apply' : 'dry-run', ...result.manifest.summary, assetManifestPath: apply ? assetManifestPath : null, outputCatalogPath: apply ? outputCatalogPath : null }, null, 2)}\n`)
}
