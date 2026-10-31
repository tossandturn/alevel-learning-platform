import os from 'node:os'
import path from 'node:path'
import {readPrivateProviderText} from './tavernProvider.js'

export const DEFAULT_ACADEMIC_PROVIDER_SETTINGS = path.join(os.homedir(), '.config', 'stemist', 'academic-provider.json')
const OFFICIAL_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
const OFFICIAL_DEEPSEEK_MODEL = 'deepseek-flash'
const BAILIAN_DEEPSEEK_MODEL = 'deepseek-v4.1-flash'
const REASONING_EFFORTS = new Set(['low', 'high', 'max'])
const credential = value => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length >= 8 && text.length <= 512 && !/[\s\u0000-\u001f\u007f]/.test(text) ? text : ''
}
const descriptor = (apiKey, effort = 'low') => ({
  name: 'deepseek',
  label: 'DeepSeek',
  protocol: 'chat-completions',
  baseUrl: OFFICIAL_DEEPSEEK_BASE_URL,
  model: OFFICIAL_DEEPSEEK_MODEL,
  imageMode: 'data-url',
  publicBaseUrl: '',
  thinkingMode: 'enabled',
  reasoningEffort: effort,
  apiKey,
})
const bailianDescriptor = (apiKey, baseUrl, effort = 'low') => ({
  name: 'deepseek',
  label: 'DeepSeek via Alibaba Cloud Bailian',
  protocol: 'chat-completions',
  baseUrl,
  model: BAILIAN_DEEPSEEK_MODEL,
  imageMode: 'data-url',
  publicBaseUrl: '',
  thinkingMode: 'enabled',
  thinkingProtocol: 'enable-thinking',
  reasoningEffort: effort,
  apiKey,
})

function bailianSingaporeBaseUrl(value) {
  const source = typeof value === 'string' ? value.trim() : ''
  if (!source || /[\r\n]/.test(source)) return ''
  try {
    const url = new URL(source)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return ''
    if (!/^[a-z0-9][a-z0-9-]{0,62}\.ap-southeast-1\.maas\.aliyuncs\.com$/.test(hostname)) return ''
    if (url.pathname !== '/compatible-mode/v1') return ''
    const normalized = `https://${hostname}/compatible-mode/v1`
    return source === normalized ? normalized : ''
  } catch {
    return ''
  }
}

function privateCredentialFile(value) {
  const file = typeof value === 'string' ? value.trim() : ''
  if (!file || file.length > 96 || path.basename(file) !== file || /[\\/]/.test(file)) return ''
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.key$/.test(file) ? file : ''
}

// Opt-in only for student-facing STEM APIs. Generic/background providerConfig
// and the separate IELTS service never call this loader.
export function loadStemAcademicProvider({env = process.env, settingsPath = env.STEM_ACADEMIC_PROVIDER_SETTINGS || DEFAULT_ACADEMIC_PROVIDER_SETTINGS} = {}) {
  const explicit = String(env.STEM_ACADEMIC_PROVIDER || '').trim().toLowerCase()
  if (explicit === 'legacy') return null
  if (explicit) {
    const effort = String(env.STEM_ACADEMIC_REASONING_EFFORT || 'low')
    return explicit === 'deepseek' && REASONING_EFFORTS.has(effort)
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
    if (value.provider !== 'deepseek' || !REASONING_EFFORTS.has(value.reasoningEffort)) return descriptor('')
    if (value.model === OFFICIAL_DEEPSEEK_MODEL) {
      if (value.baseUrl !== undefined || value.apiKeyFile !== 'deepseek.key') return descriptor('')
      return descriptor(credential(readPrivateProviderText(path.join(path.dirname(path.resolve(settingsPath)), 'deepseek.key'), 512)), value.reasoningEffort)
    }
    if (value.model === BAILIAN_DEEPSEEK_MODEL) {
      const baseUrl = bailianSingaporeBaseUrl(value.baseUrl)
      const apiKeyFile = privateCredentialFile(value.apiKeyFile)
      if (!baseUrl || !apiKeyFile) return bailianDescriptor('', baseUrl, value.reasoningEffort)
      const apiKeyPath = path.join(path.dirname(path.resolve(settingsPath)), apiKeyFile)
      return bailianDescriptor(credential(readPrivateProviderText(apiKeyPath, 512)), baseUrl, value.reasoningEffort)
    }
    return descriptor('')
  } catch {
    return descriptor('')
  }
}
