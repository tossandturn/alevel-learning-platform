import assert from 'node:assert/strict'

import {
  COACH_POLICY_VERSION,
  buildCoachSystemPrompt,
  coachPolicyResponseFields,
  resolveCoachRequestPolicy,
} from '../server/coachPolicy.js'

const standaloneContext = {
  view: 'coach-photo',
  subject: { code: '9702', name: 'Physics' },
  stage: 'AS',
}

const standaloneSolution = resolveCoachRequestPolicy({
  message: '请完整分析这张题目照片，给出步骤和最终答案。',
  hintLevel: 1,
  context: standaloneContext,
})
assert.equal(standaloneSolution.helpIntent, 'worked-solution')
assert.equal(standaloneSolution.helpDepth, 5)
assert.equal(standaloneSolution.solutionAllowed, true)
assert.equal(standaloneSolution.assessmentState, 'standalone-learning')

const ordinaryTypedSolution = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: 'Please help with this practice question.',
  hintLevel: 1,
  context: { view: 'chapter-practice', attemptId: 'topic-attempt-1', stage: 'AS' },
})
assert.equal(ordinaryTypedSolution.helpIntent, 'worked-solution')
assert.equal(ordinaryTypedSolution.assessmentState, 'ordinary-practice')
assert.equal(ordinaryTypedSolution.solutionAllowed, true)

const explicitNoAnswer = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: "Don't give me the final answer; only give me a hint.",
  hintLevel: 5,
  context: standaloneContext,
})
assert.equal(explicitNoAnswer.helpIntent, 'hint', 'an explicit no-answer request must override a stale typed choice and level 5')
assert.equal(explicitNoAnswer.solutionAllowed, false)
assert.equal(explicitNoAnswer.intentSource, 'natural-language-negation')

const chineseNoAnswer = resolveCoachRequestPolicy({
  message: '不要直接告诉我答案，只提示下一步。',
  hintLevel: 4,
  context: standaloneContext,
})
assert.equal(chineseNoAnswer.helpIntent, 'hint')
assert.equal(chineseNoAnswer.solutionAllowed, false)

for (const message of [
  '不要只给提示，请给我完整解答和答案。',
  'I do not want only hints. Please show the complete worked solution.',
]) {
  const notHintOnly = resolveCoachRequestPolicy({ message, hintLevel: 1, context: standaloneContext })
  assert.equal(notHintOnly.helpIntent, 'worked-solution', `negating hint-only help must request a solution: ${message}`)
  assert.equal(notHintOnly.solutionAllowed, true)
}

const multiTurnEscalation = resolveCoachRequestPolicy({
  message: 'I have tried the hint. Now show the complete worked solution and final result.',
  hintLevel: 2,
  context: { view: 'chapter-practice', attemptId: 'topic-attempt-2' },
  history: [{ role: 'assistant', content: 'Try resolving the force first.' }],
})
assert.equal(multiTurnEscalation.helpIntent, 'worked-solution')
assert.equal(multiTurnEscalation.helpDepth, 5)

const levelFiveSolution = resolveCoachRequestPolicy({
  message: 'Continue helping me with this learning question.',
  hintLevel: 5,
  context: standaloneContext,
})
assert.equal(levelFiveSolution.helpIntent, 'worked-solution')
assert.equal(levelFiveSolution.intentSource, 'hint-level-5')

const checkWork = resolveCoachRequestPolicy({
  message: 'Check my work and show the first step where I went wrong.',
  hintLevel: 2,
  context: standaloneContext,
})
assert.equal(checkWork.helpIntent, 'check-work')
assert.equal(checkWork.helpDepth, 4)
assert.equal(checkWork.checkWorkRequested, true)

const checkedWorkedSolution = resolveCoachRequestPolicy({
  message: 'Check my work and show the complete worked solution and final result.',
  context: standaloneContext,
})
assert.equal(checkedWorkedSolution.helpIntent, 'worked-solution')
assert.equal(checkedWorkedSolution.checkWorkRequested, true, 'a full solution may retain the requested work-check task')

