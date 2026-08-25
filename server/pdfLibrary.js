import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_LIBRARY_ROOT = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'

function configuredPath(value) {
  const text = String(value || '').trim()
  return text ? path.resolve(text) : ''
}

function existingLibraryRoot(candidate) {
  const resolved = configuredPath(candidate)
  if (!resolved) return ''
  const subjectRoot = path.join(resolved, '9702')
  try {
    return fs.statSync(subjectRoot).isDirectory() ? resolved : ''
  } catch {
    return ''
  }
}

/**
 * Resolve the private source library without weakening the catalog/hash gate.
 * Production releases keep it adjacent to the release tree; local development
 * continues to use the explicit environment variable or the historical path.
 */
export function resolveLibraryRoot({ cwd = process.cwd(), env = process.env } = {}) {
  const explicit = configuredPath(env?.CIE_LIBRARY_ROOT)
  if (explicit) return explicit

  const workingDirectory = path.resolve(cwd)
  const candidates = [
    path.resolve(workingDirectory, '..', 'library', 'pdf'),
    path.resolve(workingDirectory, '..', '..', 'library', 'pdf'),
    DEFAULT_LIBRARY_ROOT,
  ]
  return candidates.map(existingLibraryRoot).find(Boolean) || path.resolve(DEFAULT_LIBRARY_ROOT)
}
