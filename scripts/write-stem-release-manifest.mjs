import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { artifactTreeIdentity } from './release-content-policy.mjs'
import { releaseIdMatchesCommit, validateBuildIdentity } from './release-manifest-contract.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function optionValues(name) {
  const values = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue
    const value = String(process.argv[index + 1] || '').trim()
    if (value) values.push(...value.split(',').map((item) => item.trim()).filter(Boolean))
  }
  return [...new Set(values)]
}

function requiredOption(name) {
  const value = String(option(name) || '').trim()
  assert.ok(value, `Pass ${name} <value>`)
  return value
}

const releaseRoot = path.resolve(requiredOption('--release-root'))
const immutableAssetsRoot = path.resolve(requiredOption('--immutable-assets-root'))
const commit = requiredOption('--commit').toLowerCase()
const releaseId = requiredOption('--release-id')
const packageSha256 = requiredOption('--package-sha256').toLowerCase()
const requestedSyllabusRouteIds = optionValues('--route')
const syllabusRouteIds = requestedSyllabusRouteIds.length
  ? requestedSyllabusRouteIds
  : String(process.env.STEM_RELEASE_ROUTES || 'cie-9702-as-physics')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
const manifestPath = path.join(releaseRoot, 'release-manifest.json')
const buildIdentityPath = path.join(releaseRoot, 'dist', 'build-identity.json')

assert.match(commit, /^[a-f0-9]{40}$/, 'Release commit must be a full Git SHA')
assert.match(packageSha256, /^[a-f0-9]{64}$/, 'Package SHA-256 must be a full lowercase digest')
assert.ok(releaseIdMatchesCommit(releaseId, commit), 'Release ID must end with the commit short SHA')
assert.equal(path.basename(releaseRoot), releaseId, 'Release root basename must match the release ID')
assert.ok(!fs.existsSync(manifestPath), `Release manifest already exists: ${manifestPath}`)
assert.ok(fs.existsSync(immutableAssetsRoot) && fs.statSync(immutableAssetsRoot).isDirectory(), `Immutable assets root is missing: ${immutableAssetsRoot}`)
assert.ok(fs.existsSync(buildIdentityPath) && fs.statSync(buildIdentityPath).isFile(), 'Release is missing dist/build-identity.json')
assert.ok(syllabusRouteIds.length > 0, 'Release must declare at least one syllabus route')
assert.ok(syllabusRouteIds.every((routeId) => /^[A-Za-z0-9._:-]{1,120}$/.test(routeId)), 'Release syllabus routes must use safe route IDs')
assert.equal(new Set(syllabusRouteIds).size, syllabusRouteIds.length, 'Release syllabus routes must be unique')
const buildIdentity = JSON.parse(fs.readFileSync(buildIdentityPath, 'utf8'))
assert.ok(
  validateBuildIdentity(buildIdentity, { commit, requireClean: true }).valid,
  'Release build identity must match the release commit and come from a clean source tree',
)

const releaseTree = artifactTreeIdentity(releaseRoot, { exclude: ['release-manifest.json'] })
const immutableAssets = artifactTreeIdentity(immutableAssetsRoot)
const manifest = {
  schemaVersion: 'stem-release-manifest.v1',
  releaseId,
  commit,
  packageSha256,
  syllabusScope: {
    schemaVersion: 'stem-syllabus-release-scope.v1',
    routeIds: syllabusRouteIds,
  },
  generatedAt: new Date().toISOString(),
  releaseTree,
  immutableAssets: {
    identity: path.basename(immutableAssetsRoot),
    ...immutableAssets,
  },
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o444 })
const manifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex')
console.log(JSON.stringify({
  ok: true,
  releaseId,
  commit,
  packageSha256,
  manifestSha256,
  releaseFiles: releaseTree.files,
  releaseBytes: releaseTree.bytes,
  immutableAssetFiles: immutableAssets.files,
  immutableAssetBytes: immutableAssets.bytes,
  immutableAssetsSha256: immutableAssets.sha256,
}, null, 2))
