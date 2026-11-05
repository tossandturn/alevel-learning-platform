import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { buildNativeProductConfig } from '../server/nativeProductConfig.js'

const allowed = new Set(['input', 'output', 'schema', 'icons', 'revision', 'published-at'])
const options = Object.create(null)
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, '')
  if (!process.argv[i]?.startsWith('--') || !allowed.has(key) || Object.hasOwn(options, key) || !process.argv[i + 1]) throw Error('Invalid publication arguments')
  options[key] = process.argv[i + 1]
}
for (const key of ['input','output','schema','icons','revision']) if (!options[key]) throw Error(`Missing --${key}`)
for (const key of ['input','output','schema','icons']) if (!path.isAbsolute(options[key])) throw Error(`--${key} requires an absolute local path`)
function boundedFile(file, max) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > max) throw Error('Invalid or oversized publication input')
  return fs.readFileSync(file)
}
if (fs.existsSync(options.output)) throw Error('Output already exists; retain immutable publication artifacts')
const original = boundedFile(options.input, 128 * 1024)
const icons = JSON.parse(boundedFile(options.icons, 16 * 1024))
if (!Array.isArray(icons) || icons.some(x => typeof x !== 'string')) throw Error('Invalid packaged icon list')
// Explicit trusted local source only; never accept a URL or fetch remote code.
boundedFile(options.schema, 128 * 1024)
const { validateProductConfigBytes } = await import(pathToFileURL(options.schema))
if (typeof validateProductConfigBytes !== 'function') throw Error('Unsupported publication schema module')
const iconAllowlist = new Set(icons)
const base = validateProductConfigBytes(original, { iconAllowlist }).config
const validate = (value, settings) => validateProductConfigBytes(Buffer.from(JSON.stringify(value), 'utf8'), settings)
const config = buildNativeProductConfig({ base, revision: options.revision, publishedAt: options['published-at'] || new Date().toISOString(), iconAllowlist, validate })
const bytes = Buffer.from(JSON.stringify(config) + '\n', 'utf8')
validateProductConfigBytes(bytes, { iconAllowlist })
fs.writeFileSync(options.output, bytes, { flag: 'wx', mode: 0o600 })
const hash = b => crypto.createHash('sha256').update(b).digest('hex')
console.log(JSON.stringify({ status: 'PREPARED_NOT_PUBLISHED', revision: config.revision, baseRevision: base.revision, baseSha256: hash(original), sha256: hash(bytes), bytes: bytes.length, personas: config.tavern.presets.length }))
