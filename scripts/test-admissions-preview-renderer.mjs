import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { PLAYWRIGHT_IMAGE_TAG, createAdmissionsPreviewRenderer, dockerAdmissionsPreviewCreateArgs, runDockerAdmissionsPreview, sha256DirectoryTree, validatedPreviewRendererConfig } from '../server/admissionsPreviewRenderer.js'

assert.equal(PLAYWRIGHT_IMAGE_TAG, 'mcr.microsoft.com/playwright:v1.64.1-noble')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'admissions-preview-runtime-'))
fs.mkdirSync(path.join(root, 'package'))
fs.writeFileSync(path.join(root, 'package', 'package.json'), JSON.stringify({ version: '1.64.1' }))
fs.writeFileSync(path.join(root, 'renderer.cjs'), 'module.exports = {}')
fs.writeFileSync(path.join(root, 'seccomp_profile.json'), '{}')
fs.writeFileSync(path.join(root, 'playwright-core-1.64.1.tgz'), 'fixture-package')
fs.writeFileSync(path.join(root, 'LICENSE-playwright'), 'Apache License')
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const packageSha256 = digest(path.join(root, 'playwright-core-1.64.1.tgz'))
const seccompSha256 = digest(path.join(root, 'seccomp_profile.json'))
const rendererSha256 = digest(path.join(root, 'renderer.cjs'))
const packageTreeSha256 = sha256DirectoryTree(path.join(root, 'package'))
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: '1.64.1', image: PLAYWRIGHT_IMAGE_TAG, packageSha256, packageTreeSha256, rendererSha256, seccompSha256, license: 'Apache-2.0' }))
assert.throws(() => validatedPreviewRendererConfig({ artifactRoot: root }), /digest/i)
const image = `mcr.microsoft.com/playwright@sha256:${'a'.repeat(64)}`
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlpeR0AAAAASUVORK5CYII='
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ version: '1.64.1', image, packageSha256, packageTreeSha256, rendererSha256, seccompSha256, license: 'Apache-2.0' }))
const config = validatedPreviewRendererConfig({ artifactRoot: root })
assert.equal(config.image, image)
fs.appendFileSync(path.join(root, 'renderer.cjs'), '\n// tampered')
assert.throws(() => validatedPreviewRendererConfig({ artifactRoot: root }), /renderer hash/i)
fs.writeFileSync(path.join(root, 'renderer.cjs'), 'module.exports = {}')
fs.writeFileSync(path.join(root, 'package', 'extra.js'), 'tampered')
assert.throws(() => validatedPreviewRendererConfig({ artifactRoot: root }), /package tree hash/i)
fs.rmSync(path.join(root, 'package', 'extra.js'))
assert.equal(validatedPreviewRendererConfig({ artifactRoot: root }).configured, true)
const args = dockerAdmissionsPreviewCreateArgs({ image, name: 'stem-admissions-preview-test', artifactRoot: root, seccompPath: config.seccompPath })
const joined = args.join(' ')
for (const required of ['--interactive', '--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--security-opt seccomp=', '--pids-limit 128', '--cpus 1', '--memory 512m', '--shm-size 128m', '--user 1000:1000', '--ipc private', '--mount', `type=bind,src=${root},dst=/runtime,readonly`]) assert.match(joined, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
assert.doesNotMatch(joined, /--no-sandbox|--privileged|--volume|docker\.sock|SYS_ADMIN|unconfined|--ipc host|dst=\/runtime,rw/)
assert.equal(args.filter(item => item === '--mount').length, 1, 'only the verified public runtime artifact is mounted')
const workerSource = fs.readFileSync(new URL('./admissions-preview-renderer.cjs', import.meta.url), 'utf8')
assert.match(workerSource, /require\('\/runtime\/package'\)/)
assert.match(workerSource, /chromiumSandbox:\s*true/)
assert.match(workerSource, /javaScriptEnabled:\s*false/)
assert.match(workerSource, /route\.abort/)
assert.match(workerSource, /scrollIntoViewIfNeeded/)
assert.match(workerSource, /requirements-section/)
assert.doesNotMatch(workerSource, /--no-sandbox/)
const hostRendererSource = fs.readFileSync(new URL('../server/admissionsPreviewRenderer.js', import.meta.url), 'utf8')
assert.match(hostRendererSource, /child\.stdin\.on\('error'/)
const numericExit = Object.assign(new Error('docker create failed'), { code: 1 })
await assert.rejects(runDockerAdmissionsPreview({
  configuration: config, bundle: { html: '<h1>fixture</h1>', width: 390, height: 800 },
  execDocker: async () => { throw numericExit },
}), error => error?.code === 'ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE' && !(error instanceof TypeError))

let active = 0
let maxActive = 0
const renderer = createAdmissionsPreviewRenderer({
  configuration: { configured: true, image, artifactRoot: root, seccompPath: config.seccompPath },
  runContainer: async ({ html }) => {
    assert.doesNotMatch(html, /https?:\/\//)
    active += 1; maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 15))
    active -= 1
    return { mimeType: 'image/png', base64: tinyPng, width: 390, height: 800, focus: 'requirements-section' }
  },
})
const first = renderer.render({ html: '<h1>one</h1>' })
const second = renderer.render({ html: '<h1>two</h1>' })
await assert.rejects(renderer.render({ html: '<h1>three</h1>' }), error => error?.code === 'ADMISSIONS_PREVIEW_RENDER_BUSY')
await Promise.all([first, second])
assert.equal(maxActive, 1, 'renderer concurrency is one')
await assert.rejects(renderer.render({ html: '<img src="https://example.com/x.png">' }), error => error?.code === 'ADMISSIONS_PREVIEW_BUNDLE_UNSAFE')
renderer.close()
fs.rmSync(root, { recursive: true })
console.log('Admissions Docker preview renderer: exact image/digests, single verified read-only runtime mount, no socket/no-sandbox, concurrency and offline bundle passed.')
