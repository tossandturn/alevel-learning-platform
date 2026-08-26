import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { artifactTreeIdentity } from './release-content-policy.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
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
const manifestPath = path.join(releaseRoot, 'release-manifest.json')

assert.match(commit, /^[a-f0-9]{40}$/, 'Release commit must be a full Git SHA')
assert.match(packageSha256, /^[a-f0-9]{64}$/, 'Package SHA-256 must be a full lowercase digest')
assert.ok(!fs.existsSync(manifestPath), `Release manifest already exists: ${manifestPath}`)
assert.ok(fs.existsSync(immutableAssetsRoot) && fs.statSync(immutableAssetsRoot).isDirectory(), `Immutable assets root is missing: ${immutableAssetsRoot}`)

const releaseTree = artifactTreeIdentity(releaseRoot, { exclude: ['release-manifest.json'] })
const immutableAssets = artifactTreeIdentity(immutableAssetsRoot)
const manifest = {
  schemaVersion: 'stem-release-manifest.v1',
  releaseId,
  commit,
  packageSha256,
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
