import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CHANNELS, MAX_CONFIG_BYTES, validateProductConfigBytes } from './schema.mjs'
import { productConfigError } from './errors.mjs'

const POINTER_SCHEMA_VERSION = 'stemist-product-config-pointer-v1'
const LOCK_SCHEMA_VERSION = 'stemist-product-config-lock-v1'
const REVISION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const SERVICE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4))
const DEFAULT_PARTIAL_OWNER_GRACE_MS = 30_000

function linuxProcessStartIdentity(pid) {
  if (process.platform !== 'linux') return null
  try {
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(') ')
    if (!bootId || commandEnd === -1) return null
    const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/u)
    const startTicks = fieldsAfterCommand[19]
    return startTicks ? `linux:${bootId}:${startTicks}` : null
  } catch {
    return null
  }
}

const PROCESS_START_IDENTITY = linuxProcessStartIdentity(process.pid)
  || `portable:${process.pid}:${Math.max(0, Math.floor(Date.now() - process.uptime() * 1000))}`

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validateChannel(channel) {
  if (!CHANNELS.includes(channel)) throw productConfigError('invalid_channel', 'Configuration channel is unsupported.', { statusCode: 400 })
  return channel
}

function validateRevision(revision) {
  if (typeof revision !== 'string' || revision === 'none' || !REVISION_PATTERN.test(revision)) {
    throw productConfigError('invalid_revision', 'Configuration revision is invalid.', { statusCode: 400 })
  }
  return revision
}

function validateExpectedCurrent(value) {
  if (value === null) return null
  return validateRevision(value)
}

function ensureExternalRoot(storeRoot) {
  if (typeof storeRoot !== 'string' || !path.isAbsolute(storeRoot)) {
    throw productConfigError('store_path_unsafe', 'Runtime store must use an explicit absolute path.', { statusCode: 400 })
  }
  const resolved = path.resolve(storeRoot)
  const relative = path.relative(SERVICE_ROOT, resolved)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw productConfigError('store_path_unsafe', 'Runtime store must be outside service source code.', { statusCode: 400 })
  }
  let existing = resolved
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const projected = path.resolve(fs.realpathSync.native(existing), path.relative(existing, resolved))
  const realServiceRoot = fs.realpathSync.native(SERVICE_ROOT)
  const projectedRelative = path.relative(realServiceRoot, projected)
  if (projectedRelative === '' || (!projectedRelative.startsWith(`..${path.sep}`) && projectedRelative !== '..' && !path.isAbsolute(projectedRelative))) {
    throw productConfigError('store_path_unsafe', 'Runtime store must be outside service source code.', { statusCode: 400 })
  }
  return resolved
}

