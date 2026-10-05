export const COACH_HELP_INTENTS = Object.freeze({
  HINT: 'hint',
  WORKED_SOLUTION: 'worked-solution',
  CHECK_WORK: 'check-work',
})

const VALID_HELP_INTENTS = new Set(Object.values(COACH_HELP_INTENTS))
const EXAM_MODE_PATTERN = /^(?:exam|exam-simulation|timed-exam|mock-exam)$/i

export function normalizeCoachHelpIntent(value, fallback = '') {
  const intent = String(value || '').trim().toLowerCase()
  return VALID_HELP_INTENTS.has(intent) ? intent : fallback
}

export function isBoundInProgressExam(context = {}) {
  const attempt = context?.attempt && typeof context.attempt === 'object' ? context.attempt : {}
  const bound = Boolean(
    context?.attemptId
    || context?.attempt?.id
    || context?.attempt?.attemptId
    || context?.paperAttemptId,
  )
  const examMode = [
    context?.paperStudyMode,
    context?.studyMode,
    context?.mode,
    context?.assessmentMode,
    attempt?.paperStudyMode,
    attempt?.studyMode,
    attempt?.mode,
  ].some((value) => EXAM_MODE_PATTERN.test(String(value || '').trim()))
    || context?.timedExam === true
    || context?.examMode === true
    || attempt?.timedExam === true
  const submitted = context?.submitted === true
    || Boolean(context?.submittedAt)
    || attempt?.submitted === true
    || Boolean(attempt?.submittedAt)
  return bound && examMode && !submitted
}

export function coachHelpPolicy(context = {}) {
  const solutionDisabled = isBoundInProgressExam(context)
  return Object.freeze({
    solutionDisabled,
    solutionDisabledReason: solutionDisabled
      ? 'Full solutions stay unavailable during an in-progress timed exam. The server verifies exam state.'
      : '',
    defaultPhotoIntent: solutionDisabled ? COACH_HELP_INTENTS.HINT : COACH_HELP_INTENTS.WORKED_SOLUTION,
  })
}

function learningDomain(context = {}) {
  const product = String(context?.product || '').toLowerCase()
  const skill = String(context?.skill || context?.activeModule || context?.module || '').toLowerCase()
  if (product.includes('ielts') || ['writing', 'reading', 'listening', 'speaking'].includes(skill)) return `ielts-${skill || 'general'}`
  return 'stem'
}

function instructionFor(intent, context, hasAttachments) {
  const domain = learningDomain(context)
  if (domain === 'ielts-writing') {
    if (intent === COACH_HELP_INTENTS.HINT) return 'Give guidance on the single highest-impact IELTS Writing improvement. Do not rewrite the complete response.'
    if (intent === COACH_HELP_INTENTS.CHECK_WORK) return 'Check this IELTS Writing response against Task Response/Achievement, Coherence and Cohesion, Lexical Resource, and Grammar. Give a clear verdict, the first major issue, and a corrected example.'
    return 'I explicitly want complete IELTS Writing feedback in learning mode. Cover all four scoring criteria, explain the main fixes, and provide a concise improved model passage.'
  }
  if (domain === 'ielts-reading' || domain === 'ielts-listening') {
    const evidence = domain === 'ielts-reading' ? 'the exact passage evidence' : 'the transcript or audio evidence available in context'
    if (intent === COACH_HELP_INTENTS.HINT) return `Point me toward ${evidence} and the relevant question type without revealing the final answer.`
    if (intent === COACH_HELP_INTENTS.CHECK_WORK) return `Check my answer against ${evidence}. State the verdict, identify the first reasoning error, and explain the corrected evidence chain.`
    return `I explicitly want the complete answer explanation in learning mode. Identify ${evidence}, explain why the correct answer follows, and address the distractors without inventing missing source text.`
  }
  if (intent === COACH_HELP_INTENTS.HINT) {
    return `Give guidance only${hasAttachments ? ' for the attached question or work' : ''}: identify the key concept and one next step. Do not reveal the final answer.`
  }
  if (intent === COACH_HELP_INTENTS.CHECK_WORK) {
    return `Check my work${hasAttachments ? ' in the attached image' : ''}. Give a verdict, identify the first wrong or unsupported step, and show the corrected method. Do not give generic praise.`
  }
  return `I explicitly want a complete worked solution in learning mode${hasAttachments ? ' for the attached question' : ''}. Explain the concept, method, substitutions or reasoning, final result, and a quick check. If the question or diagram is cut off, ask for the missing information instead of guessing.`
}

