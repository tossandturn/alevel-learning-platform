import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  PAPER_ACCESS_POLICIES,
  PAPER_CATALOG_SCHEMA_VERSION,
  PAPER_GOVERNANCE_POLICIES,
  PAPER_GOVERNANCE_SCHEMA_VERSION,
} from '../src/lib/paperGovernance.js'

const projectRoot = path.resolve(process.env.PAPER_CATALOG_AUDIT_ROOT || path.join(import.meta.dirname, '..'))
const catalogPath = path.join(projectRoot, 'public', 'data', 'papers.json')
const libraryRoot = resolveLibraryRoot()
const writeReport = process.argv.includes('--write-report')
const reportPath = path.join(projectRoot, 'artifacts', 'paper-catalog-audit.json')
const errors = []

function resolveLibraryRoot() {
  const configuredRoot = process.env.CIE_LIBRARY_ROOT || process.env.CIE_SOURCE_ROOT
  if (configuredRoot) return path.resolve(configuredRoot)
  const releaseAdjacentRoot = path.resolve(projectRoot, '..', '..', 'library', 'pdf')
  if (fs.existsSync(releaseAdjacentRoot)) return releaseAdjacentRoot
  return path.resolve('D:/CodexWork/cie-fraft-fetcher/output/pdf')
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256')
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let offset = 0
    let bytes = 0
    while ((bytes = fs.readSync(descriptor, buffer, 0, buffer.length, offset)) > 0) {
      hash.update(buffer.subarray(0, bytes))
      offset += bytes
    }
  } finally {
    fs.closeSync(descriptor)
  }
  return hash.digest('hex')
}

function pdfStructure(filePath) {
  const stat = fs.statSync(filePath)
  if (stat.size < 16) return { ok: false, reason: 'pdf-too-small' }
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const prefix = Buffer.alloc(Math.min(stat.size, 16))
    fs.readSync(descriptor, prefix, 0, prefix.length, 0)
    if (!prefix.toString('ascii').startsWith('%PDF-')) return { ok: false, reason: 'pdf-signature-missing' }
    const tailBytes = Math.min(stat.size, 65_536)
    const tail = Buffer.alloc(tailBytes)
    fs.readSync(descriptor, tail, 0, tailBytes, stat.size - tailBytes)
    if (!tail.toString('latin1').includes('%%EOF')) return { ok: false, reason: 'pdf-eof-missing' }
    return { ok: true }
  } finally {
    fs.closeSync(descriptor)
  }
}

function safeLocalFile(item) {
  const subject = String(item?.subject || '')
  const file = String(item?.file || '')
  if (!/^[a-z0-9]+$/i.test(subject) || !file || path.basename(file) !== file || !/\.pdf$/i.test(file)) return null
  const subjectRoot = path.resolve(libraryRoot, subject)
  const filePath = path.resolve(subjectRoot, file)
  return filePath.startsWith(`${subjectRoot}${path.sep}`) ? filePath : null
}

function expectedAnswerStatus(item, itemsById) {
  if (item.kind !== 'qp') return 'not-applicable'
  if (!item.markSchemeId) return 'missing'
  const answer = itemsById.get(item.markSchemeId)
  return answer && ['ms', 'ak'].includes(answer.kind) ? 'exact-pair' : 'invalid-link'
}

function currentDuplicateOf(item, firstByChecksum) {
  if (!item.sha256) return null
  const first = firstByChecksum.get(item.sha256)
  return first && first !== item.id ? first : null
}

assert.ok(fs.existsSync(catalogPath), `Paper catalog is missing: ${catalogPath}`)
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
assert.equal(catalog.schemaVersion, PAPER_CATALOG_SCHEMA_VERSION, 'Paper catalog schema is stale; run npm run catalog')
assert.equal(catalog.paperGovernance?.schemaVersion, PAPER_GOVERNANCE_SCHEMA_VERSION, 'Paper governance contract is missing or stale; run npm run catalog')
assert.ok(Array.isArray(catalog.items) && catalog.items.length > 0, 'Paper catalog has no items')

const itemsById = new Map()
const firstByChecksum = new Map()
for (const item of catalog.items) {
  if (itemsById.has(item.id)) errors.push(`duplicate-id:${item.id}`)
  itemsById.set(item.id, item)
  if (item.sha256 && !firstByChecksum.has(item.sha256)) firstByChecksum.set(item.sha256, item.id)
}

const summary = {
  schemaVersion: 'paper-catalog-audit-v1',
  catalogSchemaVersion: catalog.schemaVersion,
  generatedAt: catalog.generatedAt,
  libraryRoot,
  files: catalog.items.length,
  bytes: 0,
  states: {},
  sourcePolicies: {},
  accessPolicies: {},
  answerLinks: {},
  duplicateGroups: 0,
  duplicateFiles: 0,
  integrity: { checked: 0, missing: 0, damaged: 0, checksumMismatch: 0, byteMismatch: 0 },
  withdrawals: [],
  quarantined: [],
  licenceGaps: [],
  records: [],
}
const duplicateGroups = new Map()

