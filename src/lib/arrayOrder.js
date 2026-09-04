export function stableSorted(values = [], compareFn) {
  const items = Array.isArray(values) ? values : []
  return [...items].sort(compareFn)
}
