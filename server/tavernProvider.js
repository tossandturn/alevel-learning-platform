import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_TAVERN_PROVIDER_SETTINGS = path.join(os.homedir(), '.config', 'stemist', 'tavern-provider.json')
const descriptor = apiKey => ({
  name: 'deepseek',
  label: 'DeepSeek',
  protocol: 'chat-completions',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  apiKey,
})

export function isPrivateRegularFile(stat, { platform = process.platform, uid = process.getuid?.(), maxBytes } = {}) {
  return stat.isFile() && !stat.isSymbolicLink?.() && stat.nlink === 1
    && stat.size > 0 && stat.size <= maxBytes
    && (platform === 'win32' || ((stat.mode & 0o077) === 0 && stat.uid === uid))
}

function privateText(file, maxBytes) {
  const before = fs.lstatSync(file)
  if (!isPrivateRegularFile(before, { maxBytes })) throw new Error('Invalid private configuration file')
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const opened = fs.fstatSync(fd)
    if (opened.ino !== before.ino || opened.dev !== before.dev || !isPrivateRegularFile(opened, { maxBytes })) throw new Error('Private configuration changed')
    const bytes = Buffer.alloc(maxBytes + 1)
    const count = fs.readSync(fd, bytes, 0, bytes.length, 0)
    if (count > maxBytes) throw new Error('Private configuration exceeds its bound')
    return bytes.subarray(0, count).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function credential(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length >= 8 && text.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(text) ? text : ''
}

// This configuration belongs only to recreational Tavern, never to academic
// Coach, image analysis, PDF marking or IELTS. An explicit broken configuration
// fails closed instead of silently forwarding private chat to another provider.
export function loadTavernProvider({ env = process.env, settingsPath = env.STEM_TAVERN_PROVIDER_SETTINGS || DEFAULT_TAVERN_PROVIDER_SETTINGS } = {}) {
  const explicit = String(env.STEM_TAVERN_PROVIDER || '').trim().toLowerCase()
  if (explicit === 'legacy') return null
  if (explicit) {
    if (explicit !== 'deepseek') return descriptor('')
    return descriptor(credential(env.STEM_TAVERN_DEEPSEEK_API_KEY))
  }
  try {
    let raw
    try { raw = privateText(settingsPath, 16 * 1024) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    const settings = JSON.parse(raw)
    if (!settings || Array.isArray(settings) || settings.schemaVersion !== 'stem-tavern-provider.v1') return descriptor('')
    if (settings.enabled === false) return null
    if (settings.provider !== 'deepseek' || settings.model !== 'deepseek-flash' || settings.apiKeyFile !== 'deepseek.key') return descriptor('')
    const file = path.join(path.dirname(path.resolve(settingsPath)), 'deepseek.key')
    return descriptor(credential(privateText(file, 512)))
  } catch {
    return descriptor('')
  }
}
