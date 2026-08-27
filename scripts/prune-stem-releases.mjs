import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { validateReleaseManifest } from './release-manifest-contract.mjs'

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

function validUtcTimestamp(year, month, day, hour = 0, minute = 0, second = 0) {
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second)
  const value = new Date(timestamp)
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day
    && value.getUTCHours() === hour
    && value.getUTCMinutes() === minute
    && value.getUTCSeconds() === second
    ? timestamp
    : null
}

function releaseIdTimestamp(name) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:[T_-]?(\d{2})(\d{2})(\d{2}))?(?:[-_].*)?$/.exec(name)
  if (!match) return null
  return validUtcTimestamp(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0),
  )
}

function releaseManifestTimestamp(releasePathname, releaseName) {
  const manifestPath = path.join(releasePathname, 'release-manifest.json')
  if (!fs.existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return validateReleaseManifest(manifest, { releaseId: releaseName }).generatedAtMs
  } catch {
    return null
  }
}

function releaseOrder(releasePathname, releaseName, modifiedAtMs) {
  const manifestTimestamp = releaseManifestTimestamp(releasePathname, releaseName)
  if (manifestTimestamp !== null) return { orderedAtMs: manifestTimestamp, orderSource: 'manifest' }
  const idTimestamp = releaseIdTimestamp(releaseName)
  if (idTimestamp !== null) return { orderedAtMs: idTimestamp, orderSource: 'release-id' }
  return { orderedAtMs: modifiedAtMs, orderSource: 'mtime' }
}

function releaseRootForTarget(releasesRoot, target) {
  const relative = path.relative(releasesRoot, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return ''
  const [releaseName] = relative.split(path.sep)
  return releaseName ? path.join(releasesRoot, releaseName) : ''
}

function referencedReleaseRoots(releaseRoot, releasesRoot, candidatePaths) {
  const referenced = new Set()
  const brokenSymlinks = []
  const scanErrors = []
  const pending = [releaseRoot]
  const visitedDirectories = new Set()
  while (pending.length) {
    const directory = pending.pop()
    let realDirectory
    try {
      realDirectory = fs.realpathSync(directory)
    } catch (error) {
      scanErrors.push({ path: directory, code: String(error?.code || 'realpath_failed') })
      continue
    }
    if (visitedDirectories.has(realDirectory)) continue
    visitedDirectories.add(realDirectory)
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      scanErrors.push({ path: directory, code: String(error?.code || 'readdir_failed') })
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        let target
        try {
          target = fs.realpathSync(entryPath)
        } catch {
          brokenSymlinks.push(entryPath)
          continue
        }
        const targetRelease = releaseRootForTarget(releasesRoot, target)
        if (targetRelease && candidatePaths.has(targetRelease)) referenced.add(targetRelease)
      } else if (entry.isDirectory()) {
        pending.push(entryPath)
      }
    }
  }
  return { referenced, brokenSymlinks, scanErrors }
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
    const modifiedAtMs = fs.statSync(releasePathname).mtimeMs
    return {
      name: entry.name,
      path: releasePathname,
      modifiedAtMs,
      ...releaseOrder(releasePathname, entry.name, modifiedAtMs),
    }
  })
  .sort((left, right) => right.orderedAtMs - left.orderedAtMs
    || right.modifiedAtMs - left.modifiedAtMs
    || right.name.localeCompare(left.name))

const releaseByPath = new Map(releases.map((release) => [release.path, release]))

assert.ok(releases.some((release) => release.path === currentRelease), 'Current release is not present in releases root')
for (const retainedRelease of retained) {
  assert.ok(releases.some((release) => release.path === retainedRelease), `Retained release is not present in releases root: ${retainedRelease}`)
}

let remainingKeep = keepCount
const keep = []
for (const release of releases) {
  if (retained.has(release.path)) {
    keep.push(release)
  } else if (remainingKeep > 0) {
    keep.push(release)
    remainingKeep -= 1
  }
}

const keptPaths = new Set(keep.map((release) => release.path))
const brokenSymlinks = []
const scanErrors = []
for (let index = 0; index < keep.length; index += 1) {
  const references = referencedReleaseRoots(keep[index].path, releasesRoot, releaseByPath)
  brokenSymlinks.push(...references.brokenSymlinks)
  scanErrors.push(...references.scanErrors)
  for (const referencedPath of references.referenced) {
    if (keptPaths.has(referencedPath)) continue
    const referencedRelease = releaseByPath.get(referencedPath)
    if (!referencedRelease) continue
    keptPaths.add(referencedPath)
    keep.push(referencedRelease)
  }
}

const remove = releases.filter((release) => !keptPaths.has(release.path))
const safeToApply = brokenSymlinks.length === 0 && scanErrors.length === 0

const deleted = []
if (apply) {
  assert.ok(safeToApply, 'Retained-release dependency scanning was incomplete; refusing to delete releases')
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
  ordering: releases.map((release) => ({ path: release.path, source: release.orderSource })),
  safeToApply,
  brokenSymlinks,
  scanErrors,
  delete: remove.map((release) => release.path),
  deleted,
}, null, 2)}\n`)
