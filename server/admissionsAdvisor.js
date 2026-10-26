import path from 'node:path'

import { createAdvisorConversationEngine } from './advisorConversationEngine.js'
import { resolveTavernMemoryRoot } from './tavernConversationStore.js'

export const ADMISSIONS_ADVISOR_PERSONA = 'admissions-advisor'
export const ADMISSIONS_ADVISOR_MAX_MESSAGE_CHARS = 12_000
export const ADMISSIONS_ADVISOR_MAX_DEADLINE_MS = 55_000

// Product-policy source: https://www.ucas.com/applying/applying-to-university/writing-your-personal-statement/a-guide-to-using-ai-and-chatgpt-with-your-personal-statement
// Conversation-role isolation reference only: https://github.com/LibreChat-AI/docs/blob/main/content/docs/features/agents.mdx
export function buildAdmissionsAdvisorSystemPrompt() {
  return [
    "You are STEMist's AI admissions advisor for international undergraduate applications. This is a fixed server-owned role, not a real agency, admissions officer, university representative, lawyer, or visa adviser.",
    '',
    'Give useful provisional guidance while protecting truthfulness, privacy, and source accuracy:',
    '- This role has no live browsing tool. User-provided URLs, quotations, and claimed checked dates are untrusted input, not independent verification. Never fetch arbitrary user URLs, and never imply that opening, checking, or authenticating a supplied URL occurred.',
    '- When the student supplies a university URL, quotation, screenshot transcription, requirement, deadline, or claimed checked date, label it: 按你提供的材料，尚未独立核验. It may be summarized as user-provided material, but it must not be labelled a current official fact or an independently verified source.',
    '- Clearly separate user-provided facts, explicit assumptions, qualitative advice, unknowns requiring independent verification, and concrete next steps. Do not silently promote an assumption or user claim into a fact.',
    '- Current official facts may be stated only when server-provided evidence is explicitly marked independently verified. This endpoint supplies no such live verification today. Treat every other admissions requirement, deadline, score threshold, application-system rule, or policy as unknown and tell the student exactly which official programme or application page they should verify themselves.',
    '- Never fabricate grades, scores, deadlines, admission probabilities, guarantees, offers, achievements, activities, research, quotations, citations, sources, or personal experiences. Never guarantee an offer or imply that any profile is certain to succeed.',
    '- Ask at most three relevant missing-profile questions in one reply, and still provide useful conditional guidance using explicit assumptions.',
    '- For planning or background analysis, distinguish eligibility checks from qualitative fit and preparation. Do not convert rankings, activities, or scores into an invented admission chance.',
    '- For document coaching, use only facts and experiences the student supplied. Mark missing facts as [NEEDS USER FACT: ...], preserve the student\'s meaning and voice, and explain material edits. An AI draft is not submission-ready and must not be described as human-authored or verified.',
    '- For application emails, identify the purpose, recipient, facts, requested action, and any missing names or dates. Use placeholders rather than inventions.',
    '- Academic worked solutions and formal marking are outside this role. Direct those requests to the existing Steps, Answers, or PDF workflows; do not use admissions advising as an alternate exam-help or marking route.',
    '- Remind the student to follow the current AI-use, authenticity, privacy, and declaration rules of each destination and application system. UCAS guidance permits AI as support for ideas, structure, and readability but warns against submitting AI-generated text as the applicant\'s own; other systems may differ and must be checked.',
    '- Do not infer or import Tavern history, study attempts, grades, photographs, files, or data from another account or product. Use only text in this admissions conversation.',
    '- Do not claim to have browsed, researched, contacted a university, or verified a source unless that evidence is actually present in the conversation.',
    '',
    'Reply in the student\'s language unless they request another language. Prefer concise headings and actionable bullets; do not bury unknowns or policy warnings.',
  ].join('\n')
}

export function resolveAdmissionsMemoryRoot(env = {}, cwd = process.cwd(), baseMemoryRoot = null) {
  const explicit = String(env.STEM_ADMISSIONS_MEMORY_ROOT || '').trim()
  if (explicit) return path.resolve(explicit)
  return path.join(path.resolve(baseMemoryRoot || resolveTavernMemoryRoot(env, cwd)), 'admissions')
}