for (const item of catalog.items) {
  const governance = item.governance
  const label = `${item.id || item.file || 'unknown-paper'}`
  if (!item.id || !item.sourceUrl || !/^[a-f0-9]{64}$/i.test(String(item.sha256 || ''))) errors.push(`${label}: missing stable provenance or checksum`)
  if (!governance || governance.schemaVersion !== PAPER_GOVERNANCE_SCHEMA_VERSION) {
    errors.push(`${label}: missing governance record`)
    continue
  }
  const sourcePolicy = PAPER_GOVERNANCE_POLICIES[governance.sourcePolicyId]
  const accessPolicy = PAPER_ACCESS_POLICIES[governance.accessPolicyId]
  if (!sourcePolicy) errors.push(`${label}: unknown source policy`)
  if (!accessPolicy) errors.push(`${label}: unknown access policy`)
  if (!['active', 'withdrawn', 'quarantined'].includes(governance.state)) errors.push(`${label}: invalid governance state`)
  if (!governance.sourceVersion || !['recorded', 'not-recorded'].includes(governance.retrievalStatus)) errors.push(`${label}: incomplete source version or retrieval status`)
  if (governance.state === 'quarantined' && (!governance.reasonCode || !governance.reviewedAt || !governance.reviewEvidence)) {
    errors.push(`${label}: quarantined records require reason, review timestamp and evidence`)
  }

  const answerStatus = expectedAnswerStatus(item, itemsById)
  if (governance.answerStatus !== answerStatus) errors.push(`${label}: answer association is stale (${governance.answerStatus} !== ${answerStatus})`)
  const duplicateOf = currentDuplicateOf(item, firstByChecksum)
  if ((governance.duplicateOf || null) !== duplicateOf) errors.push(`${label}: duplicate relationship is stale`)
  if (!duplicateGroups.has(item.sha256)) duplicateGroups.set(item.sha256, [])
  duplicateGroups.get(item.sha256).push(item.id)

  const record = {
    id: item.id,
    state: governance.state,
    sourcePolicyId: governance.sourcePolicyId,
    accessPolicyId: governance.accessPolicyId,
    answerStatus,
    integrity: 'not-checked',
    reasons: [],
  }
  summary.bytes += Number(item.bytes) || 0
  summary.states[governance.state] = (summary.states[governance.state] || 0) + 1
  summary.sourcePolicies[governance.sourcePolicyId] = (summary.sourcePolicies[governance.sourcePolicyId] || 0) + 1
  summary.accessPolicies[governance.accessPolicyId] = (summary.accessPolicies[governance.accessPolicyId] || 0) + 1
  summary.answerLinks[answerStatus] = (summary.answerLinks[answerStatus] || 0) + 1
  if (sourcePolicy?.licenseStatus !== 'source-stated-authorisation') summary.licenceGaps.push(item.id)
  if (governance.state === 'withdrawn') summary.withdrawals.push(item.id)
  if (governance.state === 'quarantined') summary.quarantined.push(item.id)

  const filePath = safeLocalFile(item)
  if (!filePath || !fs.existsSync(filePath)) {
    record.integrity = 'missing'
    record.reasons.push('file-missing')
    summary.integrity.missing += 1
    if (governance.state !== 'quarantined') errors.push(`${label}: local PDF is missing`)
  } else {
    summary.integrity.checked += 1
    const stat = fs.statSync(filePath)
    const structure = pdfStructure(filePath)
    if (!structure.ok) {
      record.integrity = 'damaged'
      record.reasons.push(structure.reason)
      summary.integrity.damaged += 1
      if (governance.state !== 'quarantined' || governance.reasonCode !== structure.reason) errors.push(`${label}: ${structure.reason}`)
    }
    if (stat.size !== Number(item.bytes)) {
      record.integrity = 'byte-mismatch'
      record.reasons.push('byte-length-mismatch')
      summary.integrity.byteMismatch += 1
      if (governance.state !== 'quarantined') errors.push(`${label}: byte length does not match catalog`)
    }
    const actualSha256 = hashFile(filePath)
    if (actualSha256 !== item.sha256) {
      record.integrity = 'checksum-mismatch'
      record.reasons.push('sha256-mismatch')
      summary.integrity.checksumMismatch += 1
      if (governance.state !== 'quarantined') errors.push(`${label}: SHA-256 does not match catalog`)
    }
    if (!record.reasons.length) record.integrity = 'verified'
  }
  summary.records.push(record)
}

summary.duplicateGroups = [...duplicateGroups.values()].filter((ids) => ids.length > 1).length
summary.duplicateFiles = [...duplicateGroups.values()].filter((ids) => ids.length > 1).reduce((count, ids) => count + ids.length, 0)

if (writeReport) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    ...summary,
    records: undefined,
    licenceGaps: summary.licenceGaps.length,
    withdrawals: summary.withdrawals.length,
    quarantined: summary.quarantined.length,
    report: writeReport ? path.relative(projectRoot, reportPath).replaceAll('\\', '/') : null,
  }, null, 2))
}
