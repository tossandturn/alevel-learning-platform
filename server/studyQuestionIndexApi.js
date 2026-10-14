import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
export const STUDY_QUESTION_INDEX_ROOT = path.join(SERVER_ROOT, 'data', 'study-question-index')
const PUBLIC_MANIFEST = path.resolve(SERVER_ROOT, '..', 'public', 'data', 'study-question-index', 'manifest.json')
const MAX_FRAGMENT_BYTES = 4 * 1024 * 1024
const ROUTE_ID = /^[a-z0-9][a-z0-9-]{1,119}$/

function failure(statusCode, code, message) {
  throw Object.assign(new Error(message), { statusCode, code })
}

function exactKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === [...keys].sort().join('|'))
}

function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`
}

function loadManifest(manifestPath) {
  const stat = fs.lstatSync(manifestPath)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) failure(503, 'study_question_index_invalid', 'The study question manifest is unavailable.')
  const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!exactKeys(value, ['schemaVersion', 'sourceIndexSha256', 'routes'])
      || value.schemaVersion !== 'study-question-fragment-manifest-v1'
      || !/^[a-f0-9]{64}$/.test(value.sourceIndexSha256)
      || !Array.isArray(value.routes) || value.routes.length > 100) {
    failure(503, 'study_question_index_invalid', 'The study question manifest is invalid.')
  }
  const routes = new Map()
  for (const entry of value.routes) {
    if (!exactKeys(entry, ['routeId', 'file', 'questionCount'])
        || !ROUTE_ID.test(entry.routeId)
        || entry.file !== `${entry.routeId}.json`
        || !Number.isInteger(entry.questionCount) || entry.questionCount < 0 || entry.questionCount > 20_000
        || routes.has(entry.routeId)) {
      failure(503, 'study_question_index_invalid', 'The study question manifest route is invalid.')
    }
    routes.set(entry.routeId, Object.freeze({ ...entry }))
  }
  return Object.freeze({ sourceIndexSha256: value.sourceIndexSha256, routes, identity: fileIdentity(stat) })
}

export function createStudyQuestionIndexReader({ indexRoot = STUDY_QUESTION_INDEX_ROOT, manifestPath = PUBLIC_MANIFEST } = {}) {
  const resolvedRoot = path.resolve(indexRoot)
  const resolvedManifest = path.resolve(manifestPath)
  const rootStat = fs.lstatSync(resolvedRoot)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) failure(503, 'study_question_index_invalid', 'The private study question root is invalid.')
  const physicalRoot = fs.realpathSync(resolvedRoot)
  let manifestCache = null
  const fragments = new Map()

  function currentManifest() {
    let stat
    try { stat = fs.lstatSync(resolvedManifest) } catch { failure(503, 'study_question_index_unavailable', 'The study question manifest is unavailable.') }
    if (stat.isSymbolicLink() || !stat.isFile()) failure(503, 'study_question_index_invalid', 'The study question manifest is invalid.')
    const identity = fileIdentity(stat)
    if (manifestCache?.identity === identity) return manifestCache
    manifestCache = loadManifest(resolvedManifest)
    return manifestCache
  }

  function readRecord(routeId) {
    const normalizedRouteId = String(routeId || '').trim()
    if (!ROUTE_ID.test(normalizedRouteId)) failure(400, 'study_question_route_invalid', 'A valid study question route is required.')
    const manifest = currentManifest()
    const expected = manifest.routes.get(normalizedRouteId)
    if (!expected) failure(404, 'study_question_route_not_found', 'The study question route was not found.')

    const filePath = path.resolve(resolvedRoot, expected.file)
    const relative = path.relative(resolvedRoot, filePath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) failure(503, 'study_question_index_invalid', 'The study question path is invalid.')
    let stat
    try { stat = fs.lstatSync(filePath) } catch { failure(503, 'study_question_index_unavailable', 'The study question route is unavailable.') }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_FRAGMENT_BYTES) failure(503, 'study_question_index_invalid', 'The study question route is invalid.')
    const physicalFile = fs.realpathSync(filePath)
    const physicalRelative = path.relative(physicalRoot, physicalFile)
    if (!physicalRelative || physicalRelative.startsWith('..') || path.isAbsolute(physicalRelative)) failure(503, 'study_question_index_invalid', 'The study question route is outside the private root.')
    const identity = `${manifest.identity}:${manifest.sourceIndexSha256}:${expected.questionCount}:${fileIdentity(stat)}`
    const cached = fragments.get(normalizedRouteId)
    if (cached?.identity === identity) return cached

    let raw, value
    try {
      raw = fs.readFileSync(filePath)
      value = JSON.parse(raw.toString('utf8'))
    } catch { failure(503, 'study_question_index_invalid', 'The study question route is invalid.') }
    if (!exactKeys(value, ['schemaVersion', 'routeId', 'sourceIndexSha256', 'questions'])
        || value.schemaVersion !== 'study-question-fragment-v1'
        || value.routeId !== normalizedRouteId
        || value.sourceIndexSha256 !== manifest.sourceIndexSha256
        || !Array.isArray(value.questions)
        || value.questions.length !== expected.questionCount
        || value.questions.length > 20_000) {
      failure(503, 'study_question_index_invalid', 'The study question route is invalid.')
    }
    const record = Object.freeze({
      identity,
      etag: `"${crypto.createHash('sha256').update(raw).digest('hex')}"`,
      value,
    })
    fragments.set(normalizedRouteId, record)
    return record
  }

  function publicManifest() {
    const manifest = currentManifest()
    return {
      schemaVersion: 'study-question-fragment-manifest-v1',
      sourceIndexSha256: manifest.sourceIndexSha256,
      routes: [...manifest.routes.values()].map((entry) => ({ ...entry })),
    }
  }

  return Object.freeze({ readRecord, publicManifest })
}

const defaultReader = createStudyQuestionIndexReader()

export function readStudyQuestionFragment(routeId) {
  return defaultReader.readRecord(routeId).value
}

export function readStudyQuestionFragmentRecord(routeId) {
  return defaultReader.readRecord(routeId)
}

export function studyQuestionIndexManifest() {
  return defaultReader.publicManifest()
}
