import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const viteCli = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitFor(url, child) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode != null) throw new Error(`Vite exited before readiness: ${child.exitCode}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not become ready: ${url}`)
}

async function main() {
  const port = await freePort()
  const child = spawn(process.execPath, [viteCli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  const baseUrl = `http://127.0.0.1:${port}`
  try {
    await waitFor(`${baseUrl}/healthz`, child)
    for (const pathname of ['/healthz', '/api/health']) {
      const response = await fetch(`${baseUrl}${pathname}`)
      assert.equal(response.status, 200, `${pathname} must be healthy`)
      assert.match(response.headers.get('content-type') || '', /application\/json/i)
      assert.deepEqual(await response.json(), { ok: true, service: 'stem' })
    }

    const robots = await fetch(`${baseUrl}/robots.txt`)
    assert.equal(robots.status, 200)
    assert.match(robots.headers.get('content-type') || '', /text\/plain/i)
    assert.match(await robots.text(), /Sitemap:/)

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`)
    assert.equal(sitemap.status, 200)
    assert.match(sitemap.headers.get('content-type') || '', /xml/i)
    assert.match(await sitemap.text(), /<urlset/)

    const studyManifest = await fetch(`${baseUrl}/data/study-question-index/manifest.json`)
    assert.equal(studyManifest.status, 200)
    assert.match(studyManifest.headers.get('content-type') || '', /application\/json/i)
    const manifest = await studyManifest.json()
    assert.ok(Array.isArray(manifest.routes) && manifest.routes.length > 0, 'study-question-index manifest must be served from the public data route')

    const questionAsset = await fetch(`${baseUrl}/question-assets/cie-0580-0580_m25_qp_12/qp-03.jpg`)
    assert.equal(questionAsset.status, 200)
    assert.match(questionAsset.headers.get('content-type') || '', /image\/jpeg/i)
    assert.equal(questionAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.ok((await questionAsset.arrayBuffer()).byteLength > 0)

    const index = await fetch(`${baseUrl}/`)
    assert.equal(index.status, 200)
    assert.equal(index.headers.get('cache-control'), 'no-cache')
    const html = await index.text()
    const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
    assert.ok(assetPath, `index must reference a hashed JavaScript asset: ${html.slice(0, 500)}`)

    const asset = await fetch(`${baseUrl}${assetPath}`)
    assert.equal(asset.status, 200)
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(asset.headers.get('referrer-policy'), 'strict-origin-when-cross-origin')
    assert.match(asset.headers.get('permissions-policy') || '', /camera=\(self\)/)
    assert.match(asset.headers.get('content-security-policy') || '', /frame-ancestors 'self'/)
    assert.ok((await asset.arrayBuffer()).byteLength > 0)

    console.log(JSON.stringify({
      ok: true,
      routes: ['/healthz', '/api/health', '/robots.txt', '/sitemap.xml', '/data/study-question-index/manifest.json', '/question-assets/cie-0580-0580_m25_qp_12/qp-03.jpg'],
      hashedAsset: assetPath,
      cacheControl: asset.headers.get('cache-control'),
      securityHeaders: true,
    }))
  } finally {
    if (child.exitCode == null) {
      child.kill()
      await new Promise((resolve) => child.once('close', resolve))
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
