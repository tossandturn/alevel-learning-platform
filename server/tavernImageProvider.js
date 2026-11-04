import os from 'node:os'
import path from 'node:path'
import { readPrivateProviderText } from './tavernProvider.js'

export const DEFAULT_TAVERN_IMAGE_SETTINGS = path.join(os.homedir(), '.config', 'stemist', 'tavern-image-provider.json')
const MODELS = new Set(['qwen-image-3.0', 'qwen-image-3.0-pro', 'qwen-image-2.1-turbo', 'qwen-image-2.1-pro'])
const error = (code, message) => Object.assign(new Error(message), { statusCode: 503, code })
export function loadTavernImageConfiguration({ env = process.env, settingsPath = env.TAVERN_IMAGE_PROVIDER_SETTINGS || DEFAULT_TAVERN_IMAGE_SETTINGS } = {}) {
 let apiKey, base, model, source
 if (env.TAVERN_IMAGE_API_KEY || env.TAVERN_IMAGE_BASE_URL) {
  apiKey = env.TAVERN_IMAGE_API_KEY; base = env.TAVERN_IMAGE_BASE_URL; model = env.TAVERN_IMAGE_MODEL; source = 'dedicated-env'
 } else {
  let settings
  try { settings = JSON.parse(readPrivateProviderText(settingsPath, 16384)) }
  catch (cause) { if (cause.code !== 'ENOENT') throw error('tavern_image_config_invalid', '实时绘图配置暂不可用。') }
  if (settings) {
   if (settings.schemaVersion !== 'stem-tavern-image-provider.v1' || settings.enabled !== true || typeof settings.apiKeyFile !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\.key$/.test(settings.apiKeyFile)) throw error('tavern_image_config_invalid', '实时绘图配置暂不可用。')
   try { apiKey = readPrivateProviderText(path.join(path.dirname(path.resolve(settingsPath)), settings.apiKeyFile), 512) }
   catch { throw error('tavern_image_not_configured', '实时绘图服务暂未配置；文字回复已保留。') }
   base = settings.baseUrl; model = settings.model; source = 'dedicated-private'
  } else {
   apiKey = env.DASHSCOPE_API_KEY; base = env.DASHSCOPE_COMPAT_BASE_URL; model = env.TAVERN_IMAGE_MODEL; source = 'regional-env'
  }
 }
 apiKey = String(apiKey || '').trim()
 base = String(base || '').trim().replace(/\/+$/, '')
 model = String(model || 'qwen-image-3.0').trim()
 if (!apiKey || !base) throw error('tavern_image_not_configured', '实时绘图服务暂未配置；文字回复已保留。')
 if (apiKey.length < 8 || apiKey.length > 512 || /[\s\u0000-\u001f\u007f]/.test(apiKey)) throw error('tavern_image_config_invalid', '实时绘图配置暂不可用。')
 let url
 try { url = new URL(base) } catch { throw error('tavern_image_config_invalid', '实时绘图配置暂不可用。') }
 const singapore = url.hostname === 'dashscope-intl.aliyuncs.com' || /^[a-z0-9][a-z0-9-]*\.ap-southeast-1\.maas\.aliyuncs\.com$/i.test(url.hostname)
 if (url.protocol !== 'https:' || !singapore || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/compatible-mode/v1') throw error('tavern_image_config_invalid', '实时绘图仅接受新加坡百炼图像 API 配置。')
 if (!MODELS.has(model)) throw error('tavern_image_model_invalid', '实时绘图模型配置无效。')
 return { apiKey, base, model, source }
}
