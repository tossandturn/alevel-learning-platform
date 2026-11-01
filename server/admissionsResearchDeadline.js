export async function boundedAdmissionsOperation(operation, { timeoutMs = 8_000, deadlineAt = Infinity, code = 'ADMISSIONS_RESEARCH_TIMEOUT' } = {}) {
  const remaining = Math.min(timeoutMs, deadlineAt - Date.now())
  if (!(remaining > 0)) throw Object.assign(new Error('Public research deadline exceeded.'), { code })
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(Object.assign(new Error('Public research deadline exceeded.'), { code }))
    }, remaining)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout])
  } finally {
    clearTimeout(timer)
  }
}
