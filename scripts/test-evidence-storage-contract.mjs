import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compactStateForLocalStorage, saveState } from '../src/lib/storage.js'

const binary = `data:image/png;base64,${'A'.repeat(256)}`
const state = {
  profile: { activeRouteId: 'cie-9702-as-physics', learningTrack: 'AS' },
  attempts: [{
    id: 'attempt-storage-regression',
    unitId: 'unit-storage-regression',
    routeId: 'cie-9702-as-physics',
    stage: 'AS',
    evidence: {
      'part-1': { id: 'evidence-1', dataUrl: binary, previewUrl: 'blob:stale-preview', bytes: 256 },
    },
    imageEvidence: [{ id: 'evidence-1', partId: 'part-1', dataUrl: binary }],
  }],
  drafts: {
    'unit-storage-regression': {
      attemptId: 'attempt-storage-regression',
      evidence: { 'part-1': { id: 'evidence-1', dataUrl: binary } },
    },
  },
  paperDrafts: {
    'paper-storage-regression': {
      attemptId: 'paper-attempt-storage-regression',
      pdfInkByPage: { 1: { dataUrl: binary, inkDataUrl: binary, inkEvidenceId: 'ink-1', imageEvidenceId: 'image-1' } },
    },
  },
}

const compact = compactStateForLocalStorage(state)
const compactJson = JSON.stringify(compact)
assert.doesNotMatch(compactJson, /data:image|blob:stale-preview|inkDataUrl|previewUrl/i, 'local state must not contain binary or stale object-url evidence')
assert.match(compactJson, /evidence-1|ink-1|image-1/, 'local state must retain evidence IDs for IndexedDB hydration')

const writes = new Map()
const previousWindow = globalThis.window
globalThis.window = {
  localStorage: {
    getItem: (key) => writes.get(String(key)) || null,
    setItem: (key, value) => writes.set(String(key), String(value)),
    removeItem: (key) => writes.delete(String(key)),
  },
}
try {
  assert.doesNotThrow(() => saveState(state, { replaceSyncQueue: true, userId: 'ielts:storage-regression' }))
  const saved = writes.get('alevel-learning-platform-v2:user:ielts%3Astorage-regression')
  assert.ok(saved, 'the compacted state must be written to the account namespace')
  assert.doesNotMatch(saved, /data:image|inkDataUrl|previewUrl/i, 'saved local state must remain metadata-only')
} finally {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
}

const throwingWindow = globalThis.window
globalThis.window = {
  localStorage: {
    getItem: () => null,
    setItem: () => { throw Object.assign(new Error('storage quota exceeded'), { name: 'QuotaExceededError', code: 22 }) },
    removeItem: () => {},
  },
}
try {
  assert.doesNotThrow(() => saveState(state, { replaceSyncQueue: true, userId: 'ielts:quota-regression' }), 'storage quota errors must not crash the student app')
} finally {
  if (throwingWindow === undefined) delete globalThis.window
  else globalThis.window = throwingWindow
}

console.log('Evidence storage and local quota contract passed.')

const pdfViewerSource = readFileSync(new URL('../src/components/PdfViewer.jsx', import.meta.url), 'utf8')
const pdfEmitBlock = pdfViewerSource.match(/const nextInk = \{[\s\S]*?\n      \}/)?.[0] || ''
assert.match(pdfEmitBlock, /\binkEvidenceId\s*(?::|,)/, 'PDF handwriting metadata must retain an IndexedDB ink ID')
assert.match(pdfEmitBlock, /\bimageEvidenceId\s*(?::|,)/, 'PDF handwriting metadata must retain an IndexedDB composite image ID')
assert.doesNotMatch(pdfEmitBlock, /(?:dataUrl|inkDataUrl)\s*:/, 'PDF handwriting metadata must not persist data URLs')

const paperWorkspaceSource = readFileSync(new URL('../src/components/PaperWorkspace.jsx', import.meta.url), 'utf8')
const clearPdfInkBlock = paperWorkspaceSource.match(/function clearPdfInk\(\) \{([\s\S]*?)\n  \}/)?.[1] || ''
assert.match(paperWorkspaceSource, /evidenceStorageKey=/, 'Paper workspace must namespace PDF evidence by attempt and paper')
assert.match(clearPdfInkBlock, /deletePaperEvidence\(/, 'Clearing PDF handwriting must remove IndexedDB evidence')

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const visionReviewBlock = appSource.match(/async function requestVisionReviews[\s\S]*?\n\}/)?.[0] || ''
assert.match(visionReviewBlock, /getPaperEvidence\(/, 'Topic AI marking must hydrate metadata-only evidence from IndexedDB')
assert.match(visionReviewBlock, /evidence.*unavailable|missing.*evidence/i, 'Missing local evidence must fail closed before provider marking')

console.log('Evidence rendering and provider hydration contract passed.')
