import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

function option(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ''
}

function options(name) {
  return args.flatMap((value, index) => value === name && args[index + 1] ? [args[index + 1]] : [])
}

function requiredOption(name) {
  const value = option(name)
  assert.ok(value, `Pass ${name} <path>`)
  return value
}

function existingDirectory(label, value) {
  const resolved = fs.realpathSync(value)
  assert.ok(fs.statSync(resolved).isDirectory(), `${label} must be a directory: ${resolved}`)
  return resolved
}

function directChildOf(root, candidate) {
  const relative = path.relative(root, candidate)
  return Boolean(relative) && path.dirname(candidate) === root && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function releasePath(label, value, releasesRoot) {
  const resolved = existingDirectory(label, value)
  assert.ok(directChildOf(releasesRoot, resolved), `${label} must resolve inside releases root: ${resolved}`)
  return resolved
}

function parseKeepCount(value) {
  assert.match(value, /^\d+$/, 'Pass --keep <non-negative integer>')
  return Number(value)
}

const releasesRoot = existingDirectory('Releases root', requiredOption('--releases-root'))
const currentInput = requiredOption('--current')
const currentRelease = releasePath('Current release', currentInput, releasesRoot)
const retainedReleases = options('--retain').map((value) => releasePath('Retained release', value, releasesRoot))
const keepCount = parseKeepCount(requiredOption('--keep'))
const apply = args.includes('--apply')
const retained = new Set([currentRelease, ...retainedReleases])

const releases = fs.readdirSync(releasesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  .map((entry) => {
    const releasePathname = path.join(releasesRoot, entry.name)
    assert.ok(directChildOf(releasesRoot, releasePathname), `Release entry escapes releases root: ${entry.name}`)
    return {
      name: entry.name,
      path: releasePathname,
      modifiedAtMs: fs.statSync(releasePathname).mtimeMs,
    }
  })
  .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs || right.name.localeCompare(left.name))

assert.ok(releases.some((release) => release.path === currentRelease), 'Current release is not present in releases root')
for (const retainedRelease of retained) {
  assert.ok(releases.some((release) => release.path === retainedRelease), `Retained release is not present in releases root: ${retainedRelease}`)
}

let remainingKeep = keepCount
const keep = []
const remove = []
for (const release of releases) {
  if (retained.has(release.path)) {
    keep.push(release)
  } else if (remainingKeep > 0) {
    keep.push(release)
    remainingKeep -= 1
  } else {
    remove.push(release)
  }
}

const deleted = []
if (apply) {
  const verifiedCurrent = releasePath('Current release', currentInput, releasesRoot)
  assert.equal(verifiedCurrent, currentRelease, 'Current release changed during prune; refusing to delete')
  for (const release of remove) {
    assert.ok(directChildOf(releasesRoot, release.path), `Refusing to delete path outside releases root: ${release.path}`)
    const metadata = fs.lstatSync(release.path)
    assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), `Refusing to delete a non-directory release entry: ${release.path}`)
    fs.rmSync(release.path, { recursive: true, force: false, maxRetries: 1 })
    deleted.push(release.path)
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  mode: apply ? 'apply' : 'dry-run',
  releasesRoot,
  currentRelease,
  retained: [...retained].sort(),
  keep: keep.map((release) => release.path),
  delete: remove.map((release) => release.path),
  deleted,
}, null, 2)}\n`)
