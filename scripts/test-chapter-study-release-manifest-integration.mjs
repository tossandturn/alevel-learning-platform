import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const workspace = fs.realpathSync(path.resolve(import.meta.dirname, '..'))
const scratch = fs.mkdtempSync(path.join(workspace, '.chapter-release-contract-'))
const writer = path.join(workspace, 'scripts/write-stem-release-manifest.mjs')
const verifier = path.join(workspace, 'scripts/verify-stem-release.mjs')
const commit = 'a'.repeat(40), oldCommit = 'b'.repeat(40), packageSha = 'c'.repeat(64)
const tree = { files: 1, symlinks: 0, bytes: 1, sha256: 'd'.repeat(64) }
const baselineScope = { schemaVersion: 'stem-syllabus-release-scope.v1',
  routeIds: ['cie-9700-as-biology', 'cie-9702-as-physics'], readinessMode: 'student-study',
  aiStudyFormalProgressEligible: false, topicScopes: { 'cie-9700-as-biology': ['9700-as-topic-01', '9700-as-topic-02'] } }
const baseline = { schemaVersion: 'stem-release-manifest.v1', releaseId: `baseline-${oldCommit.slice(0, 7)}`,
  commit: oldCommit, packageSha256: packageSha, generatedAt: new Date().toISOString(), releaseTree: tree,
  immutableAssets: { identity: 'baseline-assets', ...tree }, syllabusScope: baselineScope }
const baselinePath = path.join(scratch, 'trusted-baseline.json')
const releaseRoot = path.join(scratch, 'releases', `candidate-${commit.slice(0, 7)}`), assets = path.join(releaseRoot, 'public/question-assets')
const library = path.join(scratch, 'library'), legacyArtifacts = path.join(scratch, 'legacy-artifacts')
const runtimeData = path.join(scratch, 'shared', 'runtime-data')
const chapterArtifacts = path.join(runtimeData, 'ai-study-packs', 'fixture'), pageCache = path.join(chapterArtifacts, 'source-pages')
const anchorRoot = path.join(scratch, 'shared', 'verified-release-anchors')
const trace = path.join(scratch, 'coverage-trace.jsonl')
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const run = (args, env = {}) => spawnSync(process.execPath, args, { cwd: workspace, encoding: 'utf8',
  env: { ...process.env, ...env }, maxBuffer: 4 * 1024 * 1024 })
const output = (result) => `${result.stdout || ''}\n${result.stderr || ''}`
try {
  for (const directory of [assets, library, legacyArtifacts, chapterArtifacts, pageCache, anchorRoot,
    path.join(releaseRoot, 'dist/assets'), path.join(releaseRoot, 'node_modules'),
    path.join(releaseRoot, 'scripts'), path.join(releaseRoot, 'src/data'), path.join(releaseRoot, 'public/data/papers')]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline)}\n`)
  const baselineHash = hash(fs.readFileSync(baselinePath))
  fs.symlinkSync(runtimeData, path.join(releaseRoot, 'data'), process.platform === 'win32' ? 'junction' : 'dir')
  const packMarker = path.join(chapterArtifacts, 'candidate-manifest.json')
  fs.writeFileSync(packMarker, JSON.stringify({ fixture: 'not-a-production-approval' }))
  const packHash = hash(fs.readFileSync(packMarker))
  fs.writeFileSync(path.join(assets, 'fixture.png'), 'synthetic image')
  fs.writeFileSync(path.join(releaseRoot, 'node_modules/.package-lock.json'), '{}')
  for (const file of ['index.html', 'robots.txt', 'sitemap.xml']) fs.writeFileSync(path.join(releaseRoot, 'dist', file), 'fixture')
  fs.writeFileSync(path.join(releaseRoot, 'dist/build-identity.json'), JSON.stringify({ schemaVersion: 'stem-build-identity.v1', commit, sourceState: 'clean' }))
  fs.writeFileSync(path.join(releaseRoot, 'public/data/papers.json'), '{}')
  for (const subject of ['0580', '0625', '9702', '9709']) fs.writeFileSync(path.join(releaseRoot, `public/data/papers/${subject}.json`), '{}')
  fs.writeFileSync(path.join(releaseRoot, 'src/data/sourceContentManifest.json'), JSON.stringify({ sourceIndexSha256: 'e'.repeat(64), checksum: 'f'.repeat(64) }))
  fs.writeFileSync(path.join(releaseRoot, 'src/data/sourceContentIdentity.js'),
    `export const SOURCE_INDEX_SHA256 = '${'e'.repeat(64)}'\nexport const SOURCE_CONTENT_MANIFEST_CHECKSUM = '${'f'.repeat(64)}'\n`)
  for (const file of ['audit-question-bank.mjs', 'audit-paper-catalog.mjs', 'verify-9702-syllabus-coverage.mjs', 'verify-all-syllabus-coverage.mjs']) {
    fs.writeFileSync(path.join(releaseRoot, 'scripts', file), 'process.exit(0)\n')
  }
  fs.writeFileSync(path.join(releaseRoot, 'scripts/verify-study-release-coverage.mjs'), `
