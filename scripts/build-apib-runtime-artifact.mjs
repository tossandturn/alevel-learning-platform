import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const AP_IB_PRACTICE_ROUTES = Object.freeze([
  Object.freeze({ id: 'ap-physics-1-mcq-study', board: 'ap', course: 'physics-1', label: 'AP Physics 1 MCQ', authority: 'ai-provisional' }),
  Object.freeze({ id: 'ap-physics-c-em-mcq-study', board: 'ap', course: 'physics-c-em', label: 'AP Physics C: Electricity and Magnetism MCQ', authority: 'ai-provisional' }),
])

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export async function fileSha256(filePath) {
  return sha256(await fs.readFile(filePath))
}

function routeForCourse(course) {
  const route = AP_IB_PRACTICE_ROUTES.find((candidate) => candidate.course === course)
  if (!route) throw new Error(`Unsupported AP/IB practice course: ${course}`)
  return route
}

function slug(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function topicBindings(record) {
  const binding = record.officialBinding
  if (!binding) throw new Error(`Official binding missing: ${record.groupId}`)
  if (binding.topic) {
    return [{ id: `ap-c-em-topic-${slug(binding.topic)}`, label: binding.topic, sourceId: binding.topic, dimension: 'official-topic' }]
  }
  if (!Array.isArray(binding.essentialKnowledgeIds) || !binding.essentialKnowledgeIds.length) {
    throw new Error(`Official essential-knowledge binding missing: ${record.groupId}`)
  }
  return [...new Set(binding.essentialKnowledgeIds)].map((sourceId) => ({
    id: `ap-p1-ek-${slug(sourceId)}`,
    label: `Essential Knowledge ${sourceId}`,
    sourceId,
    dimension: 'official-essential-knowledge',
  }))
}

function optionSet(value) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !/^[A-E]$/.test(String(item)))) throw new Error('Invalid answer option set')
  const result = [...new Set(value.map(String))].sort()
  if (result.length !== value.length) throw new Error('Duplicate answer option')
  return result
}

