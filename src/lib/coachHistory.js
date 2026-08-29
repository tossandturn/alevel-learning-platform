export const COACH_HISTORY_STORAGE_PREFIX = 'alevel-ai-coach-v4'
export const LEGACY_COACH_HISTORY_STORAGE_PREFIX = 'alevel-ai-coach-v3'
export const MAX_COACH_HISTORY_MESSAGES = 80

function text(value, maxLength = 12_000) {
  return String(value || '').replaceAll(String.fromCharCode(0), '').trim().slice(0, maxLength)
}

function stablePart(value, fallback = 'general') {
  const normalized = text(value, 240).normalize('NFKC').toLowerCase()
  const compact = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96)
  return compact || fallback
}

function isoDate(value, fallback = '') {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
}

function contextText(value, maxLength = 6_000) {
  return text(value, maxLength)
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+/gi, '[image omitted]')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function numberInRange(value, minimum, maximum) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function hasOwn(object, key) {
  return Boolean(object && Object.hasOwn(object, key))
}

function attachmentMetadata(message) {
  const existing = Array.isArray(message?.attachments) ? message.attachments : []
  const count = Math.max(
    Number(message?.attachmentCount) || 0,
    Array.isArray(message?.imageDataUrls) ? message.imageDataUrls.length : 0,
    existing.length,
  )
  return Array.from({ length: Math.min(4, count) }, (_, index) => {
    const source = existing[index]
    return {
      type: text(source?.type || 'image', 40) || 'image',
      mimeType: text(source?.mimeType || 'image/*', 80) || 'image/*',
      source: text(source?.source || 'student-upload', 80) || 'student-upload',
    }
  })
}

function normalizeMessage(message, position) {
  const role = text(message?.role, 20).toLowerCase()
  const content = text(message?.content)
  if (!['user', 'assistant'].includes(role) || !content) return null
  const attachments = attachmentMetadata(message)
  return {
    ...message,
    ...(text(message?.id, 120) ? { id: text(message.id, 120) } : {}),
    role,
    content,
    ...(isoDate(message?.createdAt) ? { createdAt: isoDate(message.createdAt) } : {}),
    ...(isoDate(message?.updatedAt) ? { updatedAt: isoDate(message.updatedAt) } : {}),
    ...(text(message?.status, 40) ? { status: text(message.status, 40) } : {}),
    ...(text(message?.mode, 40) ? { mode: text(message.mode, 40) } : {}),
    ...(text(message?.warning, 500) ? { warning: text(message.warning, 500) } : {}),
    ...(text(message?.provider, 80) ? { provider: text(message.provider, 80) } : {}),
    ...(numberInRange(message?.hintLevel, 1, 5) ? { hintLevel: numberInRange(message.hintLevel, 1, 5) } : {}),
    ...(attachments.length ? { attachments, attachmentCount: attachments.length } : {}),
    _position: position,
  }
}

function messageFingerprint(message) {
  return `${message.role}|${message.createdAt || ''}|${message.content}`
}

function richerMessage(current, candidate) {
  const currentUpdatedAt = Date.parse(current.updatedAt || current.createdAt || '') || 0
  const candidateUpdatedAt = Date.parse(candidate.updatedAt || candidate.createdAt || '') || 0
  const candidateIsNewer = candidateUpdatedAt > currentUpdatedAt
    || (candidateUpdatedAt === currentUpdatedAt && candidate._position >= current._position)
  const primary = candidateIsNewer ? candidate : current
  const secondary = primary === candidate ? current : candidate
  const primaryImages = Array.isArray(primary.imageDataUrls) ? primary.imageDataUrls : []
  const secondaryImages = Array.isArray(secondary.imageDataUrls) ? secondary.imageDataUrls : []
  const attachments = primary.attachments?.length ? primary.attachments : secondary.attachments || []
  return {
    ...secondary,
    ...primary,
    ...(primaryImages.length || secondaryImages.length ? { imageDataUrls: primaryImages.length ? primaryImages : secondaryImages } : {}),
    ...(attachments.length ? { attachments, attachmentCount: attachments.length } : {}),
    _position: Math.min(current._position, candidate._position),
  }
}

