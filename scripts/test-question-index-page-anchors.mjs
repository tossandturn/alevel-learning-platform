import assert from 'node:assert/strict'

import { questionNumberFromPageText } from './question-index-page-anchors.mjs'

assert.equal(
  questionNumberFromPageText('4\n1 (a) Explain why the gravitational potential is negative.'),
  '1',
)
assert.equal(
  questionNumberFromPageText('5\nUCLES 2024 [Turn over]\n(i) Show that the mass of the planet is ...'),
  null,
  'a continuation page with only subparts must not look like a new main question',
)
assert.equal(
  questionNumberFromPageText('8\nUCLES 2024\n3 A small object is attached to an oscillator.'),
  '3',
  'an A2 question whose first prompt has no (a) label still needs a deterministic page anchor',
)
assert.equal(questionNumberFromPageText('1 PHYSICS 9702/42 Paper 4 A Level Structured Questions'), undefined)
assert.equal(
  questionNumberFromPageText('12\n5 (a) First question.\n6 (a) Second question.'),
  undefined,
  'a page containing two main question starts must remain ambiguous',
)
assert.equal(questionNumberFromPageText('17 9702/42/F/M/24 UCLES 2024 BLANK PAGE'), null)
assert.equal(
  questionNumberFromPageText('9\n(b) The current is 2 A flowing through the resistor.'),
  null,
  'a current value followed by the unit A must not be mistaken for a main question number',
)
assert.equal(questionNumberFromPageText(''), undefined)

console.log(JSON.stringify({ status: 'passed', cases: 7 }))