function fsyncDirectory(directory) {
  let descriptor
  try {
    descriptor = fs.openSync(directory, 'r')
    fs.fsyncSync(descriptor)
  } catch (error) {
    if (process.platform !== 'win32' || !['EINVAL', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw productConfigError('store_path_unsafe', 'Runtime store contains an unsafe directory.', { statusCode: 500 })
  }
}

function storePaths(storeRoot, { create = false } = {}) {
  const root = ensureExternalRoot(storeRoot)
  const revisions = path.join(root, 'revisions')
  const channels = path.join(root, 'channels')
  const locks = path.join(root, 'locks')
  if (create) {
    ensureDirectory(root)
    for (const directory of [revisions, channels, locks]) ensureDirectory(directory)
    fsyncDirectory(root)
  } else {
    for (const directory of [root, revisions, channels]) {
      if (!fs.existsSync(directory)) throw productConfigError('config_unavailable', 'Product configuration is unavailable.', { statusCode: 503 })
      const stat = fs.lstatSync(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw productConfigError('config_corrupt', 'Product configuration failed integrity checks.', { statusCode: 503 })
      }
    }
  }
  return { root, revisions, channels, locks }
}

function durableTemporaryFile(directory, basename, bytes) {
  const random = crypto.randomBytes(12).toString('hex')
  const temporary = path.join(directory, `.${basename}.tmp-${process.pid}-${random}`)
  const descriptor = fs.openSync(temporary, 'wx', 0o600)
  try {
    let offset = 0
    while (offset < bytes.length) offset += fs.writeSync(descriptor, bytes, offset, bytes.length - offset)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  return temporary
}

function atomicReplace(filename, bytes) {
  const directory = path.dirname(filename)
  const temporary = durableTemporaryFile(directory, path.basename(filename), bytes)
  try {
    fs.renameSync(temporary, filename)
    fsyncDirectory(directory)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
}

function writeImmutableRevision(directory, revision, bytes) {
  const filename = path.join(directory, `${revision}.json`)
  if (fs.existsSync(filename)) {
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_CONFIG_BYTES) {
      throw productConfigError('config_corrupt', 'Stored revision failed integrity checks.', { statusCode: 503 })
    }
    const existing = fs.readFileSync(filename)
    if (!existing.equals(bytes)) throw productConfigError('revision_bytes_conflict', 'The revision already exists with different bytes.', { statusCode: 409 })
    return { filename, created: false }
  }
  const temporary = durableTemporaryFile(directory, `${revision}.json`, bytes)
  try {
    fs.linkSync(temporary, filename)
    fs.unlinkSync(temporary)
    fsyncDirectory(directory)
    return { filename, created: true }
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    if (error?.code === 'EEXIST') return writeImmutableRevision(directory, revision, bytes)
    throw error
  }
}

function pointerPath(paths, channel) {
  return path.join(paths.channels, `${validateChannel(channel)}.json`)
}

function readPointer(paths, channel, { optional = false } = {}) {
  const filename = pointerPath(paths, channel)
  if (!fs.existsSync(filename)) {
    if (optional) return null
    throw productConfigError('config_unavailable', 'Product configuration is unavailable.', { statusCode: 503 })
  }
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) {
    throw productConfigError('config_corrupt', 'Configuration pointer failed integrity checks.', { statusCode: 503 })
  }
  let pointer
  try {
    pointer = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch {
    throw productConfigError('config_corrupt', 'Configuration pointer failed integrity checks.', { statusCode: 503 })
  }
  if (!exactKeys(pointer, ['schemaVersion', 'channel', 'revision', 'sha256', 'updatedAt'])
      || pointer.schemaVersion !== POINTER_SCHEMA_VERSION
      || pointer.channel !== channel
      || typeof pointer.updatedAt !== 'string'
      || !Number.isFinite(Date.parse(pointer.updatedAt))
      || typeof pointer.sha256 !== 'string'
      || !SHA256_PATTERN.test(pointer.sha256)) {
    throw productConfigError('config_corrupt', 'Configuration pointer failed integrity checks.', { statusCode: 503 })
  }
  try {
    validateRevision(pointer.revision)
  } catch {
    throw productConfigError('config_corrupt', 'Configuration pointer failed integrity checks.', { statusCode: 503 })
  }
  return pointer
}

function revisionFile(paths, revision) {
  return path.join(paths.revisions, `${validateRevision(revision)}.json`)
}

function readStoredRevision(paths, revision, iconAllowlist) {
  const filename = revisionFile(paths, revision)
  if (!fs.existsSync(filename)) throw productConfigError('config_unavailable', 'Stored configuration revision is unavailable.', { statusCode: 503 })
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_CONFIG_BYTES) {
    throw productConfigError('config_corrupt', 'Stored configuration revision failed integrity checks.', { statusCode: 503 })
  }
  let validated
  try {
    validated = validateProductConfigBytes(fs.readFileSync(filename), { iconAllowlist })
  } catch {
    throw productConfigError('config_corrupt', 'Stored configuration revision failed integrity checks.', { statusCode: 503 })
  }
  if (validated.config.revision !== revision) throw productConfigError('config_corrupt', 'Stored configuration revision failed integrity checks.', { statusCode: 503 })
  return validated
}

function writePointer(paths, channel, validated, now) {
  const pointer = {
    schemaVersion: POINTER_SCHEMA_VERSION,
    channel,
    revision: validated.config.revision,
    sha256: validated.sha256,
    updatedAt: new Date(now()).toISOString(),
  }
  atomicReplace(pointerPath(paths, channel), Buffer.from(`${JSON.stringify(pointer)}\n`, 'utf8'))
  return pointer
}

function lockOwner(owner) {
  if (!exactKeys(owner, ['schemaVersion', 'pid', 'processStartIdentity', 'token', 'acquiredAtEpochMs'])
      || owner.schemaVersion !== LOCK_SCHEMA_VERSION
      || !Number.isSafeInteger(owner.pid)
      || owner.pid <= 0
      || typeof owner.processStartIdentity !== 'string'
      || owner.processStartIdentity.length < 1
      || owner.processStartIdentity.length > 256
      || typeof owner.token !== 'string'
      || !/^[a-f0-9]{32}$/u.test(owner.token)
      || !Number.isSafeInteger(owner.acquiredAtEpochMs)
      || owner.acquiredAtEpochMs <= 0) return null
  return owner
}

function readLockOwner(lock) {
  const filename = path.join(lock, 'owner.json')
  try {
    const stat = fs.lstatSync(filename)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 4096) return null
    return lockOwner(JSON.parse(fs.readFileSync(filename, 'utf8')))
  } catch {
    return null
  }
}

function ownerProcessIsLive(owner) {
  try {
    process.kill(owner.pid, 0)
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    return true
  }
  const observedStartIdentity = linuxProcessStartIdentity(owner.pid)
  if (observedStartIdentity && owner.processStartIdentity.startsWith('linux:')) {
    return observedStartIdentity === owner.processStartIdentity
  }
  return true
}

function inspectExistingLock(lock, partialOwnerGraceMs, nowMs) {
  let stat
  try {
    stat = fs.lstatSync(lock)
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'absent' }
    throw error
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { state: 'protected' }
  const owner = readLockOwner(lock)
  if (owner) return ownerProcessIsLive(owner) ? { state: 'live', owner } : { state: 'stale', owner }
  const ageMs = Math.max(0, nowMs - stat.mtimeMs)
  if (ageMs < partialOwnerGraceMs) return { state: 'partial', ageMs }
  return { state: 'stale-partial', ageMs, identity: `${stat.dev}:${stat.ino}:${stat.mtimeMs}` }
}

function removeOwnedDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true })
}