import fs from 'node:fs'
const args = process.argv.slice(2)
fs.appendFileSync(process.env.TRACE_PATH, JSON.stringify(args) + '\\n')
const mode = args.includes('chapter-study') ? 'chapter-study' : 'student-study'
console.log(JSON.stringify({ status: 'PASS', readinessMode: mode, fixture: true }))
`)
  const writeArgs = [writer, '--release-root', releaseRoot, '--immutable-assets-root', assets,
    '--commit', commit, '--release-id', path.basename(releaseRoot), '--package-sha256', packageSha, '--runtime-data-root', runtimeData,
    '--baseline-release-manifest', baselinePath, '--trusted-baseline-manifest-sha256', baselineHash,
    '--trusted-baseline-commit', oldCommit, '--trusted-baseline-release-id', baseline.releaseId,
    '--chapter-route', 'cie-9708-as-economics', '--chapter-topic', 'cie-9708-as-economics:9708-as-topic-1-5',
    '--chapter-pack-relative-path', 'data/ai-study-packs/fixture', '--chapter-pack-manifest-sha256', packHash]
  const written = run(writeArgs)
  assert.equal(written.status, 0, output(written))
  const manifestPath = path.join(releaseRoot, 'release-manifest.json'), originalManifest = fs.readFileSync(manifestPath)
  const generated = JSON.parse(originalManifest)
  assert.deepEqual(generated.syllabusScope.baseline, baselineScope)
  assert.equal(generated.syllabusScope.baselineIdentity.manifestSha256, baselineHash)
  const verifyArgs = [verifier, '--release-root', releaseRoot, '--pdf-library-root', library,
    '--immutable-assets-root', assets, '--commit', commit, '--release-id', path.basename(releaseRoot), '--package-sha256', packageSha,
    '--runtime-data-root', runtimeData, '--trusted-release-manifest-sha256', hash(originalManifest),
    '--ai-artifact-root', legacyArtifacts, '--chapter-ai-artifact-root', chapterArtifacts, '--chapter-source-page-cache-root', pageCache,
    '--baseline-release-manifest', baselinePath, '--trusted-baseline-manifest-sha256', baselineHash,
    '--trusted-baseline-commit', oldCommit, '--trusted-baseline-release-id', baseline.releaseId]
  const verified = run(verifyArgs, { TRACE_PATH: trace })
  assert.equal(verified.status, 0, output(verified))
  const calls = fs.readFileSync(trace, 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  assert.equal(calls.length, 2, 'baseline and additional chapter coverage must both run')
  assert.ok(calls[0].includes('cie-9700-as-biology') && calls[0].includes('cie-9702-as-physics'))
  assert.ok(calls[0].includes('cie-9700-as-biology:9700-as-topic-01') && calls[0].includes('cie-9700-as-biology:9700-as-topic-02'))
  assert.ok(!calls[0].includes('chapter-study'))
  assert.ok(calls[1].includes('chapter-study') && calls[1].includes('cie-9708-as-economics:9708-as-topic-1-5'))
  assert.ok(calls[1].includes('--pinned-manifest-sha256') && calls[1].includes(packHash))
  const anchored = run([...verifyArgs, '--write-runtime-anchor'], { TRACE_PATH: trace })
  assert.equal(anchored.status, 0, output(anchored))
  const anchorPath = path.join(anchorRoot, `${path.basename(releaseRoot)}.json`)
  const anchor = JSON.parse(fs.readFileSync(anchorPath, 'utf8'))
  assert.equal(anchor.manifestSha256, hash(originalManifest))
  assert.notEqual(run([...verifyArgs, '--write-runtime-anchor'], { TRACE_PATH: trace }).status, 0, 'an anchor must not be overwritten')
  const wrongPackRoot = verifyArgs.slice(), packIndex = wrongPackRoot.indexOf('--chapter-ai-artifact-root')
  wrongPackRoot[packIndex + 1] = legacyArtifacts
  assert.notEqual(run(wrongPackRoot, { TRACE_PATH: trace }).status, 0, 'an unrelated pack root must not be accepted')
  const badPin = verifyArgs.slice(), pinIndex = badPin.indexOf('--trusted-release-manifest-sha256')
  badPin[pinIndex + 1] = '0'.repeat(64)
  assert.notEqual(run(badPin, { TRACE_PATH: trace }).status, 0, 'an incorrect independent release pin must fail')
  for (const flag of ['--trusted-baseline-manifest-sha256', '--trusted-baseline-commit', '--trusted-baseline-release-id']) {
    const bad = verifyArgs.slice(), index = bad.indexOf(flag); bad[index + 1] = flag.endsWith('sha256') ? '0'.repeat(64)
      : flag.endsWith('commit') ? '0'.repeat(40) : 'wrong-release'
    assert.notEqual(run(bad, { TRACE_PATH: trace }).status, 0, `${flag} mismatch must fail`)
  }
  const missing = verifyArgs.slice(), index = missing.indexOf('--baseline-release-manifest'); missing.splice(index, 2)
  assert.notEqual(run(missing, { TRACE_PATH: trace }).status, 0, 'missing baseline must fail')
  fs.chmodSync(manifestPath, 0o600)
  for (const mutate of [
    (scope) => { scope.baseline.routeIds.pop() },
    (scope) => { scope.baseline.topicScopes['cie-9700-as-biology'].pop() },
    (scope) => { scope.baseline.readinessMode = 'unknown' },
    (scope) => { scope.chapterStudy.topicScopes['cie-9708-as-economics'].push('9708-as-topic-1-5') },
  ]) {
    const bad = JSON.parse(originalManifest); mutate(bad.syllabusScope)
    fs.writeFileSync(manifestPath, JSON.stringify(bad))
    assert.notEqual(run(verifyArgs, { TRACE_PATH: trace }).status, 0, 'altered baseline or scope must fail')
    fs.writeFileSync(manifestPath, originalManifest)
  }
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'chapter-release-manifest-end-to-end',
    baselineVerifierCalls: 1, chapterVerifierCalls: 1, baselineRoutesPreserved: 2, tamperedBaselineRejected: true }))
} finally {
  const resolved = fs.realpathSync(scratch)
  assert.equal(path.dirname(resolved), workspace)
  assert.ok(path.basename(resolved).startsWith('.chapter-release-contract-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
