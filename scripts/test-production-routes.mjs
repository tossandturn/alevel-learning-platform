import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

import { resolveLibraryRoot } from '../server/pdfLibrary.js'
import { releaseBuildIdentity } from '../vite.config.js'
import { artifactTreeIdentity } from './release-content-policy.mjs'
import { resolveProductionBuildIdentity } from './productionRouteBuildIdentity.mjs'

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

function rawGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
      response.on('error', reject)
    })
    request.on('error', reject)
  })
}

async function main() {
  const port = await freePort()
  const libraryRoot = resolveLibraryRoot({ cwd: root, env: process.env })
  const sourcePdf = path.join(libraryRoot, '9702', '9702_m25_qp_42.pdf')
  assert.ok(fs.existsSync(sourcePdf), `the governed local PDF fixture is missing: ${sourcePdf}`)
  const scratchParent = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-production-routes-'))
  const { commit, sourceState } = resolveProductionBuildIdentity({ cwd: root, env: process.env })
  const builtIdentityPath = path.join(root, 'dist', 'build-identity.json')
  assert.ok(fs.existsSync(builtIdentityPath), 'vite build must emit dist/build-identity.json before production route verification')
  assert.deepEqual(
    JSON.parse(fs.readFileSync(builtIdentityPath, 'utf8')),
    { schemaVersion: 'stem-build-identity.v1', commit, sourceState },
    'vite build output must embed the actual repository commit and source-tree state',
  )
  const releaseId = `stem-route-test-${commit.slice(0, 7)}`
  const scratchRoot = path.join(scratchParent, releaseId)
  fs.mkdirSync(scratchRoot)
  fs.cpSync(path.join(root, 'dist'), path.join(scratchRoot, 'dist'), { recursive: true })
  if (sourceState === 'dirty') {
    fs.writeFileSync(path.join(scratchRoot, 'dist', 'build-identity.json'), `${JSON.stringify({
      schemaVersion: 'stem-build-identity.v1',
      commit,
      sourceState: 'clean',
    }, null, 2)}\n`, 'utf8')
  }
  fs.copyFileSync(path.join(root, 'package.json'), path.join(scratchRoot, 'package.json'))
  const copyPublicFile = (relativePath) => {
    const source = path.join(root, 'public', relativePath)
    const target = path.join(scratchRoot, 'public', relativePath)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
  for (const relativePath of [
    'robots.txt',
    'sitemap.xml',
    'data/papers.json',
    'data/papers/9709.json',
    'data/study-question-index/manifest.json',
    'question-assets/cie-0580-0580_m25_qp_12/qp-03.jpg',
  ]) copyPublicFile(relativePath)

  const releaseManifestPath = path.join(scratchRoot, 'release-manifest.json')
  const immutableAssetsRoot = path.join(scratchRoot, 'public', 'question-assets')
  const immutableAssets = artifactTreeIdentity(immutableAssetsRoot)
  const releaseIdentity = {
    schemaVersion: 'stem-release-manifest.v1',
    releaseId,
    commit,
    packageSha256: crypto.createHash('sha256').update('production-route-test-package').digest('hex'),
    generatedAt: new Date().toISOString(),
    releaseTree: artifactTreeIdentity(scratchRoot, { exclude: ['release-manifest.json'] }),
    immutableAssets: { identity: path.basename(immutableAssetsRoot), ...immutableAssets },
  }
  fs.writeFileSync(releaseManifestPath, `${JSON.stringify(releaseIdentity, null, 2)}\n`, 'utf8')

  const forgedManifestPath = path.join(scratchParent, 'forged-release-manifest.json')
  fs.writeFileSync(forgedManifestPath, `${JSON.stringify({ ...releaseIdentity, commit: '1'.repeat(40) }, null, 2)}\n`, 'utf8')
  assert.deepEqual(
    releaseBuildIdentity({ STEM_RELEASE_MANIFEST_PATH: forgedManifestPath }, scratchRoot),
    { status: 'unavailable' },
    'an external manifest must not impersonate the runtime release',
  )
  assert.deepEqual(releaseBuildIdentity({ STEM_RELEASE_MANIFEST_PATH: releaseManifestPath }, scratchRoot), {
    status: 'verified',
    schemaVersion: releaseIdentity.schemaVersion,
    releaseId,
    commit,
    generatedAt: releaseIdentity.generatedAt,
  })
  const releaseIndexPath = path.join(scratchRoot, 'dist', 'index.html')
  const originalReleaseIndex = fs.readFileSync(releaseIndexPath)
  fs.appendFileSync(releaseIndexPath, '\n<!-- tampered -->\n')
  assert.deepEqual(
    releaseBuildIdentity({ STEM_RELEASE_MANIFEST_PATH: releaseManifestPath }, scratchRoot),
    { status: 'unavailable' },
    'a release changed after manifest creation must not report a verified build identity',
  )
  fs.writeFileSync(releaseIndexPath, originalReleaseIndex)

  const child = spawn(process.execPath, [viteCli, 'preview', '--config', path.join(root, 'vite.config.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: scratchRoot,
    env: {
      ...process.env,
      BROWSER: 'none',
      CIE_LIBRARY_ROOT: libraryRoot,
      STEM_DB_PATH: ':memory:',
      STEM_PDF_ACCESS_LOG_PATH: path.join(scratchParent, 'pdf-access.log'),
      STEM_RELEASE_MANIFEST_PATH: releaseManifestPath,
    },
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
      assert.deepEqual(await response.json(), {
        ok: true,
        service: 'stem',
        build: {
          status: 'verified',
          schemaVersion: releaseIdentity.schemaVersion,
          releaseId,
          commit,
          generatedAt: releaseIdentity.generatedAt,
        },
      })
    }

    const robots = await fetch(`${baseUrl}/robots.txt`)
    assert.equal(robots.status, 200)
    assert.match(robots.headers.get('content-type') || '', /text\/plain/i)
    assert.match(await robots.text(), /Sitemap:/)

    const sitemap = await fetch(`${baseUrl}/sitemap.xml`)
    assert.equal(sitemap.status, 200)
    assert.match(sitemap.headers.get('content-type') || '', /xml/i)
    assert.match(await sitemap.text(), /<urlset/)

    const identityHeaders = { 'Accept-Encoding': 'identity' }
    const studyManifest = await fetch(`${baseUrl}/data/study-question-index/manifest.json`, { headers: identityHeaders })
    assert.equal(studyManifest.status, 200)
    assert.match(studyManifest.headers.get('content-type') || '', /application\/json/i)
    const studyManifestBytes = fs.statSync(path.join(root, 'public', 'data', 'study-question-index', 'manifest.json')).size
    assert.equal(Number(studyManifest.headers.get('content-length')), studyManifestBytes, 'public JSON assets must expose an exact Content-Length for proxy framing')
    const manifest = await studyManifest.json()
    assert.ok(Array.isArray(manifest.routes) && manifest.routes.length > 0, 'study-question-index manifest must be served from the public data route')

    const papersPath = path.join(root, 'public', 'data', 'papers.json')
    const papersBytes = fs.statSync(papersPath).size
    const papers = await fetch(`${baseUrl}/data/papers.json`, { headers: identityHeaders })
    assert.equal(papers.status, 200)
    assert.match(papers.headers.get('content-type') || '', /application\/json/i)
    assert.equal(Number(papers.headers.get('content-length')), papersBytes, 'the full paper catalog must expose an exact origin body length')
    const papersBody = new Uint8Array(await papers.arrayBuffer())
    assert.equal(papersBody.byteLength, papersBytes, 'the full paper catalog response must complete without truncation')
    const parsedPapers = JSON.parse(Buffer.from(papersBody).toString('utf8'))
    assert.ok(Array.isArray(parsedPapers.items) && parsedPapers.items.length > 0, 'the full paper catalog must remain valid JSON')
    const compressedPapers = await rawGet(`${baseUrl}/data/papers.json`, { 'Accept-Encoding': 'br' })
    assert.equal(compressedPapers.statusCode, 200)
    assert.equal(compressedPapers.headers['content-encoding'], 'br', 'JSON assets must negotiate Brotli when the client supports it')
    assert.match(compressedPapers.headers.vary || '', /Accept-Encoding/i)
    assert.equal(Number(compressedPapers.headers['content-length']), compressedPapers.body.byteLength, 'compressed JSON must expose its representation length')
    assert.ok(compressedPapers.body.byteLength < papersBytes, 'compressed JSON must be smaller than the identity representation')
    assert.deepEqual(JSON.parse(brotliDecompressSync(compressedPapers.body).toString('utf8')), parsedPapers)

    const gzipPapers = await rawGet(`${baseUrl}/data/papers.json`, { 'Accept-Encoding': 'gzip' })
    assert.equal(gzipPapers.statusCode, 200)
    assert.equal(gzipPapers.headers['content-encoding'], 'gzip', 'JSON assets must retain gzip compatibility for older WebViews')
    assert.equal(Number(gzipPapers.headers['content-length']), gzipPapers.body.byteLength)
    assert.deepEqual(JSON.parse(gunzipSync(gzipPapers.body).toString('utf8')), parsedPapers)

    const subjectPapers = await fetch(`${baseUrl}/data/papers/9709.json`, { headers: identityHeaders })
    assert.equal(subjectPapers.status, 200)
    const subjectPapersBytes = fs.statSync(path.join(root, 'public', 'data', 'papers', '9709.json')).size
    assert.equal(Number(subjectPapers.headers.get('content-length')), subjectPapersBytes)
    const parsedSubjectPapers = await subjectPapers.json()
    assert.ok(parsedSubjectPapers.items.some((item) => item.subject === '9709'), 'subject catalog must remain scoped to its requested subject')

    const compressedSubjectPapers = await rawGet(`${baseUrl}/data/papers/9709.json`, { 'Accept-Encoding': 'br' })
    assert.equal(compressedSubjectPapers.statusCode, 200)
    assert.equal(compressedSubjectPapers.headers['content-encoding'], 'br')
    assert.ok(compressedSubjectPapers.body.byteLength < subjectPapersBytes, 'large subject catalogs must use the compressed representation')
    assert.deepEqual(JSON.parse(brotliDecompressSync(compressedSubjectPapers.body).toString('utf8')), parsedSubjectPapers)

    const papersHead = await fetch(`${baseUrl}/data/papers.json`, { method: 'HEAD', headers: identityHeaders })
    assert.equal(papersHead.status, 200)
    assert.equal(Number(papersHead.headers.get('content-length')), papersBytes, 'HEAD must report the same paper catalog length')
    assert.equal((await papersHead.arrayBuffer()).byteLength, 0, 'HEAD must not stream a paper catalog body')

    const questionAsset = await fetch(`${baseUrl}/question-assets/cie-0580-0580_m25_qp_12/qp-03.jpg`)
    assert.equal(questionAsset.status, 200)
    assert.match(questionAsset.headers.get('content-type') || '', /image\/jpeg/i)
    assert.equal(questionAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    const questionAssetBytes = fs.statSync(path.join(root, 'public', 'question-assets', 'cie-0580-0580_m25_qp_12', 'qp-03.jpg')).size
    assert.equal(Number(questionAsset.headers.get('content-length')), questionAssetBytes, 'public image assets must expose an exact Content-Length for proxy framing')
    assert.equal((await questionAsset.arrayBuffer()).byteLength, questionAssetBytes)

    const sourcePdfResponse = await fetch(`${baseUrl}/local-pdf/9702/9702_m25_qp_42.pdf`)
    assert.equal(sourcePdfResponse.status, 200)
    assert.match(sourcePdfResponse.headers.get('content-type') || '', /application\/pdf/i)
    assert.equal(sourcePdfResponse.headers.get('content-disposition'), 'inline; filename="9702_m25_qp_42.pdf"')
    assert.ok((await sourcePdfResponse.arrayBuffer()).byteLength > 0)

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
      routes: ['/healthz', '/api/health', '/robots.txt', '/sitemap.xml', '/data/study-question-index/manifest.json', '/question-assets/cie-0580-0580_m25_qp_12/qp-03.jpg', '/local-pdf/9702/9702_m25_qp_42.pdf'],
      hashedAsset: assetPath,
      cacheControl: asset.headers.get('cache-control'),
      securityHeaders: true,
    }))
  } finally {
    if (child.exitCode == null) {
      child.kill()
      await new Promise((resolve) => child.once('close', resolve))
    }
    fs.rmSync(scratchParent, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
