export async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items || [])
  if (!values.length) return []

  const limit = Math.max(1, Math.floor(Number(concurrency) || 1))
  const results = new Array(values.length)
  let cursor = 0

  async function runWorker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => runWorker()))
  return results
}
