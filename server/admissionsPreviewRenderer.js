import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
export const PLAYWRIGHT_IMAGE_TAG = 'mcr.microsoft.com/playwright:v1.64.1-noble'
export const DEFAULT_ADMISSIONS_PREVIEW_RUNTIME_ROOT = '/home/ubuntu/alevel-physics/tools/admissions-preview-1.64.1'
const IMAGE_PATTERN = /^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/
const MAX_RENDER_INPUT_BYTES = 2 * 1024 * 1024
const MAX_RENDER_OUTPUT_BYTES = 3 * 1024 * 1024

function renderError(code, message) {
  return Object.assign(new Error(message), { code })
}

function childPath(root, value, label) {
  const candidate = path.resolve(root, String(value || ''))
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error(`Admissions preview ${label} leaves its runtime root.`)
  return candidate
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function sha256DirectoryTree(root, { maxFiles = 10_000, maxBytes = 64 * 1024 * 1024 } = {}) {
  const base = path.resolve(root)
  const files = []
  let bytes = 0
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = path.join(directory, entry.name)
      const stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error('Admissions preview package tree contains a symbolic link.')
      if (stat.isDirectory()) visit(file)
      else if (stat.isFile()) {
        files.push(file)
        bytes += stat.size
        if (files.length > maxFiles || bytes > maxBytes) throw new Error('Admissions preview package tree exceeds its bound.')
      } else throw new Error('Admissions preview package tree contains an unsupported entry.')
    }
  }
  visit(base)
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    const relative = path.relative(base, file).replaceAll('\\', '/')
    hash.update(relative).update('\0').update(String(fs.statSync(file).size)).update('\0').update(fs.readFileSync(file)).update('\0')
  }
  return hash.digest('hex')
}

export function validatedPreviewRendererConfig({ artifactRoot = DEFAULT_ADMISSIONS_PREVIEW_RUNTIME_ROOT } = {}) {
  const root = path.resolve(artifactRoot)
  const manifestPath = path.join(root, 'manifest.json')
  const manifestStat = fs.lstatSync(manifestPath, { throwIfNoEntry: false })
  if (!manifestStat) return { configured: false, reason: 'renderer_unavailable', artifactRoot: root }
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 8 * 1024) throw new Error('Admissions preview manifest is invalid.')
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch { throw new Error('Admissions preview manifest is invalid JSON.') }
  if (manifest?.version !== '1.64.1' || manifest.license !== 'Apache-2.0') throw new Error('Admissions preview runtime version is invalid.')
  const image = String(manifest.image || '').trim()
  if (!IMAGE_PATTERN.test(image)) throw new Error('Admissions preview image must pin the Playwright 1.64.1 image repository by sha256 digest.')
  if (![manifest.packageSha256, manifest.packageTreeSha256, manifest.rendererSha256, manifest.seccompSha256].every(value => /^[a-f0-9]{64}$/.test(value || ''))) throw new Error('Admissions preview artifact hashes are invalid.')
  const rendererPath = childPath(root, 'renderer.cjs', 'renderer')
  const packagePath = childPath(root, 'package', 'package')
  const packageArchive = childPath(root, 'playwright-core-1.64.1.tgz', 'package archive')
  const seccompPath = childPath(root, 'seccomp_profile.json', 'seccomp profile')
  const licensePath = childPath(root, 'LICENSE-playwright', 'license')
  const rendererStat = fs.lstatSync(rendererPath, { throwIfNoEntry: false })
  const packageStat = fs.lstatSync(packagePath, { throwIfNoEntry: false })
  const archiveStat = fs.lstatSync(packageArchive, { throwIfNoEntry: false })
  const seccompStat = fs.lstatSync(seccompPath, { throwIfNoEntry: false })
  const licenseStat = fs.lstatSync(licensePath, { throwIfNoEntry: false })
  if (!rendererStat?.isFile() || rendererStat.isSymbolicLink() || rendererStat.size > 64 * 1024) throw new Error('Admissions preview renderer is invalid.')
  if (sha256File(rendererPath) !== manifest.rendererSha256) throw new Error('Admissions preview renderer hash is invalid.')
  if (!packageStat?.isDirectory() || packageStat.isSymbolicLink()) throw new Error('Admissions preview package directory is invalid.')
  if (sha256DirectoryTree(packagePath) !== manifest.packageTreeSha256) throw new Error('Admissions preview package tree hash is invalid.')
  if (!archiveStat?.isFile() || archiveStat.isSymbolicLink() || archiveStat.size > 16 * 1024 * 1024 || sha256File(packageArchive) !== manifest.packageSha256) throw new Error('Admissions preview package archive is invalid.')
  if (!seccompStat?.isFile() || seccompStat.isSymbolicLink() || seccompStat.size > 64 * 1024) throw new Error('Admissions preview seccomp profile is invalid.')
  if (sha256File(seccompPath) !== manifest.seccompSha256) throw new Error('Admissions preview seccomp hash is invalid.')
  if (!licenseStat?.isFile() || licenseStat.isSymbolicLink() || licenseStat.size > 64 * 1024) throw new Error('Admissions preview license is invalid.')
  let packageVersion
  try { packageVersion = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8')).version } catch { /* checked below */ }
  if (packageVersion !== '1.64.1') throw new Error('Admissions preview playwright-core package version is invalid.')
  return { configured: true, image, artifactRoot: root, seccompPath }
}

