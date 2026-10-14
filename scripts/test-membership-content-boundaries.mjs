import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  buildVerifiedPracticeDiscovery,
  generateVerifiedPracticeUnit,
  markingContextForPaper,
  rebindVerifiedPracticeUnitForRequest,
  verifiedPracticeUnitById,
} from '../server/verifiedPracticeApi.js'
import { createStudyQuestionIndexReader, readStudyQuestionFragment, STUDY_QUESTION_INDEX_ROOT } from '../server/studyQuestionIndexApi.js'
import { sendPublicAsset } from '../vite.config.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const forbiddenPublicKeys = /^(?:parts|questions|sourceQuestionIds?|referencePapers|sourceRef|answerRef|prompt|options|answer|answerKey|exactAnswer|markPoints|markSchemePoints|markingProvenance|sourceAssetUrls?|questionUrl|markSchemeUrl)$/i

function inspectPublic(value, trail = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPublic(item, `${trail}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert.doesNotMatch(key, forbiddenPublicKeys, `public discovery leaked ${trail}.${key}`)
    inspectPublic(child, `${trail}.${key}`)
  }
}

const discovery = buildVerifiedPracticeDiscovery()
assert.deepEqual(Object.keys(discovery).sort(), ['routes', 'schemaVersion', 'sourceVersion', 'units'])
assert.equal(discovery.schemaVersion, 'verified-practice-discovery-v1')
const catalogSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src', 'data', 'verifiedPracticeCatalog.json'))).digest('hex')
assert.equal(discovery.sourceVersion, catalogSha256, 'public revision tracks the actual server catalog bytes')
assert.ok(discovery.units.length > 0)
assert.ok(discovery.routes.length > 0)
inspectPublic(discovery)
assert.ok(discovery.units.every((unit) => unit.discoveryOnly === true && unit.startable === true))

const selected = discovery.units[0]
const protectedUnit = verifiedPracticeUnitById(selected.id)
assert.equal(protectedUnit.schemaVersion, 'verified-practice-unit-v1')
assert.equal(protectedUnit.sourceVersion, catalogSha256)
assert.equal(protectedUnit.unit.id, selected.id)
assert.ok(protectedUnit.unit.parts.length > 0)
assert.ok(protectedUnit.unit.parts.some((part) => part.answerKey || part.markPoints?.length), 'protected unit preserves canonical scoring metadata')
assert.throws(() => verifiedPracticeUnitById('../outside'), (error) => error.statusCode === 400 && error.code === 'verified_practice_request_invalid')
assert.throws(() => verifiedPracticeUnitById('missing-unit'), (error) => error.statusCode === 404 && error.code === 'verified_practice_unit_not_found')

const generated = generateVerifiedPracticeUnit({
  routeId: selected.routeId,
  knowledgeGroupId: selected.knowledgeGroupId,
  questionCount: selected.questionGroupCount,
  allowPartial: true,
})
assert.equal(generated.schemaVersion, 'verified-practice-unit-v1')
assert.equal(generated.unit.sourceAuthority, 'server-verified')
assert.equal(generated.unit.sourceGateStatus, 'current')

const rebound = rebindVerifiedPracticeUnitForRequest(protectedUnit.unit)
assert.equal(rebound.schemaVersion, 'verified-practice-unit-v1')
assert.equal(rebound.unit.id, protectedUnit.unit.id)
assert.equal(rebound.unit.sourceGateStatus, 'current')

const paper = protectedUnit.unit.referencePapers[0]
const marking = markingContextForPaper({ paperId: paper.id, routeId: selected.routeId })
assert.equal(marking.schemaVersion, 'paper-marking-context-v1')
assert.equal(marking.sourceVersion, catalogSha256)
assert.equal(marking.paperId, paper.id)
assert.ok(Object.keys(marking.questions).length > 0)

const resolvedPrivateRoot = path.resolve(STUDY_QUESTION_INDEX_ROOT)
assert.ok(resolvedPrivateRoot.startsWith(`${root}${path.sep}`), 'private study index stays inside the isolated worktree')
assert.equal(path.relative(root, resolvedPrivateRoot).replaceAll('\\', '/'), 'server/data/study-question-index')
const fragment = readStudyQuestionFragment(selected.routeId)
assert.equal(fragment.schemaVersion, 'study-question-fragment-v1')
assert.equal(fragment.routeId, selected.routeId)
assert.ok(fragment.questions.length > 0)
assert.throws(() => readStudyQuestionFragment('../outside'), (error) => error.statusCode === 400 && error.code === 'study_question_route_invalid')
assert.throws(() => readStudyQuestionFragment('missing-route'), (error) => error.statusCode === 404 && error.code === 'study_question_route_not_found')

const refreshFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'study-index-refresh-'))
try {
  const privateRoot = path.join(refreshFixture, 'private')
  const manifestPath = path.join(refreshFixture, 'manifest.json')
  fs.mkdirSync(privateRoot)
  const write = (revision, questionCount) => {
    const questions = Array.from({ length: questionCount }, (_, index) => ({ id: `q-${revision}-${index}` }))
    const fragmentTarget = path.join(privateRoot, 'fixture-route.json')
    const fragmentTemporary = `${fragmentTarget}.${revision}.tmp`
    const manifestTemporary = `${manifestPath}.${revision}.tmp`
    fs.writeFileSync(fragmentTemporary, `${JSON.stringify({ schemaVersion: 'study-question-fragment-v1', routeId: 'fixture-route', sourceIndexSha256: revision.repeat(64), questions })}\n`, 'utf8')
    fs.renameSync(fragmentTemporary, fragmentTarget)
    fs.writeFileSync(manifestTemporary, `${JSON.stringify({ schemaVersion: 'study-question-fragment-manifest-v1', sourceIndexSha256: revision.repeat(64), routes: [{ routeId: 'fixture-route', file: 'fixture-route.json', questionCount }] })}\n`, 'utf8')
    fs.renameSync(manifestTemporary, manifestPath)
  }
  write('a', 1)
  const reader = createStudyQuestionIndexReader({ indexRoot: privateRoot, manifestPath })
  const first = reader.readRecord('fixture-route')
  assert.equal(first.value.questions.length, 1)
  write('b', 2)
  const second = reader.readRecord('fixture-route')
  assert.equal(second.value.questions.length, 2, 'same process observes an atomically published backend data revision')
  assert.notEqual(second.etag, first.etag)
} finally {
  fs.rmSync(refreshFixture, { recursive: true, force: true })
}

async function requestPublicAsset(publicRoot, url) {
  return new Promise((resolve, reject) => {
    const response = new PassThrough()
    const chunks = []
    response.statusCode = 200
    response.headers = {}
    response.setHeader = (name, value) => { response.headers[String(name).toLowerCase()] = String(value) }
    response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    response.on('error', reject)
    response.on('finish', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }))
    const next = (error) => error ? reject(error) : resolve({ statusCode: 0, headers: {}, body: 'next' })
    sendPublicAsset({ url, method: 'GET' }, response, next, { publicRoot })
  })
}

const assetFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-public-assets-'))
try {
  const publicRoot = path.join(assetFixture, 'public')
  const internalPrivate = path.join(publicRoot, 'private-source')
  const externalPrivate = path.join(assetFixture, 'external-source')
  fs.mkdirSync(path.join(publicRoot, 'data'), { recursive: true })
  fs.mkdirSync(internalPrivate)
  fs.mkdirSync(externalPrivate)
  fs.writeFileSync(path.join(publicRoot, 'data', 'visible.json'), '{"public":true}\n', 'utf8')
  fs.writeFileSync(path.join(internalPrivate, 'answer.json'), '{"answerKey":"internal-secret"}\n', 'utf8')
  fs.writeFileSync(path.join(externalPrivate, 'answer.json'), '{"answerKey":"external-secret"}\n', 'utf8')
  fs.symlinkSync(internalPrivate, path.join(publicRoot, 'data', 'internal-link'), 'junction')
  fs.symlinkSync(externalPrivate, path.join(publicRoot, 'data', 'external-link'), 'junction')
  const visible = await requestPublicAsset(publicRoot, '/data/visible.json')
  assert.equal(visible.statusCode, 200)
  assert.equal(visible.body, '{"public":true}\n')
  const internal = await requestPublicAsset(publicRoot, '/data/internal-link/answer.json')
  assert.equal(internal.statusCode, 404, 'an internal public-root symlink cannot relabel protected bytes as an unprotected /data path')
  assert.doesNotMatch(internal.body, /internal-secret/)
  const external = await requestPublicAsset(publicRoot, '/data/external-link/answer.json')
  assert.equal(external.statusCode, 404, 'an escaping public-root symlink is rejected before streaming bytes')
  assert.doesNotMatch(external.body, /external-secret/)
  const linkedPublicRoot = path.join(assetFixture, 'linked-public-root')
  fs.symlinkSync(publicRoot, linkedPublicRoot, 'junction')
  const linkedRoot = await requestPublicAsset(linkedPublicRoot, '/data/visible.json')
  assert.equal(linkedRoot.statusCode, 404, 'the configured public root itself must be a real reviewed directory, not a symlink')
} finally {
  fs.rmSync(assetFixture, { recursive: true, force: true })
}

const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
const paperWorkspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
const viteSource = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8')
const generatorSource = fs.readFileSync(path.join(root, 'scripts', 'generate-study-question-fragments.mjs'), 'utf8')
const runtimeCatalogGeneratorSource = fs.readFileSync(path.join(root, 'scripts', 'generate-verified-practice-catalog.mjs'), 'utf8')
const releasePolicySource = fs.readFileSync(path.join(root, 'scripts', 'release-content-policy.mjs'), 'utf8')
const releaseVerifierSource = fs.readFileSync(path.join(root, 'scripts', 'verify-stem-release.mjs'), 'utf8')
const studyIndexApiSource = fs.readFileSync(path.join(root, 'server', 'studyQuestionIndexApi.js'), 'utf8')
const verifiedRuntimeSource = fs.readFileSync(path.join(root, 'src', 'lib', 'verifiedPracticeCatalog.js'), 'utf8')
assert.doesNotMatch(appSource, /import\(['"]\.\/lib\/verifiedPracticeCatalog['"]\)/, 'browser must not import the answer catalog module')
assert.doesNotMatch(paperWorkspaceSource, /verifiedPracticeCatalog/, 'paper workspace must request protected marking metadata')
assert.doesNotMatch(viteSource, /return ['"]practice-catalog['"]/, 'Vite must not emit an answer catalog chunk')
assert.match(viteSource, /membershipClientBoundary/, 'the production client graph must fail closed if server-only answer modules re-enter')
assert.match(generatorSource, /server['"], ['"]data['"], ['"]study-question-index/, 'the generator must publish route fragments only to the private server data root')
assert.match(generatorSource, /publicManifestRoot/, 'the generator keeps only the sanitized manifest in public data')
assert.doesNotMatch(generatorSource, /rmSync\([^\n]*recursive/, 'the generator must not recursively delete the protected index root')
assert.match(generatorSource, /renameSync/, 'fragment and manifest publication must use same-directory atomic replacement')
assert.match(runtimeCatalogGeneratorSource, /renameSync/, 'the protected runtime catalog must publish by same-directory atomic replacement')
assert.match(releasePolicySource, /['"]server['"]/, 'the immutable backend release allowlist must include private server data')
assert.match(releaseVerifierSource, /server['"], ['"]data['"], ['"]study-question-index/, 'release verification must require the private study index root')
assert.match(releaseVerifierSource, /publicStudyIndexEntries/, 'release verification must reject route fragments returning to public data')
assert.match(studyIndexApiSource, /lstatSync/, 'runtime index reads must reject symlinked files before following them')
assert.match(studyIndexApiSource, /realpathSync/, 'runtime index reads must bind the physical private root')
assert.match(verifiedRuntimeSource, /lstatSync/, 'the server-only answer catalog loader must reject a symlinked catalog')
assert.ok(!fs.existsSync(path.join(root, 'public', 'data', 'study-question-index', `${selected.routeId}.json`)), 'route fragment must not remain in the public web root')

console.log(JSON.stringify({
  status: 'pass',
  discoveryUnits: discovery.units.length,
  protectedUnit: selected.id,
  privateIndexRoot: path.relative(root, resolvedPrivateRoot).replaceAll('\\', '/'),
}))