function recoverStaleLock(paths, channel, lock, observed, partialOwnerGraceMs, nowMs) {
  const current = inspectExistingLock(lock, partialOwnerGraceMs, nowMs)
  if (current.state !== observed.state) return false
  if (current.state === 'stale' && current.owner.token !== observed.owner.token) return false
  if (current.state === 'stale-partial' && current.identity !== observed.identity) return false
  if (!['stale', 'stale-partial'].includes(current.state)) return false
  const quarantine = path.join(paths.locks, `.${channel}.stale-${process.pid}-${crypto.randomBytes(8).toString('hex')}`)
  try {
    fs.renameSync(lock, quarantine)
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error?.code)) return false
    throw error
  }
  try {
    removeOwnedDirectory(quarantine)
    fsyncDirectory(paths.locks)
  } catch (error) {
    throw productConfigError('publication_busy', 'Stale publication lock cleanup failed safely.', { statusCode: 409, details: error?.code })
  }
  return true
}

function createOwnedLock(paths, channel, lock, nowMs) {
  const token = crypto.randomBytes(16).toString('hex')
  const candidate = path.join(paths.locks, `.${channel}.candidate-${process.pid}-${token}`)
  fs.mkdirSync(candidate, { mode: 0o700 })
  const owner = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    pid: process.pid,
    processStartIdentity: PROCESS_START_IDENTITY,
    token,
    acquiredAtEpochMs: nowMs,
  }
  try {
    atomicReplace(path.join(candidate, 'owner.json'), Buffer.from(`${JSON.stringify(owner)}\n`, 'utf8'))
    fsyncDirectory(candidate)
    fs.renameSync(candidate, lock)
    fsyncDirectory(paths.locks)
    return {
      storeRoot: paths.root,
      channel,
      token,
      pid: owner.pid,
      processStartIdentity: owner.processStartIdentity,
    }
  } catch (error) {
    removeOwnedDirectory(candidate)
    if (fs.existsSync(lock) && ['EEXIST', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes(error?.code)) return null
    throw error
  }
}

export function acquirePublicationLock({
  storeRoot,
  channel,
  timeoutMs = 5000,
  partialOwnerGraceMs = DEFAULT_PARTIAL_OWNER_GRACE_MS,
  now = () => Date.now(),
}) {
  const selectedChannel = validateChannel(channel)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000
      || !Number.isSafeInteger(partialOwnerGraceMs) || partialOwnerGraceMs < 100 || partialOwnerGraceMs > 24 * 60 * 60 * 1000) {
    throw productConfigError('invalid_arguments', 'Publication lock timing is invalid.', { statusCode: 400 })
  }
  const paths = storePaths(storeRoot, { create: true })
  const lock = path.join(paths.locks, `${selectedChannel}.lock`)
  const deadline = Date.now() + timeoutMs
  while (true) {
    const nowMs = now()
    const handle = createOwnedLock(paths, selectedChannel, lock, nowMs)
    if (handle) return handle
    const observed = inspectExistingLock(lock, partialOwnerGraceMs, nowMs)
    if (['stale', 'stale-partial'].includes(observed.state)
        && recoverStaleLock(paths, selectedChannel, lock, observed, partialOwnerGraceMs, nowMs)) continue
    if (Date.now() >= deadline) throw productConfigError('publication_busy', 'Another publication is in progress.', { statusCode: 409 })
    Atomics.wait(WAIT_BUFFER, 0, 0, 25)
  }
}