export function buildCoachHelpRequest({ helpIntent = '', message = '', context = {}, hasAttachments = false } = {}) {
  const policy = coachHelpPolicy(context)
  const cleanMessage = String(message || '').trim()
  const requested = normalizeCoachHelpIntent(helpIntent, hasAttachments && !cleanMessage ? policy.defaultPhotoIntent : '')
  const resolved = policy.solutionDisabled && requested === COACH_HELP_INTENTS.WORKED_SOLUTION
    ? COACH_HELP_INTENTS.HINT
    : requested
  const instruction = resolved ? instructionFor(resolved, context, hasAttachments) : ''
  return Object.freeze({
    helpIntent: resolved,
    message: [cleanMessage, instruction].filter(Boolean).join('\n\n'),
    hintLevel: resolved === COACH_HELP_INTENTS.WORKED_SOLUTION ? 5 : resolved === COACH_HELP_INTENTS.CHECK_WORK ? 4 : 2,
    solutionDisabled: policy.solutionDisabled,
    solutionDisabledReason: policy.solutionDisabledReason,
  })
}

export function coachHelpDisplayMessage(helpIntent, originalMessage = '') {
  const cleanMessage = String(originalMessage || '').trim()
  if (cleanMessage) return cleanMessage
  return {
    [COACH_HELP_INTENTS.HINT]: '请给我提示',
    [COACH_HELP_INTENTS.WORKED_SOLUTION]: '请完整解答这道题',
    [COACH_HELP_INTENTS.CHECK_WORK]: '请检查我的作答',
  }[normalizeCoachHelpIntent(helpIntent)] || '请查看我附上的内容'
}

export function coachResponseOutcome(payload = {}, streamedAnswer = '', { hasAttachments = false, helpIntent = '' } = {}) {
  const mode = String(payload?.mode || '').toLowerCase()
  const providerStatus = String(payload?.providerStatus || '').toLowerCase()
  const partial = Boolean(payload?.partial) || mode === 'interrupted'
  const answer = String(payload?.answer || streamedAnswer || '').trim()
  const unavailable = mode === 'offline' || ['error', 'not_configured'].includes(providerStatus)
  const connectedAi = mode === 'ai' && providerStatus === 'connected'
  const validLocalHint = mode === 'local' && providerStatus === 'skipped' && ['', COACH_HELP_INTENTS.HINT].includes(helpIntent) && Boolean(answer)
  if (partial) {
    return Object.freeze({ completed: false, retryable: true, status: 'interrupted', mode: 'interrupted', content: answer || 'The response was interrupted before Coach completed it.' })
  }
  if (unavailable || (!connectedAi && !validLocalHint)) {
    return Object.freeze({
      completed: false,
      retryable: true,
      status: 'failed',
      mode: unavailable ? 'offline' : mode || 'unknown',
      content: hasAttachments
        ? 'Coach could not complete the photo review. Your photo and question are still attached; retry when AI is available.'
        : 'Coach could not complete this answer. Your question is still saved; retry when AI is available.',
    })
  }
  if (!answer) {
    return Object.freeze({ completed: false, retryable: true, status: 'failed', mode: mode || 'ai', content: 'Coach returned no answer. Your question is saved; retry to continue.' })
  }
  return Object.freeze({ completed: true, retryable: false, status: 'completed', mode: validLocalHint ? 'local' : 'ai', content: answer })
}