function assertNoPublicAnswers(value, pathLabel = 'public') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoPublicAnswers(item, `${pathLabel}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/correct|answerHash|markScheme|gatewayEnvelope|qwenEnvelope|bindingHash/i.test(key)) {
      throw new Error(`Private answer/review field leaked at ${pathLabel}.${key}`)
    }
    assertNoPublicAnswers(child, `${pathLabel}.${key}`)
  }
}

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || argv[index + 1] === undefined) throw new Error('Arguments must be --name value pairs')
    values.set(argv[index].slice(2), argv[index + 1])
  }
  return values
}

export async function buildApIbRuntimeCandidate({ handoffPath, sourceAssetsPath, outputRoot, createdAt = new Date().toISOString() }) {
  const [handoffBytes, sourceAssetBytes] = await Promise.all([fs.readFile(handoffPath), fs.readFile(sourceAssetsPath)])
  const handoff = JSON.parse(handoffBytes.toString('utf8'))
  const sourceAssets = JSON.parse(sourceAssetBytes.toString('utf8'))
  const records = handoff.records.filter((record) => record.reviewStatus === 'candidate_ai_checked_official_bound')
  if (records.length !== 145 || sourceAssets.questionCount !== 145 || sourceAssets.rightsStatus !== 'licensed') {
    throw new Error('AP/IB runtime candidate requires exactly 145 licensed, dual-reviewed, officially bound records')
  }
  const assetIdsByQuestion = new Map(sourceAssets.questions.map((entry) => [entry.questionId, entry.assetIds]))
  const assetById = new Map(sourceAssets.assets.map((asset) => [asset.id, asset]))
  if (assetById.size !== sourceAssets.assets.length) throw new Error('Duplicate source asset IDs')

  const topicById = new Map()
  const publicQuestions = []
  const privateAnswers = []
  for (const record of records) {
    if (record.dualModelReview?.aiCheck !== true || record.dualModelReview?.answerCheck !== true) throw new Error(`Independent review missing: ${record.groupId}`)
    const route = routeForCourse(record.course)
    const topics = topicBindings(record)
    topics.forEach((topic) => topicById.set(topic.id, { ...topic, routeId: route.id }))
    const assetIds = assetIdsByQuestion.get(record.groupId)
    if (!Array.isArray(assetIds) || !assetIds.length || assetIds.some((id) => !assetById.has(id))) throw new Error(`Source asset binding missing: ${record.groupId}`)
    const options = optionSet(record.options)
    const correctOptions = optionSet(record.correctOptions)
    if (correctOptions.some((option) => !options.includes(option))) throw new Error(`Answer is outside option set: ${record.groupId}`)
    const sourcePages = [...new Set(record.sourceEvidence.filter((entry) => entry.kind === 'qp').map((entry) => entry.page))].sort((a, b) => a - b)
    publicQuestions.push({
      id: record.groupId,
      paperId: record.paperId,
      questionNumber: record.questionNumber,
      routeId: route.id,
      topicIds: topics.map((topic) => topic.id),
      answerMode: record.answerMode,
      options,
      source: {
        questionPdfSha256: record.sourcePdfSha256.qp,
        pages: sourcePages,
        assetIds,
      },
      quality: { label: 'AI checked', authority: 'ai-provisional', formalProgressEligible: false },
    })
    privateAnswers.push({
      questionId: record.groupId,
      correctOptions,
      answerHash: record.answerHash,
      markSchemePdfSha256: record.sourcePdfSha256.ms,
      review: {
        independentPassCount: 2,
        gatewayEnvelopeHash: record.dualModelReview.gatewayEnvelopeHash,
        qwenEnvelopeHash: record.dualModelReview.qwenEnvelopeHash,
        packetHash: record.dualModelReview.packetHash,
        officialBindingHash: record.officialBinding.bindingHash,
      },
    })
  }

  publicQuestions.sort((left, right) => left.routeId.localeCompare(right.routeId) || left.paperId.localeCompare(right.paperId) || left.questionNumber - right.questionNumber)
  privateAnswers.sort((left, right) => left.questionId.localeCompare(right.questionId))
  const topics = [...topicById.values()].sort((left, right) => left.routeId.localeCompare(right.routeId) || left.id.localeCompare(right.id))
    .map((topic) => ({ ...topic, questionCount: publicQuestions.filter((question) => question.topicIds.includes(topic.id)).length }))
  const routes = AP_IB_PRACTICE_ROUTES.map((route) => ({
    ...route,
    formalProgressEligible: false,
    questionCount: publicQuestions.filter((question) => question.routeId === route.id).length,
    topics: topics.filter((topic) => topic.routeId === route.id),
  }))

  const publicCatalog = { schemaVersion: 'apib-curriculum-practice-public.v1', createdAt, authority: 'ai-provisional', formalProgressEligible: false, routes, questions: publicQuestions }
  const privateIndex = { schemaVersion: 'apib-curriculum-practice-private.v1', createdAt, authority: 'ai-provisional', formalProgressEligible: false, answers: privateAnswers }
  assertNoPublicAnswers(publicCatalog)

  await fs.mkdir(outputRoot, { recursive: true })
  const publicPath = path.join(outputRoot, 'public-catalog.json')
  const privatePath = path.join(outputRoot, 'private-answer-index.json')
  const copiedAssetsPath = path.join(outputRoot, 'source-assets.json')
  const candidatePath = path.join(outputRoot, 'candidate-manifest.json')
  for (const target of [publicPath, privatePath, copiedAssetsPath, candidatePath]) {
    if ((await fs.stat(target, { throwIfNoEntry: false }))?.isFile()) throw new Error(`Refusing to overwrite ${target}`)
  }
  await Promise.all([
    fs.writeFile(publicPath, `${JSON.stringify(publicCatalog, null, 2)}\n`, 'utf8'),
    fs.writeFile(privatePath, `${JSON.stringify(privateIndex, null, 2)}\n`, 'utf8'),
    fs.writeFile(copiedAssetsPath, sourceAssetBytes),
  ])
  const files = {
    publicCatalog: { name: path.basename(publicPath), sha256: await fileSha256(publicPath) },
    privateAnswerIndex: { name: path.basename(privatePath), sha256: await fileSha256(privatePath) },
    sourceAssets: { name: path.basename(copiedAssetsPath), sha256: await fileSha256(copiedAssetsPath) },
  }
  const candidate = {
    schemaVersion: 'apib-curriculum-practice-candidate.v1',
    status: 'candidate',
    createdAt,
    source: { handoffSha256: sha256(handoffBytes), sourceAssetsSha256: sha256(sourceAssetBytes) },
    files,
    routes: routes.map((route) => ({ id: route.id, questionCount: route.questionCount })),
    totals: { questions: publicQuestions.length, topics: topics.length, sourceAssets: sourceAssets.assetCount },
    rights: { status: 'licensed', sourceManifestHash: sourceAssets.manifestHash },
    review: { independentPassCount: 2, officiallyBoundQuestions: publicQuestions.length },
    release: { studentStudyEligible: false, formalProgressEligible: false, practiceReady: false },
  }
  candidate.candidateHash = sha256(Buffer.from(canonicalJson(candidate), 'utf8'))
  await fs.writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8')
  return { outputRoot, publicPath, privatePath, sourceAssetsPath: copiedAssetsPath, candidatePath, candidate }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  const required = (name) => {
    const value = args.get(name)
    if (!value) throw new Error(`Missing --${name}`)
    return path.resolve(value)
  }
  const result = await buildApIbRuntimeCandidate({ handoffPath: required('handoff'), sourceAssetsPath: required('source-assets'), outputRoot: required('output-root') })
  console.log(JSON.stringify({ status: 'PASS', outputRoot: result.outputRoot, candidateHash: result.candidate.candidateHash, totals: result.candidate.totals }))
}
