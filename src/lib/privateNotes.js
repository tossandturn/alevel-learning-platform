function timestamp(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function notebookNoteRequest(value) {
  const body = String(value ?? '')
  if (!body.trim()) return { method: 'DELETE' }
  return { method: 'PUT', body: JSON.stringify({ body }) }
}

export function mergeNotebookNote(current, incoming, { preferTombstone = false } = {}) {
  const deleted = Boolean(incoming?.deleted || incoming?.deletedAt)
  if (!incoming || (!deleted || !preferTombstone) && timestamp(incoming.updatedAt) < timestamp(current?.updatedAt)) return current || null
  return {
    ...incoming,
    body: deleted ? '' : String(incoming.body || ''),
    ...(deleted ? { deleted: true, deletedAt: incoming.deletedAt || incoming.updatedAt } : {}),
    syncStatus: 'synced',
  }
}
