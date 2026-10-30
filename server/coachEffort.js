const LEVELS = new Set(['low', 'high', 'max'])
export function coachEffort(value) {
  if (value === undefined) return null
  if (!LEVELS.has(value)) throw Object.assign(new Error('请选择有效的思考强度。'), {statusCode:400, code:'coach_effort_invalid'})
  return value
}
export function withCoachEffort(provider, effort) {
  if (effort === null) return provider
  coachEffort(effort)
  if (provider?.name !== 'deepseek' || !['deepseek-flash','deepseek-v4-flash','deepseek-v4-pro'].includes(provider.model)) {
    throw Object.assign(new Error('当前服务暂不支持所选思考强度，请稍后重试。'), {statusCode:503, code:'coach_effort_unsupported'})
  }
  const {fallback,...configured}=provider
  return {...configured, thinkingMode:'enabled', reasoningEffort:effort, studentEffort:effort}
}
export function coachEffortBudget(effort, legacy) {
  if (effort === null || effort === 'low') return legacy
  coachEffort(effort)
  return effort === 'high'
    ? {providerTimeoutMs:85000, totalDeadlineMs:90000, maxTimeoutMs:90000}
    : {providerTimeoutMs:110000, totalDeadlineMs:115000, maxTimeoutMs:120000}
}
export function coachEffortOutputLimit(effort, legacy) {
  if (effort === null) return legacy
  coachEffort(effort)
  return {low:8192, high:16384, max:32768}[effort]
}
