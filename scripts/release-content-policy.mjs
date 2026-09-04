import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

export const MAX_RELEASE_BYTES = 1024 * 1024 * 1024
export const MAX_DIST_BYTES = 512 * 1024 * 1024
export const RELEASE_TOP_LEVEL_ALLOWLIST = Object.freeze([
  'dist',
  'index.html',
  'node_modules',
  'package-lock.json',
  'package.json',
  'public',
  'release-manifest.json',
  'scripts',
  'server',
  'src',
  'vite.config.js',
])

const FORBIDDEN_CACHE_OR_STAGING_SEGMENT = /^(?:\.?cache|__pycache__|ocr[-_]?staging|review[-_]?staging|quarantine)$/i
const FORBIDDEN_DATABASE_SUFFIX = /\.(?:db|sqlite|sqlite3)(?:[-.](?:wal|shm|journal))?$/i
const FORBIDDEN_DUMP_SUFFIX = /\.(?:dump|sql|sql\.gz)$/i
const FORBIDDEN_KEY_SUFFIX = /\.(?:pem|key|p12|pfx|jks)$/i

function isForbiddenSensitiveRelativePath(relativePath) {
  const normalized = String(relativePath).split(path.sep).join('/')
  const segments = normalized.split('/').filter(Boolean)
  const basename = segments.at(-1) || ''
  const lowerBasename = basename.toLowerCase()
  const isExampleEnv = lowerBasename === '.env.example'
  const isSecretEnv = lowerBasename === '.env' || (lowerBasename.startsWith('.env.') && !isExampleEnv)
  const isPrivateKeyName = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.+private[-_]?key|.+secret)$/i.test(basename)
  const isForbiddenDirectory = segments.slice(0, -1).some((segment) => FORBIDDEN_CACHE_OR_STAGING_SEGMENT.test(segment))
  return Boolean(
    isSecretEnv
    || isPrivateKeyName
    || FORBIDDEN_KEY_SUFFIX.test(lowerBasename)
    || FORBIDDEN_DATABASE_SUFFIX.test(lowerBasename)
    || FORBIDDEN_DUMP_SUFFIX.test(lowerBasename)
    || isForbiddenDirectory
  )
}

function comparablePath(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isSameOrInside(parent, candidate) {
  const relative = path.relative(comparablePath(parent), comparablePath(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function pathsOverlap(left, right) {
  return isSameOrInside(left, right) || isSameOrInside(right, left)
}

function walkPhysicalTree(root, visitor) {
  const pending = [path.resolve(root)]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      const relativePath = path.relative(path.resolve(root), entryPath)
      const stats = fs.lstatSync(entryPath)
      if (stats.isSymbolicLink()) {
        visitor({ entryPath, relativePath, stats, symbolicLink: true })
      } else if (stats.isDirectory()) {
        pending.push(entryPath)
      } else {
        visitor({ entryPath, relativePath, stats, symbolicLink: false })
      }
    }
  }
}

export function findForbiddenFiles(root, extensions) {
  const forbidden = new Set(extensions.map((extension) => extension.toLowerCase()))
  const matches = []
  walkPhysicalTree(root, ({ entryPath, relativePath, stats, symbolicLink }) => {
    if (!symbolicLink && stats.isFile() && [...forbidden].some((extension) => entryPath.toLowerCase().endsWith(extension))) {
      matches.push(relativePath)
    }
  })
  return matches.sort()
}

/**
 * Reject sensitive material regardless of where it is nested in a release.
 * `.env.example` is intentionally allowed because it is a non-secret template;
 * all other environment files, keys, databases, dumps, caches and OCR staging
 * records remain outside the student release.
 */
export function findForbiddenSensitiveFiles(root) {
  const matches = []
  walkPhysicalTree(root, ({ relativePath, stats, symbolicLink }) => {
    if (symbolicLink || !stats.isFile()) return
    if (isForbiddenSensitiveRelativePath(relativePath)) matches.push(relativePath.split(path.sep).join('/'))
  })
  return matches.sort()
}

export function findNestedSymlinks(root) {
  const matches = []
  walkPhysicalTree(root, ({ relativePath, symbolicLink }) => {
    if (symbolicLink) matches.push(relativePath)
  })
  return matches.sort()
}

export function findUnexpectedReleaseEntries(root, allowlist = RELEASE_TOP_LEVEL_ALLOWLIST) {
  const allowed = new Set(allowlist.map((entry) => String(entry).toLowerCase()))
  return fs.readdirSync(root, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((entry) => !allowed.has(entry.toLowerCase()))
    .sort()
}

export function findEscapingSymlinks(root, allowedExternalPaths = []) {
  const resolvedRoot = fs.realpathSync(root)
  const normalizeRelative = (value) => {
    const normalized = String(value).split(path.sep).join('/')
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
  const allowed = new Set(allowedExternalPaths.map(normalizeRelative))
  const matches = []
  walkPhysicalTree(root, ({ entryPath, relativePath, symbolicLink }) => {
    if (!symbolicLink) return
    let resolvedTarget = ''
    try {
      resolvedTarget = fs.realpathSync(entryPath)
    } catch {
      matches.push(relativePath)
      return
    }
    if (!isSameOrInside(resolvedRoot, resolvedTarget) && !allowed.has(normalizeRelative(relativePath))) {
      matches.push(relativePath)
    }
  })
  return matches.sort()
}

export function artifactTreeIdentity(root, { exclude = [] } = {}) {
  const excluded = new Set(exclude.map((entry) => String(entry).split(path.sep).join('/')))
  const entries = []
  let bytes = 0
  walkPhysicalTree(root, ({ entryPath, relativePath, stats, symbolicLink }) => {
    const normalizedPath = relativePath.split(path.sep).join('/')
    if (excluded.has(normalizedPath)) return
    if (symbolicLink) {
      entries.push({ path: normalizedPath, type: 'symlink', target: fs.readlinkSync(entryPath) })
      return
    }
    if (!stats.isFile()) return
    bytes += stats.size
    entries.push({
      path: normalizedPath,
      type: 'file',
      bytes: stats.size,
      mode: stats.mode & 0o777,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(entryPath)).digest('hex'),
    })
  })
  entries.sort((left, right) => left.path.localeCompare(right.path))
  const sha256 = crypto.createHash('sha256')
    .update(entries.map((entry) => JSON.stringify(entry)).join('\n'))
    .digest('hex')
  return {
    files: entries.filter((entry) => entry.type === 'file').length,
    symlinks: entries.filter((entry) => entry.type === 'symlink').length,
    bytes,
    sha256,
    entries,
  }
}

export function physicalTreeBytes(root) {
  let total = 0
  walkPhysicalTree(root, ({ stats, symbolicLink }) => {
    if (!symbolicLink && stats.isFile()) total += stats.size
  })
  return total
}

export function assertWithinLimit(bytes, limit, label) {
  if (bytes > limit) {
    throw new Error(`${label} is ${bytes} bytes, exceeding the ${limit}-byte release policy limit`)
  }
}
