import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import importedIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import { sourcePageFromAssetUrl, documentPageFromAssetUrl } from '../src/lib/sourceContentContract.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assetRoot = path.resolve(process.env.SOURCE_AUDIT_ASSET_ROOT || path.join(root, 'public', 'question-assets'))
const reportPath = path.join(root, 'artifacts', '9709-second-pass-audit.json')
const writeReport = process.argv.includes('--write-report')
const jsonOutput = process.argv.includes('--json')

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function u32(buffer, offset) {
  return buffer.readUInt32BE(offset)
}

function inspectPng(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { valid: false, reason: 'invalid-png-signature' }
  let offset = 8
  let width = 0
  let height = 0
  let sawIend = false
  while (offset + 12 <= buffer.length) {
    const length = u32(buffer, offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > buffer.length) return { valid: false, reason: `png-chunk-out-of-bounds:${type}` }
    if (type === 'IHDR' && length >= 8) {
      width = u32(buffer, offset + 8)
      height = u32(buffer, offset + 12)
    }
    if (type === 'IEND') {
      sawIend = true
      if (length !== 0 || end !== buffer.length) return { valid: false, reason: 'png-truncated-after-iend' }
      break
    }
    offset = end
  }
  if (!sawIend) return { valid: false, reason: 'png-missing-iend' }
  if (!width || !height) return { valid: false, reason: 'png-missing-dimensions' }
  return { valid: true, mime: 'image/png', width, height }
}

function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) return { valid: false, reason: 'jpeg-missing-soi-or-eoi' }
  let offset = 2
  let width = 0
  let height = 0
  let sawScan = false
  while (offset < buffer.length - 2) {
    if (buffer[offset] !== 0xff) return { valid: false, reason: 'jpeg-marker-boundary-invalid' }
    while (buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset++]
    if (marker === 0xd9) break
    if (marker === 0xda) {
      sawScan = true
      let scan = offset + 2 <= buffer.length ? buffer.readUInt16BE(offset) : 0
      if (!scan || offset + scan > buffer.length) return { valid: false, reason: 'jpeg-sos-truncated' }
      offset += scan
      let foundEoi = false
      while (offset < buffer.length - 1) {
        if (buffer[offset++] !== 0xff) continue
        let next = buffer[offset]
        while (next === 0xff) {
          offset += 1
          next = buffer[offset]
        }
        if (next === 0x00) {
          offset += 1
          continue
        }
        if (next === 0xd9) {
          foundEoi = true
          break
        }
        if (next === 0xd8 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 1
          continue
        }
        // A restart/scan marker with a length is allowed in malformed input
        // only when it remains within the byte stream; otherwise fail closed.
        offset += 1
      }
      if (!foundEoi) return { valid: false, reason: 'jpeg-scan-missing-eoi' }
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) return { valid: false, reason: 'jpeg-segment-length-truncated' }
    const length = buffer.readUInt16BE(offset)
    if (length < 2 || offset + length > buffer.length) return { valid: false, reason: 'jpeg-segment-out-of-bounds' }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return { valid: false, reason: 'jpeg-sof-truncated' }
      height = buffer.readUInt16BE(offset + 3)
      width = buffer.readUInt16BE(offset + 5)
    }
    offset += length
  }
  if (!sawScan || !width || !height) return { valid: false, reason: 'jpeg-missing-decodable-frame' }
  return { valid: true, mime: 'image/jpeg', width, height }
}

function inspectWebp(buffer) {
  if (buffer.length < 16 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return { valid: false, reason: 'invalid-webp-riff' }
  const declaredEnd = 8 + buffer.readUInt32LE(4)
  if (declaredEnd !== buffer.length) return { valid: false, reason: 'webp-declared-length-mismatch' }
  let offset = 12
  let width = 0
  let height = 0
  let frame = false
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const end = offset + 8 + size + (size % 2)
    if (end > buffer.length) return { valid: false, reason: `webp-chunk-out-of-bounds:${type}` }
    if (type === 'VP8X' && size >= 10) {
      width = 1 + buffer.readUIntLE(offset + 12, 3)
      height = 1 + buffer.readUIntLE(offset + 15, 3)
      frame = true
    } else if (type === 'VP8 ' && size >= 10) {
      width = buffer.readUInt16LE(offset + 14) & 0x3fff
      height = buffer.readUInt16LE(offset + 16) & 0x3fff
      frame = true
    } else if (type === 'VP8L' && size >= 5 && buffer[offset + 8] === 0x2f) {
      const bits = buffer.readUInt32LE(offset + 9)
      width = 1 + (bits & 0x3fff)
      height = 1 + ((bits >>> 14) & 0x3fff)
      frame = true
    }
    offset = end
  }
  if (offset !== buffer.length || !frame || !width || !height) return { valid: false, reason: 'webp-missing-decodable-frame' }
  return { valid: true, mime: 'image/webp', width, height }
}

