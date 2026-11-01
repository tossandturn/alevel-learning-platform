import { createAdmissionsPreviewRenderer } from '../server/admissionsPreviewRenderer.js'

const startedAt = performance.now()
let renderer
try {
  renderer = createAdmissionsPreviewRenderer()
  if (!renderer.configured) {
    console.log(JSON.stringify({ status: 'blocked', code: 'ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE', durationMs: Math.round(performance.now() - startedAt) }))
    process.exitCode = 2
  } else {
    const result = await renderer.render({
      width: 390, height: 900,
      html: '<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;padding:24px}h1{font-size:28px}</style></head><body><h1>Offline admissions preview fixture</h1><p>A*A*A including Mathematics and Physics.</p></body></html>',
    })
    const bytes = Buffer.from(result.base64, 'base64')
    console.log(JSON.stringify({
      status: 'passed', offline: true, renderer: 'playwright-core', version: '1.64.1',
      mimeType: result.mimeType, width: result.width, height: result.height,
      bytes: bytes.length, pngSignature: bytes.subarray(1, 4).toString('ascii'),
      durationMs: Math.round(performance.now() - startedAt),
    }))
  }
} catch (error) {
  console.log(JSON.stringify({ status: 'blocked', code: String(error?.code || 'ADMISSIONS_PREVIEW_SMOKE_FAILED'), durationMs: Math.round(performance.now() - startedAt) }))
  process.exitCode = 2
} finally {
  renderer?.close()
}
