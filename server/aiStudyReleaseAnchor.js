import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const SHA256 = /^[a-f0-9]{64}$/
export const MAX_RELEASE_MANIFEST_BYTES = 8 * 1024 * 1024

function invalid() {
  throw Object.assign(new Error('The verified chapter-study release anchor is unavailable.'),
    { statusCode: 503, code: 'AI_STUDY_PROMOTION_INVALID' })
}

function readRegularFile(file, limit) {
  let descriptor
  try {
    const before = fs.lstatSync(file)
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > limit) invalid()
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size !== before.size || stat.dev !== before.dev || stat.ino !== before.ino) invalid()
    const bytes = Buffer.allocUnsafe(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset)
      if (count <= 0) invalid()
      offset += count
    }
    if (fs.readSync(descriptor, Buffer.alloc(1), 0, 1, stat.size) !== 0) invalid()
    const after = fs.fstatSync(descriptor), current = fs.lstatSync(file)
    for (const value of [after, current]) {
      if (!value.isFile() || value.isSymbolicLink() || value.dev !== stat.dev || value.ino !== stat.ino
        || value.size !== stat.size || value.mtimeMs !== stat.mtimeMs || value.ctimeMs !== stat.ctimeMs) invalid()
    }
    return bytes
  } catch (error) {
    if (error?.code === 'AI_STUDY_PROMOTION_INVALID') throw error
    invalid()
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

export function releaseAnchorPath(releaseRoot) {
  const root = fs.realpathSync(releaseRoot)
  const releases = path.dirname(root)
  if (path.basename(releases) !== 'releases') invalid()
  const home = path.dirname(releases)
  const shared = path.join(home, 'shared')
  const anchors = path.join(shared, 'verified-release-anchors')
  for (const directory of [shared, anchors]) {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid()
  }
  return path.join(anchors, `${path.basename(root)}.json`)
}

export function readReleaseAnchor(releaseRoot) {
  try {
    const file = releaseAnchorPath(releaseRoot)
    const bytes = readRegularFile(file, 4096)
    const anchor = JSON.parse(bytes.toString('utf8'))
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)
      || JSON.stringify(Object.keys(anchor).sort()) !== JSON.stringify(['commit', 'manifestSha256', 'releaseId', 'routeIds', 'schemaVersion'])
      || anchor.schemaVersion !== 'stem-verified-release-anchor.v1'
      || anchor.releaseId !== path.basename(fs.realpathSync(releaseRoot))
      || !/^[a-f0-9]{40}$/.test(String(anchor.commit || '')) || !anchor.releaseId.endsWith(`-${anchor.commit.slice(0, 7)}`)
      || !SHA256.test(String(anchor.manifestSha256 || '')) || !Array.isArray(anchor.routeIds) || !anchor.routeIds.length
      || anchor.routeIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(id))
      || new Set(anchor.routeIds).size !== anchor.routeIds.length) invalid()
    return Object.freeze({ path: file, releaseId: anchor.releaseId, commit: anchor.commit,
      routeIds: Object.freeze([...anchor.routeIds]), manifestSha256: anchor.manifestSha256,
      anchorSha256: crypto.createHash('sha256').update(bytes).digest('hex') })
  } catch (error) {
    if (error?.code === 'AI_STUDY_PROMOTION_INVALID') throw error
    invalid()
  }
}

export function verifyReleaseAnchor({ releaseRoot, manifest, manifestBytes }) {
  const anchor = readReleaseAnchor(releaseRoot)
  if (anchor.releaseId !== manifest.releaseId || anchor.commit !== manifest.commit
    || JSON.stringify(anchor.routeIds) !== JSON.stringify(manifest.syllabusScope?.chapterStudy?.routeIds)
    || crypto.createHash('sha256').update(manifestBytes).digest('hex') !== anchor.manifestSha256) invalid()
  return anchor
}

export function readReleaseManifestBytes(releaseRoot) {
  return readRegularFile(path.join(releaseRoot, 'release-manifest.json'), MAX_RELEASE_MANIFEST_BYTES)
}
