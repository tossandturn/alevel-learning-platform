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
    ...(text(message?.status, 40) ? { status: text(message.status, 40) } : {}),
    ...(text(message?.mode, 40) ? { mode: text(message.mode, 40) } : {}),
    ...(text(message?.warning, 500) ? { warning: text(message.warning, 500) } : {}),
    ...(text(message?.provider, 80) ? { provider: text(message.provider, 80) } : {}),
    ...(attachments.length ? { attachments, attachmentCount: attachments.length } : {}),
    _position: position,
  }
}

function messageFingerprint(message) {
  return `${message.role}|${message.createdAt || ''}|${message.content}`
}

function richerMessage(current, candidate) {
  const primary = candidate.content.length > current.content.length ? candidate : current
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

/** Removes image data URLs while retaining only attachment metadata for the account history. */
export function serializeCoachConversation({ conversationId, context = {}, messages = [], sourceProduct = 'stem' } = {}) {
  const mergedMessages = mergeCoachMessages(messages)
  const now = new Date().toISOString()
  const persistedMessages = mergedMessages.map((message) => {
    const attachments = attachmentMetadata(message)
    return {
      role: message.role,
      content: message.content,
      createdAt: isoDate(message.createdAt, now),
      ...(attachments.length ? { attachments } : {}),
      ...(text(message.status, 40) ? { status: text(message.status, 40) } : {}),
    }
  })
  const question = context.question || {}
  const subject = context.subject || {}
  const paper = context.paper || {}
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
