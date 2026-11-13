export function buildChapterFoundationSpecs(rows) {
  return Object.freeze(Object.fromEntries(rows.map((row) => {
    const [id, truth, misconceptions, prompt, correct, distractors, explanation] = row
    if (!id || !truth || misconceptions?.length !== 3 || !prompt || !correct || distractors?.length !== 3) {
      throw new Error(`Invalid expanded chapter foundation specification: ${id || 'missing-id'}`)
    }
    return [id, Object.freeze({
      truth,
      misconceptions: Object.freeze([...misconceptions]),
      application: Object.freeze({
        prompt,
        correct,
        distractors: Object.freeze([...distractors]),
        explanation: explanation || `${correct} ${truth}`,
      }),
    })]
  })))
}