function inspectImage(filePath) {
  let buffer
  try {
    buffer = fs.readFileSync(filePath)
  } catch {
    return { valid: false, reason: 'asset-missing' }
  }
  if (!buffer.length) return { valid: false, reason: 'asset-empty' }
  const extension = path.extname(filePath).toLowerCase()
  const details = extension === '.png' ? inspectPng(buffer) : extension === '.webp' ? inspectWebp(buffer) : inspectJpeg(buffer)
  return { ...details, byteLength: buffer.length, sha256: sha256(buffer) }
}

function safeAssetPath(url) {
  const value = String(url || '')
  if (!value.startsWith('/question-assets/')) return null
  let relative
  try {
    relative = decodeURIComponent(value.slice('/question-assets/'.length))
  } catch {
    return null
  }
  const candidate = path.resolve(assetRoot, relative)
  const rootPrefix = assetRoot.endsWith(path.sep) ? assetRoot : `${assetRoot}${path.sep}`
  return candidate === assetRoot || candidate.startsWith(rootPrefix) ? candidate : null
}

function pageFromUrl(url, scheme) {
  return scheme === 'qp' ? sourcePageFromAssetUrl(url) : documentPageFromAssetUrl(url)
}

function auditDocument(ref, scheme, label) {
  const issues = []
  const assets = []
  const start = Number(ref?.pageStart)
  const end = Number(ref?.pageEnd ?? ref?.pageStart)
  const urls = Array.isArray(ref?.assetUrls) ? [...new Set(ref.assetUrls.map((url) => String(url || '').trim()).filter(Boolean))] : []
  if (!(ref?.file || ref?.paper) || !/^[a-f0-9]{64}$/i.test(String(ref?.sha256 || ''))) issues.push(`${label}-document-provenance-missing`)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) issues.push(`${label}-page-range-invalid`)
  if (!urls.length) issues.push(`${label}-assets-missing`)
  const pages = new Set()
  for (const url of urls) {
    const page = pageFromUrl(url, scheme)
    if (!Number.isInteger(page)) {
      issues.push(`${label}-asset-page-unreadable:${url}`)
      continue
    }
    if (pages.has(page)) issues.push(`${label}-duplicate-asset-page:${page}`)
    pages.add(page)
    if (Number.isInteger(start) && Number.isInteger(end) && (page < start || page > end)) issues.push(`${label}-asset-page-outside-range:${page}`)
    const filePath = safeAssetPath(url)
    if (!filePath) {
      issues.push(`${label}-asset-path-untrusted:${url}`)
      continue
    }
    const image = inspectImage(filePath)
    assets.push({ page, url, ...image })
    if (!image.valid) issues.push(`${label}-${image.reason}:${page}`)
  }
  if (Number.isInteger(start) && Number.isInteger(end)) {
    for (let page = start; page <= end; page += 1) if (!pages.has(page)) issues.push(`${label}-asset-page-missing:${page}`)
  }
  return { issues: [...new Set(issues)], assets }
}

function canonicalLabel(value) {
  return String(value || '').toLowerCase().replace(/[\s()]/g, '')
}

function printedQuestionNumber(question) {
  const match = String(question?.sourceRef?.question || question?.questionId || '').match(/(?:^|:)q(\d+)$/i)
  return match ? Number(match[1]) : null
}

