import path from 'node:path'

// This association is process-local and never comes from a student request.
const cacheRoots = new WeakMap()

export function bindAiStudySourceCache(groups, root) {
  if (!Array.isArray(groups) || typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('Invalid AI study source cache binding.')
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Object.isFrozen(group)) throw new TypeError('A frozen source group is required.')
    cacheRoots.set(group, root)
  }
}

export function aiStudySourceCacheRoot(question) {
  return question && typeof question === 'object' ? cacheRoots.get(question) : undefined
}
