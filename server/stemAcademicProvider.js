import os from 'node:os'
import path from 'node:path'
import {readPrivateProviderText} from './tavernProvider.js'

export const DEFAULT_ACADEMIC_PROVIDER_SETTINGS = path.join(os.homedir(), '.config', 'stemist', 'academic-provider.json')
const credential = value => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length >= 8 && text.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(text) ? text : ''
}
const descriptor = (apiKey, effort = 'low') => ({
  name: 'deepseek',
  label: 'DeepSeek',
  protocol: 'chat-completions',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  imageMode: 'data-url',
  publicBaseUrl: '',
  thinkingMode: 'enabled',
  reasoningEffort: effort,
  apiKey,
})

// Opt-in only for student-facing STEM APIs. Generic/background providerConfig
// and the separate IELTS service never call this loader.
export function loadStemAcademicProvider({env = process.env, settingsPath = env.STEM_ACADEMIC_PROVIDER_SETTINGS || DEFAULT_ACADEMIC_PROVIDER_SETTINGS} = {}) {
  const explicit = String(env.STEM_ACADEMIC_PROVIDER || '').trim().toLowerCase()
  if (explicit === 'legacy') return null
  if (explicit) {
    const effort = String(env.STEM_ACADEMIC_REASONING_EFFORT || 'low')
    return explicit === 'deepseek' && ['low', 'high'].includes(effort)
      ? descriptor(credential(env.STEM_ACADEMIC_DEEPSEEK_API_KEY), effort)
      : descriptor('')
  }
  try {
    let raw
    try { raw = readPrivateProviderText(settingsPath, 16 * 1024) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    const value = JSON.parse(raw)
    if (!value || Array.isArray(value) || value.schemaVersion !== 'stem-academic-provider.v1') return descriptor('')
    if (value.enabled === false) return null
    if (value.provider !== 'deepseek' || value.model !== 'deepseek-flash' || value.apiKeyFile !== 'deepseek.key' || !['low', 'high'].includes(value.reasoningEffort)) return descriptor('')
    return descriptor(credential(readPrivateProviderText(path.join(path.dirname(path.resolve(settingsPath)), 'deepseek.key'), 512)), value.reasoningEffort)
  } catch {
    return descriptor('')
  }
}