export function releasePublicationLock(handle) {
  if (!handle || typeof handle !== 'object') throw productConfigError('lock_ownership_lost', 'Publication lock ownership was not retained.', { statusCode: 409 })
  const channel = validateChannel(handle.channel)
  const paths = storePaths(handle.storeRoot, { create: true })
  const lock = path.join(paths.locks, `${channel}.lock`)
  const owner = readLockOwner(lock)
  if (!owner
      || owner.token !== handle.token
      || owner.pid !== handle.pid
      || owner.processStartIdentity !== handle.processStartIdentity) {
    throw productConfigError('lock_ownership_lost', 'Publication lock ownership was not retained.', { statusCode: 409 })
  }
  const quarantine = path.join(paths.locks, `.${channel}.released-${process.pid}-${handle.token}`)
  try {
    fs.renameSync(lock, quarantine)
  } catch {
    throw productConfigError('lock_ownership_lost', 'Publication lock ownership was not retained.', { statusCode: 409 })
  }
  removeOwnedDirectory(quarantine)
  fsyncDirectory(paths.locks)
}

function withChannelLock(storeRoot, channel, operation) {
  const handle = acquirePublicationLock({ storeRoot, channel })
  try {
    return operation()
  } finally {
    releasePublicationLock(handle)
  }
}

export function publishConfig({ storeRoot, channel, expectedCurrent, bytes, iconAllowlist, now = () => Date.now() }) {
  const selectedChannel = validateChannel(channel)
  const expected = validateExpectedCurrent(expectedCurrent)
  const validated = validateProductConfigBytes(bytes, { iconAllowlist })
  const paths = storePaths(storeRoot, { create: true })
  return withChannelLock(storeRoot, selectedChannel, () => {
    const current = readPointer(paths, selectedChannel, { optional: true })
    const currentRevision = current?.revision || null
    if (currentRevision !== expected) throw productConfigError('expected_current_mismatch', 'Active revision changed before publication.', { statusCode: 409 })
    const immutable = writeImmutableRevision(paths.revisions, validated.config.revision, validated.bytes)
    writePointer(paths, selectedChannel, validated, now)
    return {
      status: 'PUBLISHED',
      channel: selectedChannel,
      revision: validated.config.revision,
      previousRevision: currentRevision,
      revisionCreated: immutable.created,
      sha256: validated.sha256,
      bytes: validated.bytes.length,
    }
  })
}

export function rollbackConfig({ storeRoot, channel, expectedCurrent, revision, iconAllowlist, now = () => Date.now() }) {
  const selectedChannel = validateChannel(channel)
  const expected = validateExpectedCurrent(expectedCurrent)
  const targetRevision = validateRevision(revision)
  const paths = storePaths(storeRoot, { create: true })
  return withChannelLock(storeRoot, selectedChannel, () => {
    const current = readPointer(paths, selectedChannel, { optional: true })
    const currentRevision = current?.revision || null
    if (currentRevision !== expected) throw productConfigError('expected_current_mismatch', 'Active revision changed before rollback.', { statusCode: 409 })
    const validated = readStoredRevision(paths, targetRevision, iconAllowlist)
    writePointer(paths, selectedChannel, validated, now)
    return {
      status: 'ROLLED_BACK',
      channel: selectedChannel,
      revision: targetRevision,
      previousRevision: currentRevision,
      sha256: validated.sha256,
      bytes: validated.bytes.length,
    }
  })
}

export function readActivePublication({ storeRoot, channel, iconAllowlist }) {
  const selectedChannel = validateChannel(channel)
  const paths = storePaths(storeRoot)
  const pointer = readPointer(paths, selectedChannel)
  const validated = readStoredRevision(paths, pointer.revision, iconAllowlist)
  if (validated.sha256 !== pointer.sha256) throw productConfigError('config_corrupt', 'Active configuration failed integrity checks.', { statusCode: 503 })
  return { ...validated, pointer, channel: selectedChannel }
}

export function readChannelRevisions({ storeRoot, iconAllowlist }) {
  const result = {}
  for (const channel of CHANNELS) {
    try {
      result[channel] = readActivePublication({ storeRoot, channel, iconAllowlist }).config.revision
    } catch (error) {
      if (error?.code === 'config_unavailable') result[channel] = null
      else throw error
    }
  }
  return result
}