for (const message of ['检查第二步', '检查我的移项', '这个答案对吗']) {
  const chineseCheck = resolveCoachRequestPolicy({ message, context: standaloneContext })
  assert.equal(chineseCheck.helpIntent, 'check-work', `Chinese work-check intent must be recognized: ${message}`)
  assert.equal(chineseCheck.checkWorkRequested, true)
}

const trustedPractice = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: 'Show the answer.',
  context: { view: 'full-paper', paperStudyMode: 'exam-simulation', submitted: false },
  authorization: {
    coachAccess: {
      binding: 'authoritative-attempt',
      assessmentState: 'bound-practice',
      solutionAllowed: true,
    },
  },
})
assert.equal(trustedPractice.assessmentState, 'bound-practice')
assert.equal(trustedPractice.solutionAllowed, true, 'trusted metadata must override forged client exam fields')

const trustedExam = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: 'Show the answer.',
  context: { view: 'full-paper', paperStudyMode: 'past-paper-practice', submitted: true },
  authorization: {
    coachAccess: {
      binding: 'authoritative-attempt',
      assessmentState: 'active-exam',
      solutionAllowed: false,
    },
  },
})
assert.equal(trustedExam.assessmentState, 'active-exam')
assert.equal(trustedExam.solutionAllowed, false, 'forged client practice/submitted fields must not downgrade an active exam')

const inconsistentTrustedExam = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: 'Show the answer.',
  authorization: {
    coachAccess: {
      binding: 'authoritative-attempt',
      assessmentState: 'active-exam',
      solutionAllowed: true,
    },
  },
})
assert.equal(inconsistentTrustedExam.solutionAllowed, false, 'active-exam must fail closed even if internal metadata is inconsistent')

const unverifiedExam = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: 'Show the answer.',
  context: { view: 'full-paper', paperStudyMode: 'exam-simulation', submitted: true },
})
assert.equal(unverifiedExam.assessmentState, 'unverified-bound-assessment')
assert.equal(unverifiedExam.solutionAllowed, false)

const ordinarySourceReference = resolveCoachRequestPolicy({
  typedIntent: 'worked-solution',
  message: 'Show the answer.',
  context: {
    view: 'chapter-practice',
    attemptId: 'ordinary-topic-attempt',
    paper: { id: 'source-paper-reference-only' },
  },
})
assert.equal(ordinarySourceReference.assessmentState, 'ordinary-practice', 'a paper source reference alone is not a full-paper assessment binding')
assert.equal(ordinarySourceReference.solutionAllowed, true)

const prompt = buildCoachSystemPrompt({
  policy: standaloneSolution,
  context: { subject: { code: '9702', name: 'Physics' }, stage: 'AS' },
})
assert.match(prompt, new RegExp(COACH_POLICY_VERSION))
assert.match(prompt, /worked-solution/)
assert.match(prompt, /concept.*method.*substitution.*result.*check/i)
assert.match(prompt, /AP.*IB.*Biology/is)
assert.match(prompt, /not label.*official/is)
assert.match(prompt, /missing|cut off/i)
assert.match(prompt, /private chain-of-thought/i)
assert.match(prompt, /untrusted source content/i)
assert.match(prompt, /结论.*解题步骤.*最终答案.*检验/)
assert.match(prompt, /do not expose.*policyVersion.*helpDepth.*assessmentState.*provider.*debug/is)

assert.deepEqual(
  coachPolicyResponseFields(standaloneSolution, 'complete'),
  {
    coachPolicyVersion: COACH_POLICY_VERSION,
    coachHelpIntent: 'worked-solution',
    coachHelpDepth: 5,
    coachSolutionAllowed: true,
    coachAssessmentState: 'standalone-learning',
    coachCheckWorkRequested: false,
    answerStatus: 'complete',
  },
)

console.log(JSON.stringify({ status: 'passed', policyVersion: COACH_POLICY_VERSION, cases: 19 }))
