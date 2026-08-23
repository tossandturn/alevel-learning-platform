import fs from 'node:fs'
import path from 'node:path'

export const MAX_RELEASE_BYTES = 1024 * 1024 * 1024
export const MAX_DIST_BYTES = 512 * 1024 * 1024

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

export function findNestedSymlinks(root) {
  const matches = []
  walkPhysicalTree(root, ({ relativePath, symbolicLink }) => {
    if (symbolicLink) matches.push(relativePath)
  })
  return matches.sort()
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