function auditQuestion(question, answer, binding) {
  const issues = []
  const qp = auditDocument(question.sourceRef, 'qp', 'qp')
  const ms = auditDocument(answer?.answerRef, 'ms', 'ms')
  issues.push(...qp.issues, ...ms.issues)
  const questionParts = Array.isArray(question.parts) ? question.parts : []
  const answerParts = Array.isArray(answer?.answerParts) ? answer.answerParts : []
  if (!questionParts.length) issues.push('question-parts-missing')
  if (!answerParts.length) issues.push('mark-scheme-parts-missing')
  const questionLabels = questionParts.map((part) => canonicalLabel(part.label || part.partId))
  const answerLabels = answerParts.map((part) => canonicalLabel(part.label || part.partId))
  if (new Set(questionLabels).size !== questionLabels.length) issues.push('question-part-label-duplicate')
  if (new Set(answerLabels).size !== answerLabels.length) issues.push('mark-scheme-part-label-duplicate')
  if (questionParts.length !== answerParts.length || questionLabels.some((label) => !answerLabels.includes(label))) issues.push('question-mark-scheme-parts-not-closed')
  const questionMarks = questionParts.reduce((sum, part) => sum + Number(part.marks || 0), 0)
  const answerMarks = answerParts.reduce((sum, part) => sum + Number(part.marks || 0), 0)
  if (!Number.isInteger(Number(question.totalMarks)) || Number(question.totalMarks) <= 0) issues.push('question-total-marks-invalid')
  if (questionMarks !== Number(question.totalMarks)) issues.push(`question-marks-do-not-sum:${questionMarks}/${question.totalMarks}`)
  if (answerMarks !== Number(question.totalMarks)) issues.push(`mark-scheme-marks-do-not-sum:${answerMarks}/${question.totalMarks}`)
  const qpPages = new Set(qp.assets.map((asset) => asset.page))
  const msPages = new Set(ms.assets.map((asset) => asset.page))
  for (const part of questionParts) {
    const page = Number(part.sourcePage)
    if (!Number.isInteger(page) || !qpPages.has(page)) issues.push(`question-part-page-unbound:${part.partId || part.label}`)
  }
  for (const part of answerParts) {
    const page = Number(part.sourcePage)
    if (!Number.isInteger(page) || !msPages.has(page)) issues.push(`mark-scheme-part-page-unbound:${part.partId || part.label}`)
  }
  const reviewed = binding?.verificationStatus === 'reviewed'
  if (reviewed) {
    const evidence = binding.reviewEvidence
    if (evidence?.method !== 'paired-qp-ms-page-review' || !binding.reviewedBy || !binding.reviewedAt) issues.push('review-evidence-incomplete')
    if (!Array.isArray(evidence?.partAllocations) || evidence.partAllocations.length !== questionParts.length) issues.push('review-part-allocation-incomplete')
    if (questionParts.some((part) => !Array.isArray(part.sourceEvidence) || !part.sourceEvidence.length) || answerParts.some((part) => !Array.isArray(part.markSchemeEvidence) || !part.markSchemeEvidence.length)) issues.push('review-asset-evidence-incomplete')
    for (const part of questionParts) {
      for (const evidenceEntry of part.sourceEvidence || []) {
        const asset = qp.assets.find((candidate) => candidate.page === Number(evidenceEntry.page) && candidate.url === evidenceEntry.assetUrl)
        if (!asset || asset.sha256 !== String(evidenceEntry.assetSha256 || '').toLowerCase()) issues.push(`review-qp-asset-sha-mismatch:${part.partId || part.label}`)
        if (String(evidenceEntry.documentSha256 || '').toLowerCase() !== String(question.sourceRef?.sha256 || '').toLowerCase()) issues.push(`review-qp-document-sha-mismatch:${part.partId || part.label}`)
      }
    }
    for (const part of answerParts) {
      for (const evidenceEntry of part.markSchemeEvidence || []) {
        const evidencePage = Number(evidenceEntry.sourcePage ?? evidenceEntry.page)
        const asset = ms.assets.find((candidate) => candidate.page === evidencePage && candidate.url === evidenceEntry.assetUrl)
        if (!asset || asset.sha256 !== String(evidenceEntry.assetSha256 || '').toLowerCase()) issues.push(`review-ms-asset-sha-mismatch:${part.partId || part.label}`)
        if (String(evidenceEntry.documentSha256 || '').toLowerCase() !== String(answer?.answerRef?.sha256 || '').toLowerCase()) issues.push(`review-ms-document-sha-mismatch:${part.partId || part.label}`)
      }
    }
  }
  const status = issues.length ? 'semantic-quarantined' : reviewed ? 'verified-complete' : 'unreviewed'
  if (!reviewed && binding?.verificationStatus !== 'machine-indexed' && binding?.verificationStatus !== 'quarantined') issues.push('unexpected-binding-status')
  return { status, issues: [...new Set(issues)], qpAssets: qp.assets, msAssets: ms.assets }
}