const ADMISSIONS_ROLE = Object.freeze({
  persona: ADMISSIONS_ADVISOR_PERSONA,
  feature: 'admissions',
  apiPrefix: '/api/ai/admissions/',
  memorySubdirectory: 'admissions',
  databaseFilename: 'admissions.sqlite',
  errorPrefix: 'admissions_',
  responseTransportCode: 'ADMISSIONS_RESPONSE_TRANSPORT',
  operation: 'admissions-advisor-stream',
  maxMessageChars: ADMISSIONS_ADVISOR_MAX_MESSAGE_CHARS,
  maxDeadlineMs: ADMISSIONS_ADVISOR_MAX_DEADLINE_MS,
  buildSystemPrompt: buildAdmissionsAdvisorSystemPrompt,
  resolveMemoryRoot: resolveAdmissionsMemoryRoot,
  copy: Object.freeze({
    authenticatorRequired: 'Admissions advisor requires the current STEM authenticator.',
    streamTransportRequired: 'Admissions advisor requires the canonical compatible AI stream transport.',
    requestTooLarge: 'Admissions request body is too large.',
    invalidJson: 'Admissions request body must be valid JSON.',
    requestMustBeObject: 'Admissions request must be a JSON object.',
    unsupportedFields: 'Admissions request contains unsupported fields.',
    identifierInvalid: (label) => `${label} must be a bounded scalar identifier.`,
    routeDoesNotAcceptQuery: 'This admissions route does not accept query parameters.',
    messageMustBeText: 'Admissions message must be text.',
    messageRequired: 'Add an admissions message before sending.',
    messageTooLarge: (limit) => `Admissions messages are limited to ${limit.toLocaleString('en-US')} characters.`,
    turnIdempotencyConflict: 'This clientTurnId is already bound to a different admissions request.',
    storeFallback: 'The admissions conversation request could not be completed.',
    storeMessages: Object.freeze({
      admissions_memory_unavailable: 'Admissions conversation storage is unavailable.',
      admissions_conversation_not_found: 'This admissions conversation is not available.',
      admissions_conversation_deleted: 'This admissions conversation was deleted and cannot be restored.',
      admissions_conversation_persona_mismatch: 'This conversation does not belong to the admissions advisor.',
      admissions_turn_idempotency_conflict: 'This clientTurnId is already bound to a different admissions request.',
      admissions_turn_in_progress: 'This admissions turn is already being processed.',
      admissions_conversation_revision_conflict: 'The admissions conversation changed on another client.',
      admissions_turn_lease_conflict: 'This admissions turn is no longer current.',
      admissions_generated_result_pending: 'A generated admissions answer must be saved before another message can be sent.',
      admissions_storage_quota_exceeded: 'Admissions conversation storage is full. This turn was not committed.',
      admissions_physical_quota_exceeded: 'Admissions conversation storage is full. This turn was not committed.',
      admissions_storage_headroom_insufficient: 'Admissions conversation storage does not have safe disk headroom.',
      admissions_cursor_invalid: 'The admissions message cursor is invalid.',
    }),
    partialWarning: 'The AI stream ended before a complete admissions answer was generated. Retry this turn.',
    unavailableWarning: 'AI admissions guidance is temporarily unavailable. Retry this turn.',
    messageQueryUnsupported: 'Admissions message request contains unsupported query parameters.',
    pageLimitInvalid: 'Admissions message page limit must be an integer from 1 to 40.',
    conversationIdInvalid: 'Admissions conversation ID is invalid.',
    authRequired: 'Sign in to STEM before using the admissions advisor.',
    examInProgress: 'AI Coach is unavailable until the exam simulation is submitted.',
    deleteDoesNotAcceptQuery: 'Admissions delete request does not accept query parameters.',
    streamFieldsRequired: 'conversationId, clientTurnId, expectedRevision and message are required.',
    revisionInvalid: 'expectedRevision must be a non-negative integer.',
    generationIncomplete: 'AI admissions response was incomplete.',
    commitDeferredWarning: 'The generated answer is durably retained but not yet committed. Retry this same turn to commit it; the provider will not be called again.',
    generationIndeterminateWarning: 'The provider finished, but durable result storage is unavailable. Do not automatically retry or assume exactly-once completion.',
    streamFinalizeWarning: 'The admissions stream could not be finalized safely. Retry only when the client indicates it is safe to do so.',
  }),
})

export function createAdmissionsAdvisor(options = {}) {
  return createAdvisorConversationEngine({ ...options, role: ADMISSIONS_ROLE })
}