/** Merges offline and server copies without duplicating already-synced turns. */
export function mergeCoachMessages(...messageLists) {
  const byFingerprint = new Map()
  const byId = new Map()
  let position = 0
  for (const list of messageLists) {
    for (const rawMessage of Array.isArray(list) ? list : []) {
      const message = normalizeMessage(rawMessage, position)
      position += 1
      if (!message) continue
      const fingerprint = messageFingerprint(message)
      const existing = (message.id && byId.get(message.id)) || byFingerprint.get(fingerprint)
      if (existing) {
        const merged = richerMessage(existing, message)
        byFingerprint.set(messageFingerprint(existing), merged)
        byFingerprint.set(messageFingerprint(message), merged)
        byFingerprint.set(messageFingerprint(merged), merged)
        if (existing.id) byId.set(existing.id, merged)
        if (message.id) byId.set(message.id, merged)
        continue
      }
      byFingerprint.set(fingerprint, message)
      if (message.id) byId.set(message.id, message)
    }
  }
  const unique = [...new Set(byFingerprint.values())]
  return unique
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || '') || 0
      const rightTime = Date.parse(right.createdAt || '') || 0
      return leftTime - rightTime || left._position - right._position
    })
    .slice(-MAX_COACH_HISTORY_MESSAGES)
    .map(({ _position, ...message }) => message)
}

/** Uses source identity rather than transient view or attempt IDs, so deployments restore the same thread. */
export function buildCoachConversationId(context = {}, sourceProduct = 'stem') {
  const subject = context.subject || {}
  const paper = context.paper || {}
  const question = context.question || {}
  const route = context.routeId || paper.routeId || subject.routeId || 'general'
  const stage = context.stage || paper.stage || 'general'
  const course = subject.code || subject.id || context.component || 'general'
  const stableQuestionId = question.id || question.questionId
  const paperId = stableQuestionId ? 'item' : paper.questionFile || paper.id || paper.paperId || 'general'
  const questionId = stableQuestionId || question.number || question.label || 'overview'
  return [
    'coach',
    stablePart(sourceProduct, 'stem'),
    'v1',
    stablePart(route),
    stablePart(stage),
    stablePart(course),
    stablePart(paperId),
    stablePart(questionId, 'overview'),
  ].join(':')
}

export function buildCoachStorageKey(conversationId, ownerId = 'guest') {
  return `${COACH_HISTORY_STORAGE_PREFIX}:${encodeURIComponent(stablePart(ownerId, 'guest'))}:${encodeURIComponent(text(conversationId, 240))}`
}

/** Matches the pre-account-sync key exactly so an existing local thread can be migrated once. */
export function buildLegacyCoachStorageKey(context = {}, ownerId = 'guest') {
  const subject = context.subject || {}
  const question = context.question || {}
  const owner = String(ownerId || 'guest').trim() || 'guest'
  const route = context.routeId || 'unscoped-route'
  const stage = context.stage || 'unscoped-stage'
  const course = subject.code || subject.id || 'unscoped-course'
  const view = context.view || 'general'
  const attempt = context.attemptId || 'no-attempt'
  const questionId = question.id || question.number || question.label || 'overview'
  return `${LEGACY_COACH_HISTORY_STORAGE_PREFIX}:${encodeURIComponent(owner)}:${route}:${stage}:${course}:${view}:${attempt}:${questionId}`
}

function conversationTitle(context) {
  const question = context.question || {}
  const subject = context.subject || {}
  return text(question.label || question.title || subject.title || subject.code || 'AI Coach conversation', 180) || 'AI Coach conversation'
}

function serializedSubject(subject) {
  const source = subject && typeof subject === 'object' ? subject : {}
  const code = text(source.code || source.id, 80)
  const title = text(source.title || source.name, 180)
  return {
    ...(code ? { code } : {}),
    ...(title ? { title } : {}),
  }
}

function serializedPaper(paper) {
  const source = paper && typeof paper === 'object' ? paper : {}
  const id = text(source.id || source.paperId, 500)
  const questionFile = text(source.questionFile, 500)
  const markSchemeFile = text(source.markSchemeFile, 500)
  return {
    ...(id ? { id } : {}),
    ...(questionFile ? { questionFile } : {}),
    ...(markSchemeFile ? { markSchemeFile } : {}),
  }
}

