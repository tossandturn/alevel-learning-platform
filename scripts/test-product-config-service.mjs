import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  CONFIG_SCHEMA_VERSION,
  MAX_CONFIG_BYTES,
  validateProductConfig,
  validateProductConfigBytes,
} from '../services/product-config/schema.mjs'
import { ERROR_SCHEMA_VERSION } from '../services/product-config/errors.mjs'
import {
  acquirePublicationLock,
  productConfigLockInternals,
  publishConfig,
  readActivePublication,
  releasePublicationLock,
  rollbackConfig,
} from '../services/product-config/store.mjs'
import { createProductConfigServer } from '../services/product-config/server.mjs'
import { parseServeArguments } from '../services/product-config/serve.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const defaultsPath = path.resolve(repoRoot, '..', 'backend-driven-foundation-20261011T012618', 'defaults.json')
const defaultsBytes = fs.readFileSync(defaultsPath)
const defaults = JSON.parse(defaultsBytes.toString('utf8'))
const iconAllowlist = new Set(defaults.tavern.presets.map((preset) => preset.icon))
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-product-config-'))
const storeRoot = path.join(tempRoot, 'runtime-store')
const iconAllowlistPath = path.join(tempRoot, 'icons.json')
fs.writeFileSync(iconAllowlistPath, `${JSON.stringify([...iconAllowlist])}\n`, 'utf8')

const clone = (value) => structuredClone(value)
const bytesOf = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function expectCode(operation, code) {
  assert.throws(operation, (error) => error?.code === code, `expected ${code}`)
}

function expectInvalid(mutate) {
  const candidate = clone(defaults)
  mutate(candidate)
  expectCode(() => validateProductConfig(candidate, { iconAllowlist }), 'invalid_config')
}

function request(server, pathname, { method = 'GET', headers = {}, body = null } = {}) {
  const address = server.address()
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers }
    if (body !== null && !Object.hasOwn(requestHeaders, 'Content-Length')) {
      requestHeaders['Content-Length'] = Buffer.byteLength(body)
    }
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path: pathname,
      method,
      headers: requestHeaders,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }))
    })
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })
}

function runNode(file, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('exit', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
  })
}

function spawnLockHolder(store, channel) {
  const storeModule = pathToFileURL(path.join(repoRoot, 'services', 'product-config', 'store.mjs')).href
  const source = `import { acquirePublicationLock } from ${JSON.stringify(storeModule)}; acquirePublicationLock({ storeRoot: ${JSON.stringify(store)}, channel: ${JSON.stringify(channel)} }); console.log(JSON.stringify({ status: 'LOCKED', pid: process.pid })); setInterval(() => {}, 1000);`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const stderr = []
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`lock holder timed out: ${Buffer.concat(stderr).toString('utf8')}`))
    }, 5000)
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      const message = JSON.parse(stdout.slice(0, newline))
      resolve({ child, message })
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (stdout.includes('\n')) return
      clearTimeout(timer)
      reject(new Error(`lock holder exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`))
    })
  })
}

function spawnRecoveryClaimer(store, channel) {
  const storeModule = pathToFileURL(path.join(repoRoot, 'services', 'product-config', 'store.mjs')).href
  const source = `import { productConfigLockInternals } from ${JSON.stringify(storeModule)}; const observed=productConfigLockInternals.inspect({ storeRoot: ${JSON.stringify(store)}, channel: ${JSON.stringify(channel)} }); const claim=productConfigLockInternals.claimRecovery({ storeRoot: ${JSON.stringify(store)}, channel: ${JSON.stringify(channel)} }); if(!claim) throw new Error('recovery claim unavailable'); console.log(JSON.stringify({ status: 'RECLAIMED', pid: process.pid, generation: claim.generation, observedState: observed.state })); setInterval(() => {}, 1000);`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return new Promise((resolve, reject) => {
    const stderr = []
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`recovery claimer timed out: ${Buffer.concat(stderr).toString('utf8')}`))
    }, 5000)
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      resolve({ child, message: JSON.parse(stdout.slice(0, newline)) })
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      if (stdout.includes('\n')) return
      clearTimeout(timer)
      reject(new Error(`recovery claimer exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`))
    })
  })
}

