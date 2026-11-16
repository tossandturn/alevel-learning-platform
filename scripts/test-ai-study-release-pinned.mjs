import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { verifyAiStudyPromotion } from '../server/aiStudyPromotion.js'

const workspace = fs.realpathSync(path.resolve(import.meta.dirname, '..'))
const root = fs.mkdtempSync(path.join(workspace, '.release-pinned-pack-'))
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
try {
  const relative = 'cie-9708-9708_m25_qp_12/q3.json', file = path.join(root, ...relative.split('/'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const content = Buffer.from('{"fixture":true}\n'); fs.writeFileSync(file, content)
  const pack = { schemaVersion: 'stem-ai-study-release-pack.v1', scope: 'chapter-study', formalProgressEligible: false,
    routeIds: ['cie-9708-as-economics'], expectedRouteGroups: 1, artifacts: [{ path: relative, sha256: digest(content) }] }
  const marker = path.join(root, 'candidate-manifest.json'), bytes = Buffer.from(JSON.stringify(pack))
  fs.writeFileSync(marker, bytes)
  const pinned = (hash = digest(bytes), paths = [file]) => verifyAiStudyPromotion({ artifactRoot: root, artifactPaths: paths,
    promotionPolicy: { mode: 'release-pinned', trustedManifestSha256: hash, expectedRealRoot: fs.realpathSync(root),
      expectedRouteIds: ['cie-9708-as-economics'] } })
  const verified = pinned()
  assert.equal(verified.artifactCount, 1); assert.equal(verified.expectedRouteGroups, 1)
  assert.deepEqual(verified.routeIds, ['cie-9708-as-economics'])
  assert.deepEqual(verified.bytesByPath.get(relative), content)
  const rejected = (fn) => assert.throws(fn, (error) => error?.statusCode === 503 && error.code === 'AI_STUDY_PROMOTION_INVALID')
  rejected(() => pinned('0'.repeat(64)))
  rejected(() => pinned(''))
  assert.throws(() => verifyAiStudyPromotion({ artifactRoot: root, artifactPaths: [file], promotionPolicy: {
    mode: 'release-pinned', trustedManifestSha256: digest(bytes), expectedRealRoot: fs.realpathSync(root),
    expectedRouteIds: ['cie-9708-a2-economics'] } }), (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID')
  const originalStat = fs.statSync(file), changed = Buffer.from(content)
  changed[changed.indexOf(Buffer.from('true'))] = 'X'.charCodeAt(0)
  fs.writeFileSync(file, changed); fs.utimesSync(file, originalStat.atime, originalStat.mtime)
  assert.equal(fs.statSync(file).size, originalStat.size)
  rejected(() => pinned())
  fs.writeFileSync(file, content)
  const extra = path.join(root, 'cie-9708-9708_m25_qp_12', 'extra.json'); fs.writeFileSync(extra, '{}')
  rejected(() => pinned(digest(bytes), [file, extra])); fs.unlinkSync(extra)
  fs.writeFileSync(marker, JSON.stringify({ ...pack, formalProgressEligible: true }))
  rejected(() => pinned())
  fs.writeFileSync(marker, bytes)
  fs.unlinkSync(marker); rejected(() => pinned()); fs.writeFileSync(marker, bytes)
  assert.throws(() => verifyAiStudyPromotion({ artifactRoot: root, artifactPaths: [file], promotionPolicy: {
    mode: 'release-pinned', trustedManifestSha256: digest(bytes), expectedRealRoot: path.join(workspace, 'wrong-root') } }),
  (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID')
  const alias = path.join(root, 'alias')
  fs.symlinkSync(path.dirname(file), alias, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    assert.ok(fs.lstatSync(alias).isSymbolicLink())
    const aliasRelative = 'alias/q3.json', aliasFile = path.join(alias, 'q3.json')
    const aliasBytes = Buffer.from(JSON.stringify({ ...pack, artifacts: [{ path: aliasRelative, sha256: digest(content) }] }))
    fs.writeFileSync(marker, aliasBytes)
    rejected(() => pinned(digest(aliasBytes), [aliasFile]))
  } finally { fs.rmdirSync(alias); fs.writeFileSync(marker, bytes) }
  const blocked = path.join(root, 'BLOCKED.json'); fs.writeFileSync(blocked, '{}')
  assert.throws(() => pinned(), (error) => error?.code === 'AI_STUDY_CANDIDATE_BLOCKED')
  fs.unlinkSync(blocked)
  assert.throws(() => verifyAiStudyPromotion({ artifactRoot: root, artifactPaths: [file] }),
    (error) => error?.code === 'AI_STUDY_PROMOTION_REQUIRED', 'a pinned pack must not be accepted as legacy')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'release-pinned-study-pack', negativeCases: 9 }))
} finally {
  const resolved = fs.realpathSync(root)
  assert.equal(path.dirname(resolved), workspace)
  assert.ok(path.basename(resolved).startsWith('.release-pinned-pack-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
