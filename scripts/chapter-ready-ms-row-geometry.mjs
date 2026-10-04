import assert from 'node:assert/strict'

export function locateMcqRow(words, questionNumber, expectedAnswer) {
  assert.ok(Number.isInteger(questionNumber) && questionNumber > 0)
  assert.match(expectedAnswer, /^[A-D]$/)
  const centerY = (entry) => (entry.bbox[1] + entry.bbox[3]) / 2
  const numbered = words.entries.filter((entry) => /^\d+$/.test(entry.text)
    && entry.bbox[0] < 0.25 && entry.bbox[1] > 0.08 && entry.bbox[3] < 0.94)
  const matches = (number) => numbered.filter((entry) => entry.text === String(number))
  function row(number) {
    const entries = matches(number)
    assert.equal(entries.length, 1, `Expected unique MS question row ${number}`)
    return entries[0]
  }
  const target = row(questionNumber)
  const next = matches(questionNumber + 1)
  assert.ok(next.length <= 1, 'Ambiguous next question row')
  let step
  let spacingSource
  if (next.length === 1) {
    step = centerY(next[0]) - centerY(target)
    spacingSource = 'next-row'
  } else {
    assert.equal(questionNumber, Math.max(...numbered.map((entry) => Number(entry.text))), 'Missing interior row is not terminal')
    const previous = row(questionNumber - 1)
    const previous2 = row(questionNumber - 2)
    step = centerY(target) - centerY(previous)
    assert.ok(Math.abs(step - (centerY(previous) - centerY(previous2))) < 0.001)
    spacingSource = 'previous-rows-verified-terminal'
  }
  assert.ok(step > 0.01 && step < 0.05)
  const sameRow = words.entries.filter((entry) => Math.abs(centerY(entry) - centerY(target)) < step * 0.25)
  const answer = sameRow.filter((entry) => /^[A-D]$/.test(entry.text))
  const marks = sameRow.filter((entry) => entry.text === '1' && entry.bbox[0] > 0.8)
  assert.equal(answer.length, 1)
  assert.equal(answer[0].text, expectedAnswer)
  assert.equal(marks.length, 1)
  return { center: centerY(target), step, answer: answer[0].text, marks: 1, spacingSource }
}