async function killAndWait(child) {
  if (child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
}

try {
  assert.equal(defaultsBytes.length, 7097)
  assert.equal(sha256(defaultsBytes), 'c6f44488e67955218b39cbf0ddfa6618590c270a20e9ac21928c1f696bbc1ea9')
  assert.equal(CONFIG_SCHEMA_VERSION, 'stemist-product-config-v1')
  const validatedDefaults = validateProductConfigBytes(defaultsBytes, { iconAllowlist })
  assert.equal(validatedDefaults.config.revision, 'foundation-v1')
  assert.equal(validatedDefaults.bytes.length, defaultsBytes.length)
  assert.equal(validatedDefaults.sha256, sha256(defaultsBytes))

  expectInvalid((config) => { config.unknown = true })
  expectInvalid((config) => { config.schemaVersion = 'stemist-product-config-v0' })
  expectInvalid((config) => { config.schemaVersion = 'stemist-product-config-v2' })
  expectInvalid((config) => { config.minCapabilityVersion = '1' })
  expectInvalid((config) => { config.revision = '../escape' })
  expectInvalid((config) => { config.revision = 'none' })
  expectInvalid((config) => { config.publishedAt = '2026-10-11T01:32:03.802' })
  for (const publishedAt of [
    '2026-02-29T01:32:03+08:00',
    '2026-10-11T24:00:00+08:00',
    '2026-10-11T01:60:00+08:00',
    '2026-10-11T01:32:60+08:00',
    '2026-10-11T01:32:03.1234+08:00',
    '2026-10-11T01:32:03+14:30',
  ]) expectInvalid((config) => { config.publishedAt = publishedAt })
  for (const publishedAt of [
    '2026-10-11T01:32:03+08:00',
    '2026-10-11T01:32:03.1+08:00',
    '2026-10-11T01:32:03.12+08:00',
    '2026-10-11T01:32:03.123+08:00',
    '2026-10-10T17:32:03.123Z',
  ]) {
    const timestampCandidate = clone(defaults)
    timestampCandidate.publishedAt = publishedAt
    assert.doesNotThrow(() => validateProductConfig(timestampCandidate, { iconAllowlist }))
  }
  expectInvalid((config) => { config.home.heading = ' leading' })
  expectInvalid((config) => { config.home.heading = 'bad\nheading' })
  expectInvalid((config) => { config.home.heading = `bad${String.fromCharCode(0x85)}heading` })
  expectInvalid((config) => { config.home.heading = `bad${String.fromCharCode(0xd800)}heading` })
  expectInvalid((config) => { config.home.heading = `bad${String.fromCharCode(0xdc00)}heading` })
  expectInvalid((config) => { config.home.entries[0].unknown = 'x' })
  expectInvalid((config) => { config.home.entries[1].id = config.home.entries[0].id })
  expectInvalid((config) => { config.home.entries.pop() })
  expectInvalid((config) => { config.home.entries[0].tone = 'purple' })
  expectInvalid((config) => { config.home.entries[0].detail = '' })
  expectInvalid((config) => { config.coach.modes[0].id = 'unknown' })
  expectInvalid((config) => { config.coach.modes[0].detail = '' })
  expectInvalid((config) => { config.tavern.categories[1].id = 'all' })
  expectInvalid((config) => { config.tavern.presets[1].id = config.tavern.presets[0].id })
  expectInvalid((config) => { config.tavern.presets[0].icon = '../keeper.svg' })
  expectInvalid((config) => { config.tavern.presets[0].icon = 'not-packaged.svg' })
  expectInvalid((config) => { config.tavern.presets[0].detail = '' })
  expectInvalid((config) => { config.tavern.presets[0].placeholder = '' })
  expectInvalid((config) => {
    config.tavern.presets.push({
      ...clone(config.tavern.presets[0]),
      id: 'new-fortune-preset',
      category: 'fortune',
    })
  })
  expectInvalid((config) => { config.home.secondary[0].action = { kind: 'page', target: 'admin' } })
  expectInvalid((config) => { config.home.secondary[0].action = { kind: 'screen', target: 'missing-screen' } })
  expectInvalid((config) => { config.home.secondary[0].action = { kind: 'script', source: 'alert(1)' } })
  expectInvalid((config) => { config.home.secondary[0].action = { kind: 'page', target: 'coach', extra: true } })

  const safeCopy = clone(defaults)
  safeCopy.home.secondary.push({
    id: 'copy-public-guide',
    label: 'Copy guide link',
    action: { kind: 'copy', url: 'https://www.cambridgeinternational.org/programmes-and-qualifications/' },
  })
  safeCopy.home.secondary.push({
    id: 'copy-encoded-space',
    label: 'Copy encoded-space link',
    action: { kind: 'copy', url: 'https://example.edu/a%20b' },
  })
  safeCopy.home.secondary.push({
    id: 'copy-recursive-space',
    label: 'Copy recursively encoded space',
    action: { kind: 'copy', url: 'https://example.edu/a%2520b' },
  })
  assert.doesNotThrow(() => validateProductConfig(safeCopy, { iconAllowlist }))
  let deeplyEncodedTraversal = '%2e%2e'
  for (let pass = 0; pass < 9; pass += 1) deeplyEncodedTraversal = deeplyEncodedTraversal.replaceAll('%', '%25')
  for (const url of [
    'http://example.com/path',
    'https://localhost/path',
    'https://127.0.0.1/path',
    'https://[::1]/path',
    'https://user@example.com/path',
    'https://example.com:443/path',
    'https://example.com/path?token=x',
    'https://example.com/path#fragment',
    'https://example.com/a/../secret',
    'https://example.com/a/%2e%2e/secret',
    'https://example.com/a/%252e%252e/secret',
    'https://example.com/a%2fsecret',
    'https://example.com/a%252fsecret',
    'https://example.com/a/%00/secret',
    'https://example.com/a/%2500/secret',
    `https://example.com/a/${deeplyEncodedTraversal}/secret`,
    'https://example.com/a\\secret',
    'https://example.com/bad path',
    'https://Example.com/path',
    'https://éxample.com/path',
    'https://-bad.com/path',
    'https://bad-.com/path',
    'https://bad..com/path',
    'https://bad_host.com/path',
    'https://example.c/path',
    'https://example.123/path',
    'https://service.local/path',
    'https://service.internal/path',
    'https://service.lan/path',
    'https://service.home/path',
    'https://service.test/path',
    'https://service.invalid/path',
    'https://service.example/path',
    'https://service.onion/path',
    'file:///etc/passwd',
  ]) {
    expectInvalid((config) => {
      config.home.secondary.push({ id: 'bad-copy', label: 'Bad', action: { kind: 'copy', url } })
    })
  }

  const generic = clone(defaults)
  generic.pages = [{
    id: 'foundation-info',
    title: 'Foundation information',
    sections: [
      { id: 'intro', type: 'text', title: '', text: 'Public information only.' },
      { id: 'notice', type: 'notice', title: 'Notice', text: 'No account data is used.', tone: 'info' },
      {
        id: 'links', type: 'links', title: 'Links', items: [
          { id: 'home', label: 'Home', detail: '', action: { kind: 'page', target: 'alevel' } },
          { id: 'copy', label: 'Copy', detail: 'Official public source', action: { kind: 'copy', url: 'https://www.cambridgeinternational.org/' } },
        ],
      },
    ],
  }]
  generic.home.secondary.push({ id: 'foundation-info', label: 'Foundation', action: { kind: 'screen', target: 'foundation-info' } })
  assert.doesNotThrow(() => validateProductConfig(generic, { iconAllowlist }))
  expectInvalid((config) => {
    config.pages = [{ id: 'broken', title: 'Broken', sections: [{ id: 'x', type: 'html', title: '', html: '<script />' }] }]
  })
  expectInvalid((config) => {
    config.pages = [{ id: 'bad-notice', title: 'Bad notice', sections: [{ id: 'notice', type: 'notice', title: '', text: '', tone: 'info' }] }]
  })
  const itemBoundaryPage = (lastSectionItems) => ({
    id: 'item-boundary',
    title: 'Item boundary',
    sections: Array.from({ length: 4 }, (_, sectionIndex) => ({
      id: `links-${sectionIndex}`,
      type: 'links',
      title: '',
      items: Array.from({ length: sectionIndex === 3 ? lastSectionItems : 24 }, (_, itemIndex) => ({
          id: `item-${sectionIndex}-${itemIndex}`,
          label: 'Item',
          detail: '',
          action: { kind: 'page', target: 'alevel' },
      })),
    })),
  })
  const exactItemBoundary = clone(defaults)
  exactItemBoundary.pages = [itemBoundaryPage(24)]
  assert.doesNotThrow(() => validateProductConfig(exactItemBoundary, { iconAllowlist }))
  expectInvalid((config) => { config.pages = [itemBoundaryPage(25)] })

  const oversized = clone(defaults)
  oversized.pages = Array.from({ length: 16 }, (_, pageIndex) => ({
    id: `page-${pageIndex}`,
    title: `Page ${pageIndex}`,
    sections: Array.from({ length: 20 }, (_, sectionIndex) => ({
      id: `section-${sectionIndex}`,
      type: 'text',
      title: '',
      text: 'x'.repeat(4000),
    })),
  }))
  const oversizedBytes = bytesOf(oversized)
  assert.ok(oversizedBytes.length > MAX_CONFIG_BYTES)
  expectCode(() => validateProductConfigBytes(oversizedBytes, { iconAllowlist }), 'config_too_large')

  expectCode(() => publishConfig({
    storeRoot: path.join(repoRoot, 'services', 'product-config', 'runtime-do-not-create'),
    channel: 'release',
    expectedCurrent: null,
    bytes: defaultsBytes,
    iconAllowlist,
  }), 'store_path_unsafe')

  const liveLockStore = path.join(tempRoot, 'live-lock-store')
  const liveLock = acquirePublicationLock({ storeRoot: liveLockStore, channel: 'release', timeoutMs: 100 })
  const liveOwner = JSON.parse(fs.readFileSync(path.join(liveLockStore, 'locks', 'release.lock', 'owner.json'), 'utf8'))
  assert.equal(liveOwner.pid, process.pid)
  assert.equal(typeof liveOwner.processStartIdentity, 'string')
  assert.ok(liveOwner.processStartIdentity.length > 0)
  expectCode(() => acquirePublicationLock({ storeRoot: liveLockStore, channel: 'release', timeoutMs: 100 }), 'publication_busy')
  expectCode(() => releasePublicationLock({ ...liveLock, token: '0'.repeat(32) }), 'lock_ownership_lost')
  expectCode(() => acquirePublicationLock({ storeRoot: liveLockStore, channel: 'release', timeoutMs: 100 }), 'publication_busy')
  releasePublicationLock(liveLock)
  const reacquired = acquirePublicationLock({ storeRoot: liveLockStore, channel: 'release', timeoutMs: 100 })
  releasePublicationLock(reacquired)

  const killedLockStore = path.join(tempRoot, 'killed-lock-store')
  const killedHolder = await spawnLockHolder(killedLockStore, 'trial')
  try {
    assert.equal(killedHolder.message.status, 'LOCKED')
    expectCode(() => acquirePublicationLock({ storeRoot: killedLockStore, channel: 'trial', timeoutMs: 100 }), 'publication_busy')
  } finally {
    await killAndWait(killedHolder.child)
  }
  const recoveredKilled = acquirePublicationLock({ storeRoot: killedLockStore, channel: 'trial', timeoutMs: 1000 })
  releasePublicationLock(recoveredKilled)

  const reaperRaceStore = path.join(tempRoot, 'reaper-race-store')
  const reaperRaceOwner = await spawnLockHolder(reaperRaceStore, 'release')
  await killAndWait(reaperRaceOwner.child)
  const observedDeadA = productConfigLockInternals.inspect({ storeRoot: reaperRaceStore, channel: 'release' })
  assert.equal(observedDeadA.state, 'stale')
  const recoveredB = productConfigLockInternals.recoverObserved({
    storeRoot: reaperRaceStore,
    channel: 'release',
    observed: observedDeadA,
  })
  assert.ok(recoveredB)
  const staleReaperResult = productConfigLockInternals.recoverObserved({
    storeRoot: reaperRaceStore,
    channel: 'release',
    observed: observedDeadA,
  })
  assert.equal(staleReaperResult, null)
  const freshOwnerB = JSON.parse(fs.readFileSync(path.join(reaperRaceStore, 'locks', 'release.lock', 'owner.json'), 'utf8'))
  assert.equal(freshOwnerB.token, recoveredB.token)
  assert.equal(freshOwnerB.pid, process.pid)
  expectCode(() => acquirePublicationLock({ storeRoot: reaperRaceStore, channel: 'release', timeoutMs: 100 }), 'publication_busy')
  releasePublicationLock(recoveredB)

  const recoveryCrashStore = path.join(tempRoot, 'recovery-crash-store')
  const recoveryCrashOwner = await spawnLockHolder(recoveryCrashStore, 'release')
  await killAndWait(recoveryCrashOwner.child)
  const crashedReaper = await spawnRecoveryClaimer(recoveryCrashStore, 'release')
  assert.equal(crashedReaper.message.status, 'RECLAIMED')
  assert.equal(crashedReaper.message.generation, 0)
  await killAndWait(crashedReaper.child)
  const recoveredAfterReaperCrash = acquirePublicationLock({ storeRoot: recoveryCrashStore, channel: 'release', timeoutMs: 1000 })
  const recoveryGenerations = fs.readdirSync(path.join(recoveryCrashStore, 'locks', 'release.lock'))
    .filter((name) => /^\.reclaim-\d+$/u.test(name))
    .sort()
  assert.deepEqual(recoveryGenerations, ['.reclaim-0', '.reclaim-1'])
  releasePublicationLock(recoveredAfterReaperCrash)

  const partialLockStore = path.join(tempRoot, 'partial-lock-store')
  const initializePartialStore = acquirePublicationLock({ storeRoot: partialLockStore, channel: 'develop', timeoutMs: 100 })
  releasePublicationLock(initializePartialStore)
  const partialLockPath = path.join(partialLockStore, 'locks', 'develop.lock')
  fs.mkdirSync(partialLockPath)
  expectCode(() => acquirePublicationLock({
    storeRoot: partialLockStore,
    channel: 'develop',
    timeoutMs: 100,
    partialOwnerGraceMs: 1000,
  }), 'publication_busy')
  const staleTime = new Date(Date.now() - 2000)
  fs.utimesSync(partialLockPath, staleTime, staleTime)
  const recoveredPartial = acquirePublicationLock({
    storeRoot: partialLockStore,
    channel: 'develop',
    timeoutMs: 1000,
    partialOwnerGraceMs: 1000,
  })
  releasePublicationLock(recoveredPartial)
  expectCode(() => publishConfig({
    storeRoot: 'relative-runtime-store',
    channel: 'release',
    expectedCurrent: null,
    bytes: defaultsBytes,
    iconAllowlist,
  }), 'store_path_unsafe')

  const first = publishConfig({ storeRoot, channel: 'release', expectedCurrent: null, bytes: defaultsBytes, iconAllowlist })
  assert.equal(first.status, 'PUBLISHED')
  assert.equal(first.revision, 'foundation-v1')
  assert.equal(first.previousRevision, null)
  assert.equal(readActivePublication({ storeRoot, channel: 'release', iconAllowlist }).bytes.equals(defaultsBytes), true)

  const oversizedStore = path.join(tempRoot, 'oversized-store')
  const oversizedSeed = clone(defaults)
  oversizedSeed.revision = 'oversized-seed'
  publishConfig({ storeRoot: oversizedStore, channel: 'release', expectedCurrent: null, bytes: bytesOf(oversizedSeed), iconAllowlist })
  const oversizedExisting = clone(defaults)
  oversizedExisting.revision = 'oversized-existing'
  const oversizedExistingPath = path.join(oversizedStore, 'revisions', 'oversized-existing.json')
  fs.writeFileSync(oversizedExistingPath, Buffer.alloc(MAX_CONFIG_BYTES + 1, 0x20))
  expectCode(() => publishConfig({
    storeRoot: oversizedStore,
    channel: 'release',
    expectedCurrent: 'oversized-seed',
    bytes: bytesOf(oversizedExisting),
    iconAllowlist,
  }), 'config_corrupt')
  assert.equal(readActivePublication({ storeRoot: oversizedStore, channel: 'release', iconAllowlist }).config.revision, 'oversized-seed')
  fs.truncateSync(path.join(oversizedStore, 'revisions', 'oversized-seed.json'), MAX_CONFIG_BYTES + 1)
  expectCode(() => readActivePublication({ storeRoot: oversizedStore, channel: 'release', iconAllowlist }), 'config_corrupt')

  const idempotent = publishConfig({ storeRoot, channel: 'release', expectedCurrent: 'foundation-v1', bytes: defaultsBytes, iconAllowlist })
  assert.equal(idempotent.revisionCreated, false)

  const conflicting = clone(defaults)
  conflicting.home.heading = 'Different bytes, same revision'
  expectCode(() => publishConfig({
    storeRoot,
    channel: 'release',
    expectedCurrent: 'foundation-v1',
    bytes: bytesOf(conflicting),
    iconAllowlist,
  }), 'revision_bytes_conflict')
  assert.equal(readActivePublication({ storeRoot, channel: 'release', iconAllowlist }).config.home.heading, defaults.home.heading)

  const invalidSchema = clone(defaults)
  invalidSchema.revision = 'invalid-schema-v1'
  invalidSchema.schemaVersion = 'unknown-schema'
  expectCode(() => publishConfig({
    storeRoot,
    channel: 'release',
    expectedCurrent: 'foundation-v1',
    bytes: bytesOf(invalidSchema),
    iconAllowlist,
  }), 'invalid_config')
  assert.equal(fs.existsSync(path.join(storeRoot, 'revisions', 'invalid-schema-v1.json')), false)

  const v2 = clone(defaults)
  v2.revision = 'foundation-v2'
  v2.publishedAt = '2026-10-11T01:40:00.000+08:00'
  v2.home.heading = 'Backend-updated heading'
  const v2Bytes = bytesOf(v2)
  publishConfig({ storeRoot, channel: 'release', expectedCurrent: 'foundation-v1', bytes: v2Bytes, iconAllowlist })
  assert.equal(readActivePublication({ storeRoot, channel: 'release', iconAllowlist }).config.revision, 'foundation-v2')
  expectCode(() => publishConfig({ storeRoot, channel: 'release', expectedCurrent: 'foundation-v1', bytes: defaultsBytes, iconAllowlist }), 'expected_current_mismatch')

  const trial = clone(defaults)
  trial.revision = 'trial-v1'
  trial.publishedAt = '2026-10-11T01:41:00.000+08:00'
  trial.home.heading = 'Trial heading'
  publishConfig({ storeRoot, channel: 'trial', expectedCurrent: null, bytes: bytesOf(trial), iconAllowlist })
  assert.equal(readActivePublication({ storeRoot, channel: 'trial', iconAllowlist }).config.revision, 'trial-v1')
  assert.equal(readActivePublication({ storeRoot, channel: 'release', iconAllowlist }).config.revision, 'foundation-v2')
  expectCode(() => readActivePublication({ storeRoot, channel: 'develop', iconAllowlist }), 'config_unavailable')

  const rolledBack = rollbackConfig({
    storeRoot,
    channel: 'release',
    expectedCurrent: 'foundation-v2',
    revision: 'foundation-v1',
    iconAllowlist,
  })
  assert.equal(rolledBack.status, 'ROLLED_BACK')
  assert.equal(readActivePublication({ storeRoot, channel: 'release', iconAllowlist }).config.revision, 'foundation-v1')
  assert.equal(fs.existsSync(path.join(storeRoot, 'revisions', 'foundation-v2.json')), true)
  expectCode(() => rollbackConfig({ storeRoot, channel: 'release', expectedCurrent: 'foundation-v2', revision: 'foundation-v1', iconAllowlist }), 'expected_current_mismatch')
  expectCode(() => rollbackConfig({ storeRoot, channel: 'release', expectedCurrent: 'foundation-v1', revision: '../escape', iconAllowlist }), 'invalid_revision')
  expectCode(() => rollbackConfig({ storeRoot, channel: 'release', expectedCurrent: 'foundation-v1', revision: 'none', iconAllowlist }), 'invalid_revision')
  expectCode(() => rollbackConfig({ storeRoot, channel: 'release', expectedCurrent: 'foundation-v1', revision: 'missing-revision', iconAllowlist }), 'config_unavailable')

  const concurrentA = clone(defaults)
  concurrentA.revision = 'concurrent-a'
  concurrentA.publishedAt = '2026-10-11T01:42:00.000+08:00'
  concurrentA.home.heading = 'Concurrent A'
  const concurrentB = clone(defaults)
  concurrentB.revision = 'concurrent-b'
  concurrentB.publishedAt = '2026-10-11T01:42:01.000+08:00'
  concurrentB.home.heading = 'Concurrent B'
  const inputA = path.join(tempRoot, 'concurrent-a.json')
  const inputB = path.join(tempRoot, 'concurrent-b.json')
  fs.writeFileSync(inputA, bytesOf(concurrentA))
  fs.writeFileSync(inputB, bytesOf(concurrentB))
  const publishCli = path.join(repoRoot, 'services', 'product-config', 'publish.mjs')
  const commonArgs = ['--store', storeRoot, '--channel', 'release', '--expected-current', 'foundation-v1', '--icon-allowlist', iconAllowlistPath]
  const concurrentResults = await Promise.all([
    runNode(publishCli, [...commonArgs, '--input', inputA]),
    runNode(publishCli, [...commonArgs, '--input', inputB]),
  ])
  assert.equal(concurrentResults.filter((result) => result.code === 0).length, 1)
  assert.equal(concurrentResults.filter((result) => result.code !== 0).length, 1)
  const concurrentFailure = JSON.parse(concurrentResults.find((result) => result.code !== 0).stderr)
  assert.equal(concurrentFailure.schemaVersion, ERROR_SCHEMA_VERSION)
  assert.equal(concurrentFailure.code, 'expected_current_mismatch')
  const concurrentWinner = readActivePublication({ storeRoot, channel: 'release', iconAllowlist }).config.revision
  assert.ok(['concurrent-a', 'concurrent-b'].includes(concurrentWinner))
  const rollbackCli = path.join(repoRoot, 'services', 'product-config', 'rollback.mjs')
  const rollbackResult = await runNode(rollbackCli, [
    '--store', storeRoot,
    '--channel', 'release',
    '--expected-current', concurrentWinner,
    '--revision', 'foundation-v1',
    '--icon-allowlist', iconAllowlistPath,
  ])
  assert.equal(rollbackResult.code, 0, rollbackResult.stderr)
  assert.equal(JSON.parse(rollbackResult.stdout).status, 'ROLLED_BACK')
  assert.equal(readActivePublication({ storeRoot, channel: 'release', iconAllowlist }).config.revision, 'foundation-v1')

  assert.throws(() => parseServeArguments([
    '--store', storeRoot,
    '--icon-allowlist', iconAllowlistPath,
    '--host', '0.0.0.0',
    '--port', '4310',
  ]), (error) => error?.code === 'host_not_loopback')
  assert.equal(parseServeArguments([
    '--store', storeRoot,
    '--icon-allowlist', iconAllowlistPath,
    '--host', '127.0.0.1',
    '--port', '4310',
  ]).port, 4310)

  const server = createProductConfigServer({ storeRoot, iconAllowlist })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const get = await request(server, '/api/product/config?capability=1')
    assert.equal(get.status, 200)
    assert.equal(get.body.equals(defaultsBytes), true)
    assert.equal(get.headers['cache-control'], 'no-cache')
    assert.equal(get.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(Number(get.headers['content-length']), defaultsBytes.length)
    assert.equal(get.headers.etag, `"${sha256(defaultsBytes)}"`)

    const head = await request(server, '/api/product/config?channel=release&capability=1', { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.body.length, 0)
    assert.equal(Number(head.headers['content-length']), defaultsBytes.length)
    assert.equal(head.headers.etag, get.headers.etag)

    const notModified = await request(server, '/api/product/config?channel=release&capability=1', {
      headers: { 'If-None-Match': `"other", ${get.headers.etag}` },
    })
    assert.equal(notModified.status, 304)
    assert.equal(notModified.body.length, 0)
    assert.equal(notModified.headers.etag, get.headers.etag)
    assert.equal(notModified.headers['cache-control'], 'no-cache')

    const trialResponse = await request(server, '/api/product/config?channel=trial&capability=1')
    assert.equal(trialResponse.status, 200)
    assert.equal(JSON.parse(trialResponse.body).revision, 'trial-v1')

    const health = await request(server, '/healthz')
    assert.equal(health.status, 200)
    const healthBody = JSON.parse(health.body)
    assert.equal(healthBody.ok, true)
    assert.equal(healthBody.schemaVersion, CONFIG_SCHEMA_VERSION)
    assert.equal(healthBody.channels.release, 'foundation-v1')
    assert.equal(healthBody.channels.trial, 'trial-v1')
    assert.equal(health.headers['cache-control'], 'no-store')

    const rejectionCases = [
      ['/api/product/config', 400],
      ['/api/product/config?capability=2', 409],
      ['/api/product/config?capability=1&channel=beta', 400],
      ['/api/product/config?capability=1&channel=release&channel=trial', 400],
      ['/api/product/config?capability=1&unknown=x', 400],
      ['/api/product/../product/config?capability=1', 400],
      ['/api/product/%2e%2e/product/config?capability=1', 400],
      ['/api/product/%252e%252e/product/config?capability=1', 400],
      ['/api%252fproduct/config?capability=1', 400],
      ['/api/product/%2520/config?capability=1', 404],
      ['//api/product/config?capability=1', 400],
      ['/api/product/config/extra?capability=1', 404],
      ['/unknown', 404],
    ]
    for (const [pathname, status] of rejectionCases) {
      const response = await request(server, pathname)
      assert.equal(response.status, status, pathname)
      assert.doesNotMatch(response.body.toString('utf8'), /stack|D:\\|stem-product-config-/i)
      const errorBody = JSON.parse(response.body)
      assert.equal(errorBody.schemaVersion, ERROR_SCHEMA_VERSION)
      assert.equal(errorBody.ok, false)
      assert.deepEqual(Object.keys(errorBody).sort(), ['schemaVersion', 'ok', 'code', 'error'].sort())
    }

    const writeAttempt = await request(server, '/api/product/config?capability=1', { method: 'POST', body: '{}' })
    assert.equal(writeAttempt.status, 405)
    assert.match(writeAttempt.headers.allow, /GET, HEAD/)
    assert.equal(JSON.parse(writeAttempt.body).schemaVersion, ERROR_SCHEMA_VERSION)
    const getWithBody = await request(server, '/api/product/config?capability=1', { body: '{}' })
    assert.equal(getWithBody.status, 400)

    const channelsDir = path.join(storeRoot, 'channels')
    fs.writeFileSync(path.join(channelsDir, 'develop.json'), '{"revision":"../../secret"}\n', 'utf8')
    const corruptPointer = await request(server, '/api/product/config?channel=develop&capability=1')
    assert.equal(corruptPointer.status, 503)
    assert.doesNotMatch(corruptPointer.body.toString('utf8'), /secret|stack|runtime-store/i)
    assert.equal(JSON.parse(corruptPointer.body).schemaVersion, ERROR_SCHEMA_VERSION)

    fs.writeFileSync(path.join(storeRoot, 'revisions', 'foundation-v1.json'), '{"bad":true}\n', 'utf8')
    const corruptRevision = await request(server, '/api/product/config?channel=release&capability=1')
    assert.equal(corruptRevision.status, 503)
    assert.doesNotMatch(corruptRevision.body.toString('utf8'), /foundation-v1\.json|stack|runtime-store/i)
    assert.equal(JSON.parse(corruptRevision.body).schemaVersion, ERROR_SCHEMA_VERSION)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  const serviceFiles = fs.readdirSync(path.join(repoRoot, 'services', 'product-config')).filter((name) => name.endsWith('.mjs'))
  for (const name of serviceFiles) {
    const source = fs.readFileSync(path.join(repoRoot, 'services', 'product-config', name), 'utf8')
    assert.doesNotMatch(source, /from ['"](?!node:|\.\/|\.\.\/)|require\(['"](?!node:|\.\/|\.\.\/)/)
    assert.doesNotMatch(source, /api[_-]?key|student[_-]?(?:id|record)|cookie|authorization\s*:/i)
  }

  console.log(JSON.stringify({
    status: 'passed',
    defaultsBytes: defaultsBytes.length,
    defaultsSha256: sha256(defaultsBytes),
    immutableRevisions: fs.readdirSync(path.join(storeRoot, 'revisions')).length,
    concurrentWinner,
    http: { etag: `"${sha256(defaultsBytes)}"`, maxConfigBytes: MAX_CONFIG_BYTES },
  }))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