function serializedQuestion(question) {
  const source = question && typeof question === 'object' ? question : {}
  const id = text(source.id || source.questionId, 500)
  const number = numberInRange(source.number, 0, 100_000)
  const label = text(source.label, 300)
  const title = text(source.title, 300)
  const prompt = text(source.prompt, 6_000)
  const hint = text(source.hint, 1_500)
  const marks = numberInRange(source.marks, 0, 10_000)
  return {
    ...(id ? { id } : {}),
    ...(number != null ? { number } : {}),
    ...(label ? { label } : {}),
    ...(title ? { title } : {}),
    ...(prompt ? { prompt } : {}),
    ...(hint ? { hint } : {}),
    ...(marks != null ? { marks } : {}),
  }
}

function serializedPart(part) {
  const source = part && typeof part === 'object' ? part : {}
  const id = text(source.id || source.questionPartId, 360)
  const questionPartId = text(source.questionPartId || source.id, 360)
  const label = contextText(source.label, 300)
  const prompt = contextText(source.prompt, 2_000)
  const marks = numberInRange(source.marks, 0, 10_000)
  return {
    ...(id ? { id } : {}),
    ...(questionPartId ? { questionPartId } : {}),
    ...(label ? { label } : {}),
    ...(prompt ? { prompt } : {}),
    ...(marks != null ? { marks } : {}),
  }
}

function serializedEnum(value, allowed) {
  const normalized = text(value, 80).toLowerCase()
  return allowed.includes(normalized) ? normalized : ''
}

/**
 * Retains only retry-safe text context. Student image bytes intentionally never
 * enter account history, so a restored retry can request a fresh attachment.
 */
export function serializeCoachContext(context = {}) {
  const source = context && typeof context === 'object' ? context : {}
  const question = serializedQuestion(source.question)
  const subject = serializedSubject(source.subject)
  const paper = serializedPaper(source.paper)
  const part = serializedPart(source.part)
  const sourceContextText = contextText(source.contextText || source.sourceQuestionExtract, 6_000)
  const topic = text(source.topic?.label || source.topic?.name || source.topic?.id || source.topic || source.topicId, 500)
  const paperStudyMode = serializedEnum(source.paperStudyMode, ['past-paper-practice', 'exam-simulation'])
  const submissionStatus = serializedEnum(source.submissionStatus, ['draft', 'submitted'])
  const responseStatus = serializedEnum(source.responseStatus, ['answered', 'unanswered'])
  return {
    ...(text(source.attemptId, 120) ? { attemptId: text(source.attemptId, 120) } : {}),
    ...(text(source.routeId, 500) ? { routeId: text(source.routeId, 500) } : {}),
    ...(text(source.view, 120) ? { view: text(source.view, 120) } : {}),
    ...(text(source.stage, 120) ? { stage: text(source.stage, 120) } : {}),
    ...(text(source.component, 180) ? { component: text(source.component, 180) } : {}),
    ...(text(source.syllabus, 500) ? { syllabus: text(source.syllabus, 500) } : {}),
    ...(topic ? { topic } : {}),
    ...(Object.keys(subject).length ? { subject } : {}),
    ...(Object.keys(paper).length ? { paper } : {}),
    ...(Object.keys(question).length ? { question } : {}),
    ...(Object.keys(part).length ? { part } : {}),
    ...(paperStudyMode ? { paperStudyMode } : {}),
    ...(submissionStatus ? { submissionStatus } : {}),
    ...(responseStatus ? { responseStatus } : {}),
    ...(sourceContextText ? { contextText: sourceContextText, sourceQuestionExtract: sourceContextText } : {}),
    ...(hasOwn(source, 'response') ? { response: text(source.response, 6_000) } : {}),
    ...(hasOwn(source, 'handwritingAttached') ? { handwritingAttached: Boolean(source.handwritingAttached) } : {}),
    ...(hasOwn(source, 'submitted') ? { submitted: Boolean(source.submitted) } : {}),
    ...(text(source.markingStatus, 120) ? { markingStatus: text(source.markingStatus, 120) } : {}),
  }
}

/** Gives current page state priority while filling missing question/OCR detail from account history. */
export function mergeCoachContext(currentContext = {}, persistedContext = {}) {
  const current = serializeCoachContext(currentContext)
  const persisted = serializeCoachContext(persistedContext)
  const question = { ...(persisted.question || {}), ...(current.question || {}) }
  const subject = { ...(persisted.subject || {}), ...(current.subject || {}) }
  const paper = { ...(persisted.paper || {}), ...(current.paper || {}) }
  const part = { ...(persisted.part || {}), ...(current.part || {}) }
  const merged = {
    ...persisted,
    ...current,
    ...(Object.keys(question).length ? { question } : {}),
    ...(Object.keys(subject).length ? { subject } : {}),
    ...(Object.keys(paper).length ? { paper } : {}),
    ...(Object.keys(part).length ? { part } : {}),
  }
  const mergedContextText = contextText(current.contextText || persisted.contextText, 6_000)
  if (mergedContextText) {
    merged.contextText = mergedContextText
    merged.sourceQuestionExtract = mergedContextText
  }
  return merged
}