const questions = (importedIndex.questions || []).filter((question) => String(question.subjectCode) === '9709')
const answersById = new Map((importedIndex.answers || []).map((answer) => [answer.answerId, answer]))
const bindingsByQuestionId = new Map((importedIndex.bindings || []).map((binding) => [binding.questionId, binding]))
const records = questions.map((question) => {
  const answer = answersById.get(question.answerId)
  const binding = bindingsByQuestionId.get(question.questionId)
  return { questionId: question.questionId, paperId: question.sourceRef?.paperId || null, questionNumber: printedQuestionNumber(question), component: Number(question.sourceRef?.component || 0) || null, bindingStatus: binding?.verificationStatus || null, ...auditQuestion(question, answer, binding) }
})

const byPaper = new Map()
for (const record of records) {
  const list = byPaper.get(record.paperId) || []
  list.push(record)
  byPaper.set(record.paperId, list)
}
const paperIssues = []
for (const [paperId, paperRecords] of byPaper) {
  const sorted = paperRecords.filter((record) => Number.isInteger(record.questionNumber)).toSorted((left, right) => left.questionNumber - right.questionNumber)
  const numbers = sorted.map((record) => record.questionNumber)
  const missing = []
  for (let number = numbers[0] || 0; number <= (numbers.at(-1) || 0); number += 1) if (!numbers.includes(number)) missing.push(number)
  if (missing.length) paperIssues.push({ paperId, reason: 'question-number-gap', missingQuestionNumbers: missing })
  const rangeCandidates = sorted.slice(0, -1).flatMap((record, index) => {
    const next = sorted[index + 1]
    const pageEnd = Number((questions.find((question) => question.questionId === record.questionId)?.sourceRef?.pageEnd))
    const pageStart = Number((questions.find((question) => question.questionId === next.questionId)?.sourceRef?.pageStart))
    return Number.isInteger(pageEnd) && Number.isInteger(pageStart) && pageEnd < pageStart - 1
      ? [{ questionId: record.questionId, nextQuestionId: next.questionId, reason: 'source-range-gap-candidate' }]
      : []
  })
  if (rangeCandidates.length) paperIssues.push(...rangeCandidates)
}

const summary = {
  total: records.length,
  verifiedComplete: records.filter((record) => record.status === 'verified-complete').length,
  unreviewed: records.filter((record) => record.status === 'unreviewed').length,
  semanticQuarantined: records.filter((record) => record.status === 'semantic-quarantined').length,
  machineIndexed: records.filter((record) => record.bindingStatus === 'machine-indexed').length,
  papers: byPaper.size,
  papersWithQuestionNumberGaps: new Set(paperIssues.filter((issue) => issue.reason === 'question-number-gap').map((issue) => issue.paperId)).size,
  rangeGapCandidates: paperIssues.filter((issue) => issue.reason === 'source-range-gap-candidate').length,
  reviewedFailures: records.filter((record) => record.bindingStatus === 'reviewed' && record.issues.length > 0).length,
}
const report = { schemaVersion: '9709-second-pass-audit-v1', generatedAt: new Date().toISOString(), assetRoot, summary, paperIssues, records }
if (writeReport) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
}
if (summary.reviewedFailures > 0) process.exitCode = 1
const stdout = jsonOutput
  ? { ...report, reportPath: writeReport ? path.relative(root, reportPath).replaceAll('\\', '/') : null }
  : {
      schemaVersion: report.schemaVersion,
      generatedAt: report.generatedAt,
      summary,
      blockers: paperIssues,
      reportPath: writeReport ? path.relative(root, reportPath).replaceAll('\\', '/') : null,
    }
console.log(JSON.stringify(stdout, null, 2))
