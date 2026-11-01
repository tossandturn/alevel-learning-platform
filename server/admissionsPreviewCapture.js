import { createAdmissionsStaticPageBundle } from './admissionsPreviewFetch.js'
import { createAdmissionsPreviewRenderer } from './admissionsPreviewRenderer.js'

export function createAdmissionsPreviewCapture({ artifactRoot, renderer = null, fetchBundle = createAdmissionsStaticPageBundle } = {}) {
  let activeRenderer = renderer
  if (!activeRenderer) {
    try { activeRenderer = createAdmissionsPreviewRenderer({ artifactRoot }) }
    catch {
      activeRenderer = { configured: false, render: () => Promise.reject(Object.assign(new Error('Preview renderer is unavailable.'), { code: 'ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE' })), close() {} }
    }
  }
  return Object.freeze({
    configured: activeRenderer.configured,
    async captureSource(source, { deadlineAt = Date.now() + 20_000 } = {}) {
      if (!activeRenderer.configured) throw Object.assign(new Error('Preview renderer is unavailable.'), { code: 'ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE' })
      const bundle = await fetchBundle(source.url, { deadlineAt: Math.min(deadlineAt, Date.now() + 8_000) })
      return activeRenderer.render(bundle, { deadlineAt })
    },
    close: () => activeRenderer.close(),
  })
}
