export const HANDWRITING_HISTORY_MAX_ENTRIES = 16
export const HANDWRITING_HISTORY_MAX_SIDE = 720
export const HANDWRITING_HISTORY_MAX_BYTES = 10 * 1024 * 1024

export function handwritingHistorySize(width, height, maxSide = HANDWRITING_HISTORY_MAX_SIDE) {
  const sourceWidth = Math.max(1, Number(width) || 1)
  const sourceHeight = Math.max(1, Number(height) || 1)
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
  const snapshotWidth = Math.max(1, Math.round(sourceWidth * scale))
  const snapshotHeight = Math.max(1, Math.round(sourceHeight * scale))
  return {
    width: snapshotWidth,
    height: snapshotHeight,
    bytes: snapshotWidth * snapshotHeight * 4,
    fullDpr: snapshotWidth === sourceWidth && snapshotHeight === sourceHeight,
  }
}

export function trimHandwritingHistory(entries, {
  maxEntries = HANDWRITING_HISTORY_MAX_ENTRIES,
  maxBytes = HANDWRITING_HISTORY_MAX_BYTES,
  minimumEntries = 1,
} = {}) {
  const kept = [...entries]
  let bytes = kept.reduce((total, entry) => total + Math.max(0, Number(entry?.bytes) || 0), 0)
  while (kept.length > minimumEntries && (kept.length > maxEntries || bytes > maxBytes)) {
    bytes -= Math.max(0, Number(kept.shift()?.bytes) || 0)
  }
  return { entries: kept, bytes }
}
