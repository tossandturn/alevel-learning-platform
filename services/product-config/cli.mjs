import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { productConfigError, publicError } from './errors.mjs'

const ICON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function parseLongArguments(argv, { required = [], optional = [] } = {}) {
  const allowed = new Set([...required, ...optional])
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || key.includes('=') || value === undefined || value.startsWith('--')) {
      throw productConfigError('invalid_arguments', 'Command arguments are invalid.', { statusCode: 400 })
    }
    const name = key.slice(2)
    if (!allowed.has(name) || values.has(name)) {
      throw productConfigError('invalid_arguments', 'Command arguments are invalid.', { statusCode: 400 })
    }
    values.set(name, value)
  }
  for (const name of required) {
    if (!values.has(name)) throw productConfigError('invalid_arguments', 'A required command argument is missing.', { statusCode: 400 })
  }
  return Object.fromEntries(values)
}

export function regularInputFile(filename, { maxBytes }) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || !fs.existsSync(filename)) {
    throw productConfigError('input_file_invalid', 'Input file is unavailable.', { statusCode: 400 })
  }
  const stat = fs.lstatSync(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maxBytes) {
    throw productConfigError('input_file_invalid', 'Input file failed safety checks.', { statusCode: 400 })
  }
  return filename
}

export function loadIconAllowlist(filename) {
  const input = regularInputFile(filename, { maxBytes: 16 * 1024 })
  let values
  try {
    values = JSON.parse(fs.readFileSync(input, 'utf8'))
  } catch {
    throw productConfigError('icon_allowlist_invalid', 'Packaged icon allowlist is invalid.', { statusCode: 400 })
  }
  if (!Array.isArray(values) || values.length < 1 || values.length > 64) {
    throw productConfigError('icon_allowlist_invalid', 'Packaged icon allowlist is invalid.', { statusCode: 400 })
  }
  const result = new Set()
  for (const value of values) {
    if (typeof value !== 'string' || !ICON_PATTERN.test(value) || value.includes('/') || value.includes('\\') || result.has(value)) {
      throw productConfigError('icon_allowlist_invalid', 'Packaged icon allowlist is invalid.', { statusCode: 400 })
    }
    result.add(value)
  }
  return result
}

export function expectedCurrentValue(value) {
  return value === 'none' ? null : value
}

export function isMain(metaUrl) {
  if (!process.argv[1] || typeof metaUrl !== 'string') return false
  try {
    const metaPath = fs.realpathSync.native(fileURLToPath(metaUrl))
    const argvPath = fs.realpathSync.native(path.resolve(process.argv[1]))
    return process.platform === 'win32'
      ? metaPath.toLowerCase() === argvPath.toLowerCase()
      : metaPath === argvPath
  } catch {
    return false
  }
}

export async function runCli(operation) {
  try {
    const result = await operation()
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    const failure = publicError(error)
    process.stderr.write(`${JSON.stringify(failure.body)}\n`)
    process.exitCode = 1
  }
}
