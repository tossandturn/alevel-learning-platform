import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildCoachHelpRequest,
  coachHelpDisplayMessage,
  coachHelpPolicy,
  coachResponseOutcome,
  COACH_HELP_INTENTS,
} from '../src/lib/coachHelpIntent.js'

const source = fs.readFileSync(new URL('../src/components/AiCoach.jsx', import.meta.url), 'utf8')

assert.match(source, /helpIntent/, 'Coach requests must send an explicit optional helpIntent')
assert.match(source, /COACH_HELP_INTENTS\.WORKED_SOLUTION/, 'the web Coach must expose a worked-solution action')
assert.match(source, /COACH_HELP_INTENTS\.CHECK_WORK/, 'the web Coach must expose a check-work action')
assert.match(source, /Full answer/, 'the worked-solution action needs a visible accessible label')
assert.match(source, /onClick=\{\(\) => ask\(draft, 5, \{ helpIntent: COACH_HELP_INTENTS\.WORKED_SOLUTION \}\)\}/, 'the Full answer action must include the current typed draft')
assert.match(source, /body:\s*JSON\.stringify\(\{[\s\S]{0,180}message:\s*requestMessage/, 'provider payload must receive the complete intent instruction, not the short display bubble')
assert.match(source, /if \(outcome\.retryable\) \{[\s\S]{0,500}setDraft\(clean\)/, 'retryable terminal results must restore the original typed draft')
assert.doesNotMatch(source, /clearAttachmentsOnSuccess/, 'successful hint responses must retain the focused photo for full-answer follow-up')
assert.doesNotMatch(
  source,
  /Analyze this photographed question[^']*next step without inventing missing text/,
  'photo-only learning requests must not default to hint-only wording',
)

const photoDefault = buildCoachHelpRequest({ hasAttachments: true, context: { product: 'STEM Studio' } })
assert.equal(photoDefault.helpIntent, COACH_HELP_INTENTS.WORKED_SOLUTION)
assert.equal(photoDefault.hintLevel, 5)
assert.match(photoDefault.message, /complete worked solution/i)
assert.match(photoDefault.message, /final result/i)
assert.equal(coachHelpDisplayMessage(photoDefault.helpIntent), '请完整解答这道题')
assert.equal(coachHelpDisplayMessage('hint'), '请给我提示')
assert.equal(coachHelpDisplayMessage('check-work'), '请检查我的作答')
assert.equal(coachHelpDisplayMessage('worked-solution', '不要答案，只给我提示'), '不要答案，只给我提示')
for (const naturalMessage of ['检查第二步', '不要答案，只给我提示']) {
  const natural = buildCoachHelpRequest({ message: naturalMessage, hasAttachments: true, context: { product: 'STEM Studio' } })
  assert.equal(natural.helpIntent, '', 'typed photo requests must remain natural-language intent unless an action was explicitly chosen')
  assert.equal(natural.message, naturalMessage)
}

const hint = buildCoachHelpRequest({ helpIntent: 'hint', message: 'Help with Q4', context: { product: 'STEM Studio' } })
assert.equal(hint.helpIntent, 'hint')
assert.match(hint.message, /guidance only/i)
assert.match(hint.message, /Do not reveal the final answer/i)

const check = buildCoachHelpRequest({ helpIntent: 'check-work', context: { product: 'STEM Studio' }, hasAttachments: true })
assert.match(check.message, /first wrong or unsupported step/i)
assert.match(check.message, /corrected method/i)
const typedSolution = buildCoachHelpRequest({ helpIntent: 'worked-solution', message: 'Solve 3x + 2 = 17', context: { product: 'STEM Studio' } })
assert.match(typedSolution.message, /^Solve 3x \+ 2 = 17/)
assert.match(typedSolution.message, /complete worked solution/i)
assert.equal(coachHelpDisplayMessage(typedSolution.helpIntent, 'Solve 3x + 2 = 17'), 'Solve 3x + 2 = 17')

const writing = buildCoachHelpRequest({ helpIntent: 'worked-solution', context: { product: 'IELTSist', skill: 'writing' }, hasAttachments: true })
assert.match(writing.message, /all four scoring criteria/i)
assert.match(writing.message, /model passage/i)
assert.doesNotMatch(writing.message, /unit check/i)

const reading = buildCoachHelpRequest({ helpIntent: 'worked-solution', context: { product: 'IELTSist', skill: 'reading' } })
assert.match(reading.message, /passage evidence/i)
assert.match(reading.message, /correct answer/i)

const examContext = { attemptId: 'attempt-1', paperStudyMode: 'exam-simulation', submitted: false }
assert.equal(coachHelpPolicy(examContext).solutionDisabled, true)
const blockedSolution = buildCoachHelpRequest({ helpIntent: 'worked-solution', context: examContext, hasAttachments: true })
assert.equal(blockedSolution.helpIntent, 'hint')
assert.match(blockedSolution.message, /Do not reveal the final answer/i)
assert.equal(coachHelpPolicy({ paperStudyMode: 'exam-simulation' }).solutionDisabled, false, 'UI must not invent a bound exam without an attempt; backend remains authoritative')

const offlinePhoto = coachResponseOutcome({ mode: 'offline', providerStatus: 'error', answer: 'Use SI units.' }, '', { hasAttachments: true, helpIntent: 'worked-solution' })
assert.equal(offlinePhoto.completed, false)
assert.equal(offlinePhoto.status, 'failed')
assert.doesNotMatch(offlinePhoto.content, /SI units/i)
assert.match(offlinePhoto.content, /photo.*still attached/i)
const empty = coachResponseOutcome({ mode: 'ai', providerStatus: 'connected', answer: '' })
assert.equal(empty.completed, false)
assert.equal(empty.retryable, true)
assert.equal(coachResponseOutcome({ mode: 'ai', providerStatus: 'connected', answer: 'Complete result.' }).completed, true)
assert.equal(coachResponseOutcome({ mode: 'ai', providerStatus: 'unknown', answer: 'Untrusted result.' }).completed, false)
assert.equal(coachResponseOutcome({ mode: 'local', providerStatus: 'skipped', answer: 'One hint.' }, '', { helpIntent: 'hint' }).completed, true)
assert.equal(coachResponseOutcome({ mode: 'local', providerStatus: 'skipped', answer: 'Generic solution.' }, '', { helpIntent: 'worked-solution' }).completed, false)

console.log('Web Coach help-intent source contract passed.')