/**
 * Rebuilds a retry from the persisted pair of original user and interrupted
 * assistant messages. It deliberately returns no image data URLs.
 */
export function buildCoachRetryRequest(messages = []) {
  const history = mergeCoachMessages(messages)
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const assistant = history[index]
    if (assistant?.role !== 'assistant' || !['interrupted', 'failed', 'retrying', 'streaming'].includes(assistant.status) || !assistant.id) continue
    let userIndex = index - 1
    while (userIndex >= 0 && history[userIndex]?.role !== 'user') userIndex -= 1
    const user = history[userIndex]
    if (!user?.content) continue
    const unavailableAttachmentCount = Math.max(
      Number(user.attachmentCount) || 0,
      Array.isArray(user.attachments) ? user.attachments.length : 0,
    )
    return {
      assistantId: assistant.id,
      message: user.content,
      level: numberInRange(assistant.hintLevel, 1, 5) || 1,
      previous: history
        .slice(0, userIndex)
        .filter((message) => ['user', 'assistant'].includes(message.role) && message.content)
        .slice(-10)
        .map(({ role, content }) => ({ role, content })),
      attachments: [],
      unavailableAttachmentCount,
    }
  }
  return null
}

/** Removes image data URLs while retaining only attachment metadata for the account history. */
export function serializeCoachConversation({ conversationId, context = {}, messages = [], sourceProduct = 'stem' } = {}) {
  const mergedMessages = mergeCoachMessages(messages)
  const now = new Date().toISOString()
  const persistedMessages = mergedMessages.map((message) => {
    const attachments = attachmentMetadata(message)
    return {
      ...(text(message.id, 120) ? { id: text(message.id, 120) } : {}),
      role: message.role,
      content: message.content,
      createdAt: isoDate(message.createdAt, now),
      updatedAt: isoDate(message.updatedAt, isoDate(message.createdAt, now)),
      ...(attachments.length ? { attachments } : {}),
      ...(text(message.mode, 40) ? { mode: text(message.mode, 40) } : {}),
      ...(text(message.status, 40) ? { status: text(message.status, 40) } : {}),
      ...(text(message.warning, 500) ? { warning: text(message.warning, 500) } : {}),
      ...(numberInRange(message.hintLevel, 1, 5) ? { hintLevel: numberInRange(message.hintLevel, 1, 5) } : {}),
    }
  })
  const question = context.question || {}
  const subject = context.subject || {}
  const paper = context.paper || {}
  const coachContext = serializeCoachContext(context)
  const firstMessageAt = persistedMessages[0]?.createdAt || now
  const updatedAt = now
  return {
    conversationId: text(conversationId || buildCoachConversationId(context, sourceProduct), 180),
    sourceProduct: text(sourceProduct, 40).toLowerCase() || 'stem',
    surface: text(context.view, 120),
    module: text(subject.code || subject.id || context.component, 80),
    title: conversationTitle(context),
    binding: {
      ...(text(context.routeId, 500) ? { routeId: text(context.routeId, 500) } : {}),
      ...(text(context.topic?.id || context.topicId, 500) ? { topicId: text(context.topic?.id || context.topicId, 500) } : {}),
      ...(text(paper.questionFile || paper.id || paper.paperId, 500) ? { paperId: text(paper.questionFile || paper.id || paper.paperId, 500) } : {}),
      ...(text(question.id || question.questionId || question.number, 500) ? { questionId: text(question.id || question.questionId || question.number, 500) } : {}),
      ...(text(subject.code || subject.id, 500) ? { module: text(subject.code || subject.id, 500) } : {}),
    },
    ...(coachContext.contextText ? { contextText: coachContext.contextText } : {}),
    context: coachContext,
    messages: persistedMessages,
    metadata: {
      status: persistedMessages.at(-1)?.status || 'saved',
      source: 'stem-ai-coach',
      updatedAt,
    },
    createdAt: firstMessageAt,
    updatedAt,
  }
}