export function dockerAdmissionsPreviewCreateArgs({ image, name, seccompPath = '/opt/stemist/playwright-1.64.1-seccomp.json' }) {
  return [
    'create', '--name', name,
    '--interactive',
    '--network', 'none', '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--security-opt', `seccomp=${seccompPath}`,
    '--pids-limit', '128', '--cpus', '1', '--memory', '512m', '--shm-size', '128m',
    '--user', '1000:1000', '--ipc', 'private',
    '--env', 'HOME=/tmp', '--env', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
    '--workdir', '/runtime',
    image, 'node', '/runtime/renderer.cjs',
  ]
}

function runAttached(containerId, input, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['start', '-ai', containerId], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(renderError('ADMISSIONS_PREVIEW_RENDER_TIMEOUT', 'Preview renderer timed out.'))
    }, timeoutMs)
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_RENDER_OUTPUT_BYTES) child.kill()
      else stdout.push(chunk)
    })
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 32 * 1024) child.kill() })
    child.on('error', error => finish(Object.assign(renderError('ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE', 'Preview renderer could not start.'), { cause: error })))
    child.on('close', code => {
      if (code !== 0 || stdoutBytes > MAX_RENDER_OUTPUT_BYTES) finish(renderError('ADMISSIONS_PREVIEW_RENDER_FAILED', 'Preview renderer failed.'))
      else {
        try { finish(null, JSON.parse(Buffer.concat(stdout).toString('utf8'))) }
        catch { finish(renderError('ADMISSIONS_PREVIEW_RENDER_INVALID', 'Preview renderer returned invalid JSON.')) }
      }
    })
    child.stdin.on('error', error => finish(Object.assign(renderError('ADMISSIONS_PREVIEW_RENDER_STDIN_FAILED', 'Preview renderer input failed.'), { cause: error })))
    child.stdin.end(JSON.stringify(input))
  })
}

export async function runDockerAdmissionsPreview({ configuration, bundle, deadlineAt = Date.now() + 10_000 }) {
  const name = `stem-admissions-preview-${crypto.randomBytes(8).toString('hex')}`
  let containerId = ''
  try {
    const remaining = () => Math.max(1, deadlineAt - Date.now())
    if (remaining() <= 1) throw renderError('ADMISSIONS_PREVIEW_RENDER_TIMEOUT', 'Preview renderer deadline expired.')
    const created = await execFileAsync('docker', dockerAdmissionsPreviewCreateArgs({ image: configuration.image, name, seccompPath: configuration.seccompPath }), { windowsHide: true, timeout: Math.min(8_000, remaining()), maxBuffer: 64 * 1024 })
    containerId = String(created.stdout || '').trim()
    if (!/^[a-f0-9]{12,64}$/i.test(containerId)) throw renderError('ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE', 'Preview container was not created.')
    await execFileAsync('docker', ['cp', `${configuration.artifactRoot}${path.sep}.`, `${containerId}:/runtime`], { windowsHide: true, timeout: Math.min(8_000, remaining()), maxBuffer: 64 * 1024 })
    return await runAttached(containerId, bundle, Math.min(10_000, remaining()))
  } catch (error) {
    if (error?.code?.startsWith('ADMISSIONS_')) throw error
    throw renderError('ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE', 'Preview renderer is unavailable.')
  } finally {
    if (containerId) await execFileAsync('docker', ['rm', '-f', containerId], { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 }).catch(() => {})
  }
}

function validOutput(value) {
  if (!value || value.mimeType !== 'image/png' || typeof value.base64 !== 'string') throw renderError('ADMISSIONS_PREVIEW_RENDER_INVALID', 'Preview renderer output is invalid.')
  const bytes = Buffer.from(value.base64, 'base64')
  if (bytes.length < 8 || bytes.length > 2 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw renderError('ADMISSIONS_PREVIEW_RENDER_INVALID', 'Preview image is not a bounded PNG.')
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 100 || value.width > 1600 || value.height < 100 || value.height > 2400) throw renderError('ADMISSIONS_PREVIEW_RENDER_INVALID', 'Preview dimensions are invalid.')
  return value
}

export function createAdmissionsPreviewRenderer({ artifactRoot = DEFAULT_ADMISSIONS_PREVIEW_RUNTIME_ROOT, configuration = null, runContainer = null } = {}) {
  const config = configuration || validatedPreviewRendererConfig({ artifactRoot })
  const execute = runContainer || ((bundle, options) => runDockerAdmissionsPreview({ configuration: config, bundle, ...options }))
  let tail = Promise.resolve()
  let closed = false
  let pending = 0
  return Object.freeze({
    configured: config.configured === true,
    render(bundle, { deadlineAt = Date.now() + 10_000 } = {}) {
      if (closed || !config.configured) return Promise.reject(renderError('ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE', 'Preview renderer is unavailable.'))
      if (pending >= 2) return Promise.reject(renderError('ADMISSIONS_PREVIEW_RENDER_BUSY', 'Preview renderer is busy.'))
      const html = String(bundle?.html || '')
      if (!html || Buffer.byteLength(html) > MAX_RENDER_INPUT_BYTES || /https?:\/\/|<(?:script|iframe|object|embed)\b|\son[a-z]+\s*=/iu.test(html)) {
        return Promise.reject(renderError('ADMISSIONS_PREVIEW_BUNDLE_UNSAFE', 'Preview bundle is not offline-safe.'))
      }
      pending += 1
      const payload = { html, width: Number(bundle.width) || 390, height: Number(bundle.height) || 900 }
      const task = tail.then(() => {
        if (Date.now() >= deadlineAt) throw renderError('ADMISSIONS_PREVIEW_RENDER_TIMEOUT', 'Preview renderer deadline expired while queued.')
        return execute(payload, { deadlineAt })
      }).then(validOutput).finally(() => { pending -= 1 })
      tail = task.catch(() => {})
      return task
    },
    close() { closed = true },
  })
}
