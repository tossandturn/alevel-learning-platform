import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getExamPaperProfile } from '../src/data/examStructure.js'

const projectRoot = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.resolve(process.env.CIE_SOURCE_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output')
const manifestPath = path.join(sourceRoot, 'cie-fraft-manifest.json')
const extraManifestPath = path.join(sourceRoot, 'extra-contests-manifest.json')
const pdfRoot = path.join(sourceRoot, 'pdf')
const outputPath = path.join(projectRoot, 'public', 'data', 'papers.json')
const allowedSubjects = new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709'])
const extraSubjects = new Set(['bpho', 'amc12', 'esat', 'tmua'])

const extraSubjectNames = {
  bpho: 'British Physics Olympiad',
  amc12: 'AMC 12',
  esat: 'ESAT',
  tmua: 'TMUA',
}

function checksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function parseFileName(fileName) {
  const match = /^(\d{4})_([msw])(\d{2})_([a-z]+)(?:_(.+))?\.pdf$/i.exec(fileName)
  if (!match) return { sessionCode: '', variant: '', documentCode: '' }
  const variant = match[5] || ''
  return {
    sessionCode: `${match[2].toLowerCase()}${match[3]}`,
    documentCode: match[4].toLowerCase(),
    variant: /^\d+$/.test(variant) ? String(Number(variant)) : variant,
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).filter((item) => allowedSubjects.has(item.subject))
const prepared = []
let missingManifestFiles = 0

for (const [index, item] of manifest.entries()) {
  const filePath = path.join(pdfRoot, item.subject, item.file)
  if (!fs.existsSync(filePath)) {
    missingManifestFiles += 1
    continue
  }
  const stat = fs.statSync(filePath)
  const parsed = parseFileName(item.file)
  const pairKey = parsed.sessionCode && parsed.variant ? `${item.subject}-${parsed.sessionCode}-${parsed.variant}` : null
  const examProfile = getExamPaperProfile(item.subject, parsed.variant, item.year)
  prepared.push({
    id: `cie-${item.subject}-${item.file.replace(/\.pdf$/i, '')}`,
    subject: item.subject,
    year: item.year,
    season: item.season,
    kind: item.kind,
    file: item.file,
    sessionCode: parsed.sessionCode,
    documentCode: parsed.documentCode || item.kind,
    variant: parsed.variant,
    pairKey,
    examProfile,
    bytes: stat.size,
    sha256: await checksum(filePath),
    localUrl: `/local-pdf/${item.subject}/${encodeURIComponent(item.file)}`,
    sourceUrl: item.url,
    provenance: 'Local copy from cie.fraft.cn manifest',
    copyrightStatus: 'Official exam material; personal study library',
  })
  if ((index + 1) % 500 === 0) process.stdout.write(`Hashed ${index + 1}/${manifest.length}\n`)
}

if (missingManifestFiles) process.stdout.write(`Skipped ${missingManifestFiles} manifest entries without local files.\n`)

function extraPaperProfile(item) {
  const paperNumberMatch = item.file.match(/(?:paper[-_ ]?|_s)(\d)/i)
  const paperNumber = paperNumberMatch ? Number(paperNumberMatch[1]) : null
  const meta = extraPaperMeta(item)
  const isMcq = item.kind === 'qp' && (item.subject === 'amc12' || item.subject === 'tmua' || item.subject === 'esat')
  return {
    subject: item.subject,
    paperNumber,
    paperNumbers: paperNumber ? [paperNumber] : [],
    code: `${item.subject}/${item.year || 'specimen'}${item.season && item.season !== 'main' ? item.season : ''}`,
    sourceUrl: item.sourcePage || item.url,
    syllabusUrl: item.sourcePage || item.url,
    qualification: item.qualification || meta.title,
    title: meta.title,
    mode: isMcq ? 'mcq' : item.kind === 'guide' ? 'reference' : 'structured',
    durationMinutes: meta.durationMinutes,
    maxMarks: meta.questionCount,
    defaultQuestionCount: meta.questionCount,
    questionCountRange: meta.questionCount ? [meta.questionCount, meta.questionCount] : [1, 30],
    stages: [item.season || 'practice'],
    routeIds: [],
    syllabusEra: 'contest-archive',
  }
}

function extraPaperMeta(item) {
  const file = item.file.toLowerCase()
  const title = item.qualification || extraSubjectNames[item.subject] || item.subject.toUpperCase()
  if (item.kind !== 'qp') return { title, durationMinutes: null, questionCount: null }
  if (item.subject === 'amc12') return { title: 'AMC 12', durationMinutes: 75, questionCount: 25 }
  if (item.subject === 'tmua') return { title: 'TMUA', durationMinutes: 75, questionCount: 20 }
  if (item.subject === 'esat') {
    if (file.startsWith('engaa_')) return { title: 'ENGAA Section 1', durationMinutes: 60, questionCount: 40 }
    if (file.startsWith('nsaa_')) {
      const legacyFormat = Number(item.year) <= 2019
      return { title: 'NSAA Section 1', durationMinutes: legacyFormat ? 80 : 60, questionCount: legacyFormat ? 54 : 40 }
    }
    return { title: 'ESAT', durationMinutes: 40, questionCount: 27 }
  }
  return { title, durationMinutes: null, questionCount: null }
}

function extraKind(item) {
  const file = item.file.toLowerCase()
  if (item.subject === 'bpho' && /(?:^|[_\-\s])mark(?:[_\-\s.]|$)/.test(file)) return 'ms'
  return item.kind
}

function extraOfficialYear(item) {
  if (item.subject !== 'bpho' || item.season !== 'pc') return { year: item.year, yearSource: 'manifest' }
  const legacyFileYear = Number(item.file.match(/^BPhO_Paper1_(20\d{2})_/i)?.[1])
  if (legacyFileYear >= 2005 && legacyFileYear <= 2011) {
    return { year: legacyFileYear - 1, yearSource: 'official source-page heading' }
  }
  return { year: item.year, yearSource: 'manifest' }
}

function extraPairKey(item) {
  const file = item.file.toLowerCase()
  if (item.subject === 'amc12') return `amc12-${item.year}-${item.season || 'main'}`
  if (item.subject === 'tmua') {
    const paper = file.match(/paper-(\d)/)?.[1]
    const specimen = file.includes('early-specimen') ? 'early-specimen' : item.year
    return paper ? `tmua-${specimen}-p${paper}` : null
  }
  if (item.subject === 'esat') {
    const match = item.file.match(/^([A-Z]+)_(\d{4})_(S\d)/i)
    return match ? `esat-${match[1].toLowerCase()}-${match[2]}-${match[3].toLowerCase()}` : null
  }
  if (item.subject === 'bpho') {
    return item.file
      .toLowerCase()
      .replace(/\.pdf$/, '')
      .replace(/(?:_qp|_ms|_marking2?|_mark|_checklist)$/, '')
      .replace(/(?:^|_)marking$/, '')
  }
  return null
}

if (fs.existsSync(extraManifestPath)) {
  const extraManifest = JSON.parse(fs.readFileSync(extraManifestPath, 'utf8')).filter((item) => extraSubjects.has(item.subject) && item.downloaded !== 'missing')
  for (const item of extraManifest) {
    const kind = extraKind(item)
    const officialYear = extraOfficialYear(item)
    const normalisedItem = { ...item, kind, year: officialYear.year }
    const filePath = path.join(pdfRoot, item.subject, item.file)
    if (!fs.existsSync(filePath)) throw new Error(`Missing extra manifest file: ${filePath}`)
    const stat = fs.statSync(filePath)
    const pairKey = extraPairKey(normalisedItem)
    prepared.push({
      id: `${item.subject}-${item.file.replace(/\.pdf$/i, '')}`,
      subject: item.subject,
      year: normalisedItem.year,
      yearSource: officialYear.yearSource,
      season: item.season || '',
      kind,
      file: item.file,
      sessionCode: item.season || '',
      documentCode: kind,
      variant: '',
      pairKey,
      examProfile: extraPaperProfile(normalisedItem),
      bytes: stat.size,
      sha256: await checksum(filePath),
      localUrl: `/local-pdf/${item.subject}/${encodeURIComponent(item.file)}`,
      sourceUrl: item.url,
      sourcePage: item.sourcePage,
      board: item.board,
      qualification: item.qualification,
      provenance: item.provenance,
      copyrightStatus: item.copyrightStatus,
    })
  }
}

const byPairAndKind = new Map(prepared.map((item) => [`${item.pairKey}:${item.kind}`, item.id]))
const markSchemesBySession = new Map()
for (const item of prepared.filter((entry) => entry.kind === 'ms')) {
  const key = `${item.subject}:${item.sessionCode}`
  markSchemesBySession.set(key, [...(markSchemesBySession.get(key) || []), item])
}

function resolveMarkSchemeId(item) {
  const exact = item.pairKey ? byPairAndKind.get(`${item.pairKey}:ms`) : null
  if (exact || item.kind !== 'qp') return exact || null
  const exactAnswerKey = item.pairKey ? byPairAndKind.get(`${item.pairKey}:ak`) : null
  if (exactAnswerKey) return exactAnswerKey

  const candidates = markSchemesBySession.get(`${item.subject}:${item.sessionCode}`) || []
  const shared = candidates.filter((candidate) =>
    candidate.variant.includes('+') && candidate.variant.split('+').includes(item.variant),
  )
  if (shared.length === 1) return shared[0].id

  const general = candidates.filter((candidate) => !candidate.variant)
  return general.length === 1 ? general[0].id : null
}

const items = prepared.map((item) => ({
  ...item,
  questionPaperId: item.pairKey ? byPairAndKind.get(`${item.pairKey}:qp`) || null : null,
  markSchemeId: resolveMarkSchemeId(item),
}))

const totals = items.reduce(
  (acc, item) => {
    acc.files += 1
    acc.bytes += item.bytes
    acc.bySubject[item.subject] = (acc.bySubject[item.subject] || 0) + 1
    acc.byKind[item.kind] = (acc.byKind[item.kind] || 0) + 1
    if (item.kind === 'qp') {
      acc.questionPapers += 1
      if (item.markSchemeId) acc.pairedQuestionPapers += 1
      else acc.unpairedQuestionPapers += 1
    }
    return acc
  },
  { files: 0, bytes: 0, bySubject: {}, byKind: {}, questionPapers: 0, pairedQuestionPapers: 0, unpairedQuestionPapers: 0 },
)

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), sourceRoot, totals, items }, null, 2)}\n`,
)
console.log(`Wrote ${items.length} records to ${outputPath}`)
