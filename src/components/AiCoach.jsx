import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { BrainCircuit, Camera, FileText, History, ImagePlus, MonitorUp, RefreshCcw, Send, Sparkles, Upload, Wrench, X } from 'lucide-react'
import { resolveCoachIntent } from '../lib/coachIntent'
import {
  buildCoachConversationId,
  buildCoachRetryRequest,
  buildCoachStorageKey,
  buildLegacyCoachStorageKey,
  mergeCoachContext,
  mergeCoachMessages,
  serializeCoachContext,
  serializeCoachConversation,
} from '../lib/coachHistory'
import { parseCoachMessage } from '../lib/coachMessage'
import { coachStreamFailureState, createCoachStreamParser } from '../lib/coachStream'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../lib/practiceConstants'
import { sharedAccountRequest } from '../lib/sharedAccount'
import {
  beginCurrentPageCapture,
  cropCurrentPageCapture,
  cropVisiblePageVisuals,
  imageFileToDataUrl,
  MAX_COACH_IMAGE_ATTACHMENTS,
  MIN_CAPTURE_SELECTION_SIDE,
} from '../lib/coachScreenshot'

const EMPTY_PRACTICE_OPTIONS = Object.freeze([])
const AUTO_COACH_RETRY_DELAY_MS = 350
const MAX_AUTO_COACH_RETRIES = 1

function looksLikeImageFile(file) {
  const fileType = String(file?.type || '').trim().toLowerCase()
  const fileName = String(file?.name || '').trim()
  return fileType.startsWith('image/') || /\.(?:avif|heic|heif|jpe?g|png|webp)$/i.test(fileName)
}

function createImageAttachment(dataUrl = '', { name = 'Attached image', status = 'ready', source = 'upload', mimeType = 'image/*', errorMessage = '' } = {}) {
  return {
    id: `coach-image-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    dataUrl: String(dataUrl || ''),
    name: String(name || 'Attached image').trim() || 'Attached image',
    status: String(status || 'ready'),
    source: String(source || 'upload'),
    mimeType: String(mimeType || 'image/*'),
    ...(errorMessage ? { errorMessage: String(errorMessage) } : {}),
  }
}

function attachmentDataUrl(attachment) {
  return typeof attachment === 'string' ? attachment : String(attachment?.dataUrl || '')
}

function asImageAttachment(value, index = 0) {
  if (typeof value === 'string') return createImageAttachment(value, { name: `Attached image ${index + 1}` })
  if (!value || typeof value !== 'object') return createImageAttachment('', { name: `Attached image ${index + 1}`, status: 'error', errorMessage: 'Invalid image attachment.' })
  return {
    ...createImageAttachment('', { name: `Attached image ${index + 1}` }),
    ...value,
    dataUrl: attachmentDataUrl(value),
    name: String(value.name || `Attached image ${index + 1}`),
    status: String(value.status || (attachmentDataUrl(value) ? 'ready' : 'error')),
  }
}

function CoachMessage({ content }) {
  return (
    <p className="ai-message__content">
      {parseCoachMessage(content).map((token, index) => {
        if (token.type === 'break') return <br key={`break-${index}`} />
        if (token.type === 'bold') return <strong key={`bold-${index}`}>{token.value}</strong>
        if (token.type === 'math') return <code className="ai-message__math" key={`math-${index}`}>{token.value}</code>
        return <span key={`text-${index}`}>{token.value}</span>
      })}
    </p>
  )
}

function loadStoredConversation(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]')
    if (Array.isArray(value)) return { messages: mergeCoachMessages(value), context: {} }
    if (!value || typeof value !== 'object') return { messages: [], context: {} }
    return {
      messages: mergeCoachMessages(value.messages),
      context: mergeCoachContext({}, value.context || { contextText: value.contextText }),
    }
  } catch {
    return { messages: [], context: {} }
  }
}

function legacyStorageKeys(context, ownerId) {
  const owner = String(ownerId || 'guest').trim() || 'guest'
  return [...new Set([
    buildLegacyCoachStorageKey(context, owner),
    ...(owner === 'guest' ? [] : [buildLegacyCoachStorageKey(context, 'guest')]),
  ])]
}

function loadLocalMessages(context, storageKey, ownerId) {
  const owner = String(ownerId || 'guest').trim() || 'guest'
  const guestV4Key = buildCoachStorageKey(buildCoachConversationId(context), 'guest')
  const migrationKeys = [...new Set([
    ...legacyStorageKeys(context, owner),
    ...(owner === 'guest' || guestV4Key === storageKey ? [] : [guestV4Key]),
  ])]
  const current = loadStoredConversation(storageKey)
  const legacy = migrationKeys.map((key) => ({ key, ...loadStoredConversation(key) }))
  return {
    messages: mergeCoachMessages(current.messages, ...legacy.map((item) => item.messages)),
    context: legacy.reduce((persisted, item) => mergeCoachContext(persisted, item.context), current.context),
    legacyKeys: legacy.filter((item) => item.messages.length).map((item) => item.key),
  }
}

function historyConversationTitle(conversation) {
  const title = String(conversation?.title || '').trim()
  if (title && title !== 'AI Coach conversation') return title
  const binding = conversation?.binding || {}
  return [binding.module, binding.routeId, binding.questionId ? `Question ${binding.questionId}` : ''].filter(Boolean).join(' · ') || 'AI Coach conversation'
}

function historyConversationDate(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : 'Saved'
}

function historyConversationPreview(conversation) {
  const message = [...(conversation?.messages || [])].reverse().find((item) => item?.role === 'user' && item.content)
  return String(message?.content || conversation?.contextText || 'No message preview').replace(/\s+/g, ' ').trim().slice(0, 96)
}

export function AiCoach({
  context = {},
  stateOwnerId = '',
  sharedIdentityToken = '',
  sharedIdentityUserId = '',
  openRequest = 0,
  initialOpen = false,
  onInitialOpenHandled,
  openBuilderRequest = 0,
  showTrigger = true,
  practiceOptions = EMPTY_PRACTICE_OPTIONS,
  onGeneratePractice,
  onAgentAction,
  disabled = false,
}) {
  const sharedOwnerId = String(sharedIdentityUserId || '').trim()
  const storageOwnerId = sharedOwnerId || String(context.stateOwnerId || stateOwnerId || '').trim() || 'guest'
  const baseConversationId = buildCoachConversationId(context)
  const [selectedConversationId, setSelectedConversationId] = useState('')
  const [historyConversations, setHistoryConversations] = useState([])
  const [historyListOpen, setHistoryListOpen] = useState(false)
  const [historyListState, setHistoryListState] = useState('idle')
  const [historyListError, setHistoryListError] = useState('')
  const selectedConversation = useMemo(
    () => historyConversations.find((item) => item?.conversationId === selectedConversationId) || null,
    [historyConversations, selectedConversationId],
  )
  const activeContext = useMemo(() => {
    if (!selectedConversation) return context
    const persisted = selectedConversation.context || {
      routeId: selectedConversation.binding?.routeId,
      topicId: selectedConversation.binding?.topicId,
      contextText: selectedConversation.contextText,
    }
    return mergeCoachContext(context, persisted)
  }, [context, selectedConversation])
  const conversationId = selectedConversation?.conversationId || baseConversationId
  const storageKey = buildCoachStorageKey(conversationId, storageOwnerId)
  const historyScope = sharedIdentityToken && sharedOwnerId ? `${storageKey}:${sharedOwnerId}` : ''
  const initialHistoryRef = useRef(null)
  if (!initialHistoryRef.current) initialHistoryRef.current = loadLocalMessages(activeContext, storageKey, storageOwnerId)
  const initialHistory = initialHistoryRef.current
  const [open, setOpen] = useState(initialOpen)
  const [messages, setMessages] = useState(() => initialHistory.messages)
  const [draft, setDraft] = useState('')
  const [hintLevel, setHintLevel] = useState(1)
  const [imageDataUrls, setImageDataUrls] = useState([])
  const [builderOpen, setBuilderOpen] = useState(false)
  const [builderSubjectId, setBuilderSubjectId] = useState(practiceOptions[0]?.id || '')
  const [builderStage, setBuilderStage] = useState(practiceOptions[0]?.stages?.[0] || 'AS')
  const [builderTopicId, setBuilderTopicId] = useState(practiceOptions[0]?.topics?.[0]?.id || '')
  const [builderCount, setBuilderCount] = useState('10')
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureSource, setCaptureSource] = useState('')
  const [captureSelection, setCaptureSelection] = useState(null)
  const [captureError, setCaptureError] = useState('')
  const [attachingCapture, setAttachingCapture] = useState(false)
  const [preparingImages, setPreparingImages] = useState(false)
  const [error, setError] = useState('')
  const [historySyncState, setHistorySyncState] = useState('local')
  const [retryRequest, setRetryRequest] = useState(() => buildCoachRetryRequest(initialHistory.messages))
  const endRef = useRef(null)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const captureButtonRef = useRef(null)
  const cameraInputRef = useRef(null)
  const screenshotInputRef = useRef(null)
  const requestAbortRef = useRef(null)
  const autoRetryTimerRef = useRef(null)
  const historySyncTimerRef = useRef(null)
  const historyRequestVersionRef = useRef(0)
  const historyReadyScopeRef = useRef('')
  const activeHistoryScopeRef = useRef(historyScope)
  const pendingLegacyStorageKeysRef = useRef(new Set())
  const lastRequestRef = useRef(null)
  const lastOpenRequestRef = useRef(openRequest)
  const lastOpenBuilderRequestRef = useRef(openBuilderRequest)
  const hydratedStorageKeyRef = useRef(storageKey)
  const hydratedStorageOwnerRef = useRef(storageOwnerId)
  const captureFrameRef = useRef(null)
  const captureStartRef = useRef(null)
  const messagesRef = useRef(messages)
  const messageStorageKeyRef = useRef(storageKey)
  const contextRef = useRef(activeContext)
  const persistedCoachContextRef = useRef(initialHistory.context)
  contextRef.current = activeContext
  activeHistoryScopeRef.current = historyScope
  const canOpenBphoSpc = Boolean(onAgentAction && (activeContext.stage === 'Competition' || activeContext.routeId === 'bpho-admissions-physics'))

  useEffect(() => {
    setSelectedConversationId('')
  }, [baseConversationId])

  const builderSubject = useMemo(
    () => practiceOptions.find((item) => item.id === builderSubjectId) || practiceOptions[0],
    [builderSubjectId, practiceOptions],
  )
  const builderTopics = useMemo(() => builderSubject?.topics || [], [builderSubject])
  const builderTopic = useMemo(() => builderTopics.find((topic) => topic.id === builderTopicId) || builderTopics[0], [builderTopicId, builderTopics])
  const verifiedCount = builderTopic?.inventoryByStage?.[builderStage] ?? builderTopic?.inventory ?? 0
  const requestedCount = Number(builderCount) || 10
  const hasMinimumVerifiedSource = verifiedCount >= MIN_VERIFIED_GROUPS_FOR_PRACTICE
  const sourceReady = hasMinimumVerifiedSource && verifiedCount >= requestedCount
  const hasCaptureSelection = Boolean(
    captureSelection
    && captureSelection.width >= MIN_CAPTURE_SELECTION_SIDE
    && captureSelection.height >= MIN_CAPTURE_SELECTION_SIDE,
  )
  const readyImageAttachments = imageDataUrls.filter((attachment) => attachmentDataUrl(attachment) && attachment.status !== 'error')
  const hasImageAttachments = readyImageAttachments.length > 0
  const hasImageAttachmentTray = imageDataUrls.length > 0
  const closeCoach = useCallback(() => {
    setOpen(false)
    setBuilderOpen(false)
    window.requestAnimationFrame(() => {
      if (!disabled) triggerRef.current?.focus?.()
    })
  }, [disabled])
  const closeScreenshotCapture = useCallback(({ focus = true } = {}) => {
    captureFrameRef.current = null
    captureStartRef.current = null
    setCaptureOpen(false)
    setCaptureSource('')
    setCaptureSelection(null)
    setCaptureError('')
    setAttachingCapture(false)
    setCapturing(false)
    if (!disabled) {
      setOpen(true)
      if (focus) {
        window.requestAnimationFrame(() => captureButtonRef.current?.focus?.())
      }
    }
  }, [disabled])

  useEffect(() => {
    if (!builderSubject) return
    setBuilderSubjectId((current) => practiceOptions.some((item) => item.id === current) ? current : practiceOptions[0]?.id || '')
    setBuilderStage((current) => builderSubject.stages.includes(current) ? current : builderSubject.stages[0])
    setBuilderTopicId((current) => builderTopics.some((topic) => topic.id === current) ? current : builderTopics[0]?.id || '')
  }, [builderSubject, builderTopics, practiceOptions])

  const queueHistorySync = useCallback((messageSnapshot, { immediate = false } = {}) => {
    const token = String(sharedIdentityToken || '')
    const scope = historyScope
    if (!token || !scope || !Array.isArray(messageSnapshot) || !messageSnapshot.length) return
    const payload = serializeCoachConversation({
      conversationId,
      context: mergeCoachContext(contextRef.current, persistedCoachContextRef.current),
      messages: messageSnapshot,
    })
    if (!payload.messages.length) return
    const legacyKeys = [...pendingLegacyStorageKeysRef.current]
    const save = async () => {
      if (activeHistoryScopeRef.current === scope) setHistorySyncState('syncing')
      try {
        const saved = await sharedAccountRequest(token, '/api/stem/coach/conversations', {
          method: 'PUT',
          headers: { 'Idempotency-Key': conversationId },
          body: JSON.stringify({ conversation: payload }),
        })
        const savedConversation = saved?.conversations?.find((item) => item?.conversationId === conversationId) || payload
        setHistoryConversations((current) => [savedConversation, ...current.filter((item) => item?.conversationId !== conversationId)].slice(0, 80))
        legacyKeys.forEach((key) => window.localStorage.removeItem(key))
        if (activeHistoryScopeRef.current !== scope) return
        pendingLegacyStorageKeysRef.current.clear()
        setHistorySyncState('saved')
      } catch {
        if (activeHistoryScopeRef.current === scope) setHistorySyncState('pending')
      }
    }
    if (historySyncTimerRef.current) window.clearTimeout(historySyncTimerRef.current)
    if (immediate) {
      historySyncTimerRef.current = null
      void save()
      return
    }
    historySyncTimerRef.current = window.setTimeout(() => {
      historySyncTimerRef.current = null
      void save()
    }, 350)
  }, [conversationId, historyScope, sharedIdentityToken])

  useEffect(() => {
    // Do not write A's in-memory messages into B's storage key during an
    // account switch. The reset effect below hydrates the new scoped history.
    if (hydratedStorageKeyRef.current !== storageKey) return
    messagesRef.current = messages
    const storedMessages = messages.slice(-80).map(({ imageDataUrls: messageImages, ...message }) => ({
      ...message,
      attachmentCount: Number(message.attachmentCount) || messageImages?.length || 0,
    }))
    window.localStorage.setItem(storageKey, JSON.stringify({
      messages: storedMessages,
      context: serializeCoachContext(mergeCoachContext(contextRef.current, persistedCoachContextRef.current)),
    }))
    endRef.current?.scrollIntoView({ block: 'nearest' })
    if (historyScope && historyReadyScopeRef.current === historyScope) queueHistorySync(messages)
  }, [historyScope, messages, queueHistorySync, storageKey])

  useEffect(() => {
    if (hydratedStorageKeyRef.current === storageKey) return
    const ownerChanged = hydratedStorageOwnerRef.current !== storageOwnerId
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    window.clearTimeout(autoRetryTimerRef.current)
    autoRetryTimerRef.current = null
    if (historySyncTimerRef.current) window.clearTimeout(historySyncTimerRef.current)
    hydratedStorageKeyRef.current = storageKey
    hydratedStorageOwnerRef.current = storageOwnerId
    historyReadyScopeRef.current = ''
    const local = loadLocalMessages(activeContext, storageKey, storageOwnerId)
    pendingLegacyStorageKeysRef.current = new Set(local.legacyKeys)
    persistedCoachContextRef.current = local.context
    messageStorageKeyRef.current = storageKey
    messagesRef.current = local.messages
    setMessages(local.messages)
    setDraft('')
    setHintLevel(1)
    setImageDataUrls([])
    setError('')
    setLoading(false)
    setCapturing(false)
    captureFrameRef.current = null
    captureStartRef.current = null
    setCaptureOpen(false)
    setCaptureSource('')
    setCaptureSelection(null)
    setCaptureError('')
    setAttachingCapture(false)
    setPreparingImages(false)
    setBuilderOpen(false)
    setHistorySyncState(historyScope ? 'loading' : 'local')
    setRetryRequest(buildCoachRetryRequest(local.messages))
    lastRequestRef.current = null
    if (ownerChanged) setOpen(false)
  }, [activeContext, historyScope, storageKey, storageOwnerId])

  useEffect(() => {
    const requestVersion = historyRequestVersionRef.current + 1
    historyRequestVersionRef.current = requestVersion
    if (!historyScope) {
      historyReadyScopeRef.current = ''
      setHistoryConversations([])
      setSelectedConversationId('')
      setHistoryListState('idle')
      setHistoryListError('')
      setHistorySyncState('local')
      return undefined
    }
    const local = loadLocalMessages(contextRef.current, storageKey, storageOwnerId)
    pendingLegacyStorageKeysRef.current = new Set(local.legacyKeys)
    setHistorySyncState('loading')
    setHistoryListState('loading')
    setHistoryListError('')
    sharedAccountRequest(sharedIdentityToken, '/api/stem/coach/conversations?limit=80')
      .then((payload) => {
        if (historyRequestVersionRef.current !== requestVersion || activeHistoryScopeRef.current !== historyScope || messageStorageKeyRef.current !== storageKey) return
        const conversations = Array.isArray(payload?.conversations)
          ? payload.conversations.filter((item) => item?.conversationId && Array.isArray(item.messages) && item.messages.length)
          : []
        setHistoryConversations(conversations)
        setHistoryListState('saved')
        const remoteConversation = conversations.find((item) => item?.conversationId === conversationId)
        historyReadyScopeRef.current = historyScope
        persistedCoachContextRef.current = mergeCoachContext(
          remoteConversation?.context || { contextText: remoteConversation?.contextText || '' },
          persistedCoachContextRef.current,
        )
        const merged = mergeCoachMessages(messagesRef.current, local.messages, remoteConversation?.messages || [])
        messagesRef.current = merged
        setMessages(merged)
        setRetryRequest((current) => current?.assistantId === buildCoachRetryRequest(merged)?.assistantId
          ? current
          : buildCoachRetryRequest(merged))
        setHistorySyncState('saved')
      })
      .catch(() => {
        if (historyRequestVersionRef.current !== requestVersion || activeHistoryScopeRef.current !== historyScope) return
        setHistoryListState('error')
        setHistoryListError('Saved Coach history is temporarily unavailable. This device copy remains available.')
        historyReadyScopeRef.current = historyScope
        setHistorySyncState('pending')
        queueHistorySync(messagesRef.current, { immediate: true })
      })
    return () => {
      if (historyRequestVersionRef.current === requestVersion) historyRequestVersionRef.current += 1
    }
  }, [conversationId, historyScope, queueHistorySync, sharedIdentityToken, storageKey, storageOwnerId])

  useEffect(() => {
    if (!initialOpen || disabled) return
    setOpen(true)
    onInitialOpenHandled?.()
  }, [disabled, initialOpen, onInitialOpenHandled])

  useEffect(() => {
    if (openRequest === lastOpenRequestRef.current) return
    lastOpenRequestRef.current = openRequest
    if (openRequest && !disabled) setOpen(true)
  }, [disabled, openRequest])

  useEffect(() => {
    if (openBuilderRequest === lastOpenBuilderRequestRef.current) return
    lastOpenBuilderRequestRef.current = openBuilderRequest
    if (!openBuilderRequest || disabled) return
    const firstOption = practiceOptions[0]
    setOpen(true)
    setBuilderOpen(true)
    if (firstOption) {
      setBuilderSubjectId(firstOption.id)
      setBuilderStage(firstOption.stages?.[0] || 'AS')
      setBuilderTopicId(firstOption.topics?.[0]?.id || '')
    }
  }, [disabled, openBuilderRequest, practiceOptions])

  useEffect(() => () => {
    requestAbortRef.current?.abort()
    window.clearTimeout(autoRetryTimerRef.current)
    autoRetryTimerRef.current = null
    if (historySyncTimerRef.current) window.clearTimeout(historySyncTimerRef.current)
    historyRequestVersionRef.current += 1
    captureFrameRef.current = null
    captureStartRef.current = null
  }, [])

  useEffect(() => {
    if (!disabled) return
    requestAbortRef.current?.abort()
    requestAbortRef.current = null
    setOpen(false)
    setBuilderOpen(false)
    setLoading(false)
    setCapturing(false)
    captureFrameRef.current = null
    captureStartRef.current = null
    setCaptureOpen(false)
    setCaptureSource('')
    setCaptureSelection(null)
    setCaptureError('')
    setAttachingCapture(false)
    setDraft('')
    setImageDataUrls([])
    setPreparingImages(false)
    setError('')
  }, [disabled])

  useEffect(() => {
    if (!open) return undefined
    function closeOnEscape(event) {
      if (event.key !== 'Escape') return
      closeCoach()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeCoach, open])

  useEffect(() => {
    if (!open) return undefined
    const dialog = dialogRef.current
    if (!dialog) return undefined
    const focusableSelector = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'
    closeButtonRef.current?.focus?.()
    function keepFocusInside(event) {
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll(focusableSelector)].filter((element) => element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', keepFocusInside)
    return () => dialog.removeEventListener('keydown', keepFocusInside)
  }, [open, builderOpen, captureOpen])

  useEffect(() => {
    if (!captureOpen) return undefined
    function closeCaptureOnEscape(event) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeScreenshotCapture()
    }
    window.addEventListener('keydown', closeCaptureOnEscape)
    return () => window.removeEventListener('keydown', closeCaptureOnEscape)
  }, [captureOpen, closeScreenshotCapture])

  async function ask(message, level = hintLevel, options = {}) {
    const clean = String(message || '').trim()
    const attachmentItems = (Array.isArray(options.attachments)
      ? options.attachments
      : imageDataUrls
    ).map((attachment, index) => asImageAttachment(attachment, index)).slice(0, MAX_COACH_IMAGE_ATTACHMENTS)
    const attachments = attachmentItems.map(attachmentDataUrl).filter(Boolean)
    const retryAssistantId = String(options.retryAssistantId || '')
    const retryWarning = String(options.retryWarning || '')
    const autoRetryAttempt = Math.max(0, Number(options.autoRetryAttempt) || 0)
    if ((!clean && !attachments.length) || loading) return
    const studentMessage = {
      id: `coach-user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      role: 'user',
      content: clean || 'Please check the attached work.',
      imageDataUrls: attachments,
      attachmentCount: attachments.length,
      createdAt: new Date().toISOString(),
    }
    studentMessage.updatedAt = studentMessage.createdAt
    const previous = Array.isArray(options.history)
      ? options.history.map(({ role, content }) => ({ role, content }))
      : messages.slice(-10).map(({ role, content }) => ({ role, content }))
    const intent = Object.hasOwn(options, 'intent')
      ? options.intent
      : attachments.length ? null : resolveCoachIntent(clean, previous)
    const assistantId = retryAssistantId || `coach-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    const updateAssistant = (patch) => {
      const updatedAt = new Date().toISOString()
      setMessages((current) => {
        const existing = current.some((item) => item.id === assistantId)
        const next = existing
          ? current.map((item) => item.id === assistantId ? { ...item, ...patch, updatedAt } : item)
          : [...current, {
              id: assistantId,
              role: 'assistant',
              content: '',
              createdAt: updatedAt,
              updatedAt,
              ...patch,
            }]
        messagesRef.current = next
        return next
      })
    }
    if (retryAssistantId) {
      updateAssistant({ content: 'Retrying Coach response...', mode: 'streaming', status: 'retrying', hintLevel: level, warning: retryWarning })
    } else {
      setMessages((current) => {
        const next = [...current, studentMessage]
        messagesRef.current = next
        return next
      })
    }
    setDraft('')
    setLoading(true)
    setError('')
    setRetryRequest(null)
    lastRequestRef.current = { assistantId, message: studentMessage.content, level, attachments, previous, intent }
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    let streamedAnswer = ''
    let streamCompleted = false
    const scheduleAutomaticRetry = (warning = '') => {
      if (autoRetryAttempt >= MAX_AUTO_COACH_RETRIES || controller.signal.aborted || requestAbortRef.current !== controller) return false
      const retryStorageKey = storageKey
      const retryAttachments = attachments
      const retryHistory = previous
      const retryIntent = intent
      const retryAssistant = assistantId
      window.clearTimeout(autoRetryTimerRef.current)
      updateAssistant({
        content: streamedAnswer.trim() || 'Reconnecting Coach...',
        mode: streamedAnswer.trim() ? 'interrupted' : 'streaming',
        status: 'retrying',
        hintLevel: level,
        warning: warning || 'The connection was interrupted. Reconnecting automatically.',
      })
      setRetryRequest({ assistantId: retryAssistant, message: studentMessage.content, level, attachments: retryAttachments, previous: retryHistory, intent: retryIntent, unavailableAttachmentCount: 0 })
      setError(warning || 'The connection was interrupted. Reconnecting automatically.')
      requestAbortRef.current = null
      setLoading(false)
      autoRetryTimerRef.current = window.setTimeout(() => {
        autoRetryTimerRef.current = null
        if (disabled || requestAbortRef.current || messageStorageKeyRef.current !== retryStorageKey) return
        void ask(studentMessage.content, level, {
          attachments: retryAttachments,
          history: retryHistory,
          intent: retryIntent,
          retryAssistantId: retryAssistant,
          retryWarning: 'Automatic reconnect retained the attached photos.',
          autoRetryAttempt: autoRetryAttempt + 1,
        })
      }, AUTO_COACH_RETRY_DELAY_MS)
      return true
    }
    try {
      if (intent && onAgentAction) {
        const action = await onAgentAction(intent)
        if (action?.handled) {
          updateAssistant({ content: String(action.message || ''), mode: 'agent', status: 'completed', warning: '' })
          setImageDataUrls([])
          if (!action.keepOpen) closeCoach()
          return
        }
      }

      const coachContext = mergeCoachContext(contextRef.current, persistedCoachContextRef.current)
      updateAssistant({ content: 'Preparing Coach response...', mode: 'streaming', status: 'streaming', hintLevel: level, warning: retryWarning })
      const response = await fetch('/api/ai/coach/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sharedIdentityToken ? { Authorization: `Bearer ${sharedIdentityToken}` } : {}),
        },
        body: JSON.stringify({
          message: studentMessage.content,
          history: previous,
          context: intent?.type === 'clarify-practice' ? { ...coachContext, agentIntent: intent } : coachContext,
          hintLevel: level,
          imageDataUrls: attachments,
        }),
        signal: controller.signal,
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'AI Coach could not answer this request.')
      }
      if (!contentType.includes('text/event-stream')) {
        const payload = await response.json().catch(() => ({}))
        const answer = String(payload.answer || '').trim() || 'AI Coach returned an empty response.'
        const retryable = Boolean(payload.retryable)
        const partial = Boolean(payload.partial) || payload.mode === 'interrupted'
        updateAssistant({
          content: answer,
          mode: partial ? 'interrupted' : payload.mode || 'ai',
          status: retryable ? (partial ? 'interrupted' : 'failed') : payload.mode === 'offline' ? 'fallback' : 'completed',
          warning: payload.warning || '',
        })
        if (retryable) {
          const autoRetried = payload.providerStatus === 'error' && scheduleAutomaticRetry(payload.warning || (partial
            ? 'The connection was interrupted. Reconnecting automatically.'
            : 'AI Coach is temporarily unavailable. Reconnecting automatically.'))
          if (!autoRetried) {
            setRetryRequest({ assistantId, message: studentMessage.content, level, attachments, previous, intent, unavailableAttachmentCount: 0 })
            setError(payload.warning || (partial
              ? 'The connection was interrupted. The partial response was kept; retry to continue.'
              : 'AI Coach is temporarily unavailable. Retry to continue.'))
          }
        }
        streamCompleted = true
        if (payload.mode === 'offline') setError(payload.warning || 'AI Coach is offline. This response is only a controlled offline hint.')
      } else {
        const reader = response.body?.getReader()
        if (!reader) throw new Error('AI Coach returned no stream body.')
        const decoder = new TextDecoder()
        let buffer = ''
        const parseStreamEvent = createCoachStreamParser()
        const consumeEvent = (rawEvent) => {
          const parsed = parseStreamEvent(rawEvent)
          if (!parsed) return
          const { eventName, payload } = parsed
          if (eventName === 'delta') {
            streamedAnswer += String(payload.text || '')
            updateAssistant({ content: streamedAnswer, mode: 'ai', status: 'streaming', hintLevel: level, warning: retryWarning })
          }
          if (eventName === 'reset') {
            streamedAnswer = ''
            updateAssistant({ content: 'Preparing Coach response...', mode: 'streaming', status: 'streaming', hintLevel: level, warning: retryWarning })
          }
          if (eventName === 'done') {
            streamCompleted = true
            const retryable = Boolean(payload.retryable)
            const partial = Boolean(payload.partial) || payload.mode === 'interrupted'
            updateAssistant({
              content: String(payload.answer || streamedAnswer || '').trim() || 'AI Coach returned an empty response.',
              mode: partial ? 'interrupted' : payload.mode || 'ai',
              status: retryable ? (partial ? 'interrupted' : 'failed') : payload.mode === 'offline' ? 'fallback' : 'completed',
              hintLevel: level,
              warning: payload.warning || retryWarning,
            })
            if (retryable) {
              const autoRetried = payload.providerStatus === 'error' && scheduleAutomaticRetry(payload.warning || (partial
                ? 'The connection was interrupted. Reconnecting automatically.'
                : 'AI Coach is temporarily unavailable. Reconnecting automatically.'))
              if (!autoRetried) {
                setRetryRequest({ assistantId, message: studentMessage.content, level, attachments, previous, intent, unavailableAttachmentCount: 0 })
                setError(payload.warning || (partial
                  ? 'The connection was interrupted. The partial response was kept; retry to continue.'
                  : 'AI Coach is temporarily unavailable. Retry to continue.'))
              }
            }
            if (payload.mode === 'offline') setError(payload.warning || 'AI Coach is offline. This response is only a controlled offline hint.')
          }
          if (eventName === 'meta' && payload.mode) updateAssistant({ mode: payload.mode, provider: payload.provider || '' })
        }
        while (true) {
          const { value, done } = await reader.read()
          buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
          const events = buffer.split(/\r?\n\r?\n/)
          buffer = events.pop() || ''
          events.forEach(consumeEvent)
          if (done) break
        }
        if (buffer) consumeEvent(buffer)
        if (!streamCompleted) throw new Error('The response stream ended before completion.')
      }
      setImageDataUrls([])
      if (/hint|提示|下一步|截图|手写/i.test(clean)) setHintLevel((current) => Math.min(5, current + 1))
    } catch (requestError) {
      const failure = coachStreamFailureState({
        error: requestError,
        streamedAnswer,
        requestAborted: controller.signal.aborted,
        requestSuperseded: requestAbortRef.current !== controller,
        streamCompleted,
      })
      if (failure.ignored) return
      if (scheduleAutomaticRetry(failure.warning || (failure.status === 'interrupted' ? 'The connection was interrupted. Reconnecting automatically.' : 'AI Coach is temporarily unavailable. Reconnecting automatically.'))) return
      updateAssistant({
        content: failure.content,
        mode: failure.mode,
        status: failure.status,
        hintLevel: level,
        warning: failure.warning || retryWarning,
      })
      if (failure.retryable) {
        setRetryRequest({ assistantId, message: studentMessage.content, level, attachments, previous, intent, unavailableAttachmentCount: 0 })
        setError(failure.status === 'interrupted'
          ? 'The connection was interrupted. The partial response was kept; retry to continue.'
          : failure.warning || 'AI Coach is temporarily unavailable.')
      }
    } finally {
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null
        setLoading(false)
      }
    }
  }

  function retryLastRequest() {
    const retry = retryRequest || lastRequestRef.current
    if (!retry || loading) return
    setImageDataUrls((retry.attachments || []).map((attachment, index) => asImageAttachment(attachment, index)))
    const retryWarning = retry.unavailableAttachmentCount
      ? `The original ${retry.unavailableAttachmentCount === 1 ? 'photo was' : 'photos were'} not saved in account history. Retry uses the saved question and OCR text; attach the photo again if it is needed.`
      : ''
    void ask(retry.message, retry.level, {
      attachments: retry.attachments,
      history: retry.previous,
      intent: retry.intent,
      retryAssistantId: retry.assistantId,
      retryWarning,
    })
  }

  async function attachFiles(files, { source = 'upload', assumeImage = false } = {}) {
    const imageFiles = [...(files || [])].filter((file) => assumeImage || looksLikeImageFile(file))
    if (!imageFiles.length) return
    const available = MAX_COACH_IMAGE_ATTACHMENTS - imageDataUrls.length
    if (available <= 0) {
      setError(`Remove a photo before adding more. Coach accepts up to ${MAX_COACH_IMAGE_ATTACHMENTS}.`)
      return
    }
    const selected = imageFiles.slice(0, available)
    const pending = selected.map((file, index) => createImageAttachment('', {
      name: String(file.name || '').trim() || (source === 'clipboard' ? `Pasted image ${index + 1}` : `Image ${index + 1}`),
      status: 'preparing',
      source,
      mimeType: file.type || 'image/*',
    }))
    setImageDataUrls((current) => [...current, ...pending].slice(0, MAX_COACH_IMAGE_ATTACHMENTS))
    setPreparingImages(true)
    setError('')
    try {
      const prepared = await Promise.allSettled(selected.map((file) => imageFileToDataUrl(file, { assumeImage })))
      setImageDataUrls((current) => current.map((attachment) => {
        const pendingIndex = pending.findIndex((item) => item.id === attachment.id)
        if (pendingIndex < 0) return attachment
        const result = prepared[pendingIndex]
        if (result?.status === 'fulfilled' && result.value) {
          return { ...attachment, dataUrl: result.value, status: 'ready', errorMessage: '' }
        }
        return {
          ...attachment,
          status: 'error',
          errorMessage: result?.reason?.message || 'This photo could not be attached.',
        }
      }))
      const rejected = prepared.find((result) => result.status === 'rejected')
      if (rejected) setError(rejected.reason?.message || 'One of the selected photos could not be attached.')
      else if (imageFiles.length > selected.length) setError(`Only the first ${MAX_COACH_IMAGE_ATTACHMENTS} photos were attached.`)
    } catch (attachError) {
      setError(attachError.message)
    } finally {
      setPreparingImages(false)
    }
  }

  async function attachImage(event, source = 'upload') {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    await attachFiles(files, { source, assumeImage: source === 'camera' })
  }

  function attachClipboardImages(event) {
    const items = [...(event.clipboardData?.items || [])]
    const files = items
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile?.())
      .filter((file) => looksLikeImageFile(file))
    if (!files.length) return
    event.preventDefault()
    void attachFiles(files, { source: 'clipboard' })
  }

  async function captureCurrentPage() {
    if (capturing) return
    if (imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS) {
      setError(`Remove a photo before adding more. Coach accepts up to ${MAX_COACH_IMAGE_ATTACHMENTS}.`)
      return
    }
    setError('')
    setCapturing(true)
    setCaptureError('')
    setCaptureSelection(null)
    // Remove the drawer before the browser freezes the selected STEM-tab frame.
    // flushSync keeps getDisplayMedia inside the click gesture.
    flushSync(() => setOpen(false))
    try {
      captureFrameRef.current = await beginCurrentPageCapture()
      setCaptureSource('screen')
    } catch {
      captureFrameRef.current = null
      setCaptureSource('visible-page')
    } finally {
      setCapturing(false)
    }
    setCaptureOpen(true)
  }

  function capturePoint(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }

  function selectionFromPoints(start, end) {
    return {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    }
  }

  function startCaptureSelection(event) {
    if (event.target.closest('[data-capture-controls]')) return
    const point = capturePoint(event)
    captureStartRef.current = { pointerId: event.pointerId, ...point }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setCaptureError('')
    setCaptureSelection({ left: point.x, top: point.y, width: 0, height: 0 })
  }

  function updateCaptureSelection(event) {
    const start = captureStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    setCaptureSelection(selectionFromPoints(start, capturePoint(event)))
  }

  function finishCaptureSelection(event) {
    const start = captureStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    const selection = selectionFromPoints(start, capturePoint(event))
    captureStartRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    setCaptureSelection(selection)
    if (selection.width < MIN_CAPTURE_SELECTION_SIDE || selection.height < MIN_CAPTURE_SELECTION_SIDE) {
      setCaptureError('Drag across a larger question area before attaching it.')
    }
  }

  async function attachCapturedArea() {
    if (!hasCaptureSelection || attachingCapture) {
      setCaptureError('Drag across a larger question area before attaching it.')
      return
    }
    setAttachingCapture(true)
    setCaptureError('')
    try {
      const screenshot = captureFrameRef.current
        ? await cropCurrentPageCapture(captureFrameRef.current, captureSelection)
        : await cropVisiblePageVisuals(captureSelection)
      setImageDataUrls((current) => [...current, createImageAttachment(screenshot, {
        name: 'Captured question area',
        status: 'ready',
        source: captureSource || 'screen-capture',
        mimeType: 'image/jpeg',
      })].slice(0, MAX_COACH_IMAGE_ATTACHMENTS))
      setError('')
      closeScreenshotCapture({ focus: false })
    } catch (selectionError) {
      setCaptureError(selectionError.message || 'The selected area could not be attached.')
      setAttachingCapture(false)
    }
  }

  function submitComposer(event) {
    event?.preventDefault?.()
    void ask(draft)
  }

  async function generatePractice() {
    if (!onGeneratePractice || !builderSubject || !builderTopicId || generating) return
    if (!sourceReady) {
      setError(hasMinimumVerifiedSource
        ? `This topic currently has ${verifiedCount} checked official questions. Choose an available set size.`
        : `Source indexing is in progress. At least ${MIN_VERIFIED_GROUPS_FOR_PRACTICE} verified question groups are required before AI can build a set.`)
      return
    }
    setGenerating(true)
    setError('')
    try {
      const unit = await onGeneratePractice({
        routeId: builderSubject.routeId,
        subjectId: builderSubject.subjectId,
        stage: builderSubject.stage,
        knowledgeGroupId: builderTopicId,
        questionCount: Number(builderCount),
        allowPartial: false,
      })
      setMessages((current) => [...current, {
        role: 'assistant',
        content: `已生成 ${unit.title}: ${unit.questionGroupCount || unit.parts.length} 题，${unit.maxMarks} 分。每题都有独立答题区；提交后按答案规则批改，手写题会连同图片交给 AI 复核。`,
        createdAt: new Date().toISOString(),
      }])
      setBuilderOpen(false)
      closeCoach()
    } catch (generationError) {
      setError(generationError.message || 'Practice set could not be generated.')
    } finally {
      setGenerating(false)
    }
  }

  if (disabled) return null

  return (
    <>
      {showTrigger && <button ref={triggerRef} type="button" className="ai-coach-trigger" onClick={() => setOpen(true)} aria-label="Open AI Coach" title="Open AI Coach">
        <Sparkles size={18} /><span>AI Coach</span>
      </button>}
      {open && <button type="button" className="ai-coach-backdrop" onPointerDown={closeCoach} onClick={closeCoach} aria-label="Close AI Coach" />}
      <aside ref={dialogRef} className={`ai-coach ${open ? 'open' : ''} ${builderOpen ? 'builder-open' : ''}`} inert={!open ? true : undefined} aria-hidden={!open} aria-modal="true" role="dialog" aria-label="AI Coach">
        <header>
          <div className="ai-coach__identity"><span><BrainCircuit size={19} /></span><div><strong>AI Coach</strong><small>{activeContext.question?.label || activeContext.question?.title || activeContext.subject?.code || 'Study support'}</small></div></div>
          <div className="ai-coach__header-actions">
            <button type="button" className="icon-button" onClick={() => setHistoryListOpen((current) => !current)} aria-label="Open Coach chat history" title="Chat history"><History size={17} /></button>
            <button ref={closeButtonRef} type="button" className="icon-button" onClick={closeCoach} aria-label="Close AI Coach"><X size={18} /></button>
          </div>
        </header>

        {historyListOpen && <section className="ai-coach__history-panel" aria-label="Coach chat history">
          <div className="ai-coach__history-heading"><div><strong>Coach chat history</strong><small>{sharedIdentityToken && sharedOwnerId ? 'Saved to this STEM account' : 'Local copy on this device'}</small></div><button type="button" className="icon-button" onClick={() => setHistoryListOpen(false)} aria-label="Close Coach chat history"><X size={15} /></button></div>
          {sharedIdentityToken && sharedOwnerId && historyListState === 'loading' && <p className="ai-coach__history-empty">Loading saved chats...</p>}
          {sharedIdentityToken && sharedOwnerId && historyListError && <p className="ai-coach__history-error" role="status">{historyListError}</p>}
          {sharedIdentityToken && sharedOwnerId && historyListState !== 'loading' && !historyConversations.length && <p className="ai-coach__history-empty">No saved Coach chats yet.</p>}
          {!sharedIdentityToken && <p className="ai-coach__history-empty">Sign in to STEM to browse and restore Coach chats across devices and releases.</p>}
          {selectedConversationId && <button type="button" className="ai-coach__history-current" onClick={() => { setSelectedConversationId(''); setHistoryListOpen(false) }}><History size={13} />Return to this question</button>}
          {historyConversations.map((conversation) => <button
            type="button"
            className={`ai-coach__history-row ${conversation.conversationId === conversationId ? 'active' : ''}`}
            key={conversation.conversationId}
            onClick={() => { setSelectedConversationId(conversation.conversationId); setHistoryListOpen(false); setOpen(true) }}
          >
            <strong>{historyConversationTitle(conversation)}</strong>
            <span>{historyConversationPreview(conversation)}</span>
            <small>{historyConversationDate(conversation.updatedAt)} · {conversation.messages.length} messages</small>
          </button>)}
        </section>}

        <div className="ai-coach__context">
          <span>{activeContext.stage || 'Cambridge practice'}</span>
          <strong>{activeContext.question?.prompt || selectedConversation?.title || 'Choose a question and ask about the next step.'}</strong>
          {!activeContext.submitted && <small>Before submission, Coach gives progressive hints without revealing the final answer.</small>}
        </div>

        <details className="ai-coach__tools">
          <summary><Wrench size={14} />Tools</summary>
          <div className="ai-coach__quick-actions">
            {onGeneratePractice && <button type="button" className={builderOpen ? 'active' : ''} onClick={() => setBuilderOpen((value) => !value)}><Sparkles size={13} />Build practice</button>}
            <button ref={captureButtonRef} type="button" className="ai-coach__screenshot" aria-label="Capture question area" disabled={capturing} onClick={captureCurrentPage}><MonitorUp size={13} />{capturing ? 'Capturing...' : 'Capture question area'}</button>
            <button type="button" className="ai-coach__screenshot" data-upload-intent="true" aria-label="Provide screenshot or upload photo" disabled={preparingImages || imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS} onClick={() => screenshotInputRef.current?.click()}><Upload size={13} />{preparingImages ? 'Preparing...' : `Upload photo (${imageDataUrls.length}/${MAX_COACH_IMAGE_ATTACHMENTS})`}</button>
            {canOpenBphoSpc && <button type="button" onClick={() => ask('打开最新的 BPhO SPC 真题，带答案。')}><FileText size={13} />Latest BPhO SPC</button>}
            <button type="button" onClick={() => ask('Give me a hint for the next step.', hintLevel)}>Hint {hintLevel}/5</button>
            <button type="button" onClick={() => ask('Check my method and identify the first issue.', 3)}>Check method</button>
            {hasImageAttachments && <button type="button" onClick={() => ask('Read my attached work. Give me the first issue and one next step, without giving the final answer.', hintLevel)}><ImagePlus size={13} />Review {imageDataUrls.length > 1 ? 'photos' : 'photo'}</button>}
            <button type="button" onClick={() => ask('What should I practise next based on this response?', 2)}>Next practice</button>
          </div>
        </details>

        {builderOpen && <section className="ai-coach__builder" aria-label="Generate a focused practice set">
          <header><div><strong>Build a focused set</strong><span>Choose the syllabus point, then start writing.</span></div><Sparkles size={18} /></header>
          <label><span>Learning route</span><select value={builderSubject?.id || ''} onChange={(event) => setBuilderSubjectId(event.target.value)}>{practiceOptions.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label><span>Knowledge point</span><select value={builderTopicId} onChange={(event) => setBuilderTopicId(event.target.value)}>{builderTopics.map((topic) => <option value={topic.id} key={topic.id}>{topic.label}</option>)}</select></label>
          <label><span>Questions</span><select value={builderCount} onChange={(event) => setBuilderCount(event.target.value)}><option value="10">10 questions</option><option value="15" disabled={verifiedCount < 15}>15 questions</option><option value="20" disabled={verifiedCount < 20}>20 questions</option></select></label>
          <p>Uses complete official questions with linked mark schemes. <strong>{verifiedCount} available for this stage</strong>{sourceReady ? ' · ready to build' : hasMinimumVerifiedSource ? ` · choose ${Math.min(verifiedCount, 10)} questions or fewer` : ` · more questions are being prepared (${MIN_VERIFIED_GROUPS_FOR_PRACTICE} needed for a set)`}</p>
          <button type="button" className="primary-action" onClick={generatePractice} disabled={generating || !builderTopicId || !sourceReady}><Sparkles size={16} />{generating ? 'Building...' : sourceReady ? 'Generate and start' : hasMinimumVerifiedSource ? 'Choose an available size' : 'Source indexing in progress'}</button>
        </section>}

        <div className="ai-coach__messages" aria-live="polite">
          {!messages.length && <div className="ai-coach__empty"><Sparkles size={20} /><strong>Ask about the question in front of you</strong><span>Coach already has the subject, paper, stage, current response and submission state.</span></div>}
          {messages.map((message, index) => (
            <article className={`ai-message ai-message--${message.role}`} key={`${message.createdAt || index}-${index}`}>
              <span>{message.role === 'assistant' ? 'Coach' : 'You'}</span>
              <CoachMessage content={message.content} />
              {message.imageDataUrls?.length ? <div className="ai-message__attachments" aria-label={`${message.imageDataUrls.length} photos sent`}>{message.imageDataUrls.map((image, imageIndex) => <img src={image} alt={`Sent work ${imageIndex + 1}`} key={`${message.createdAt}-image-${imageIndex}`} />)}</div> : null}
              {!message.imageDataUrls?.length && message.attachmentCount > 0 ? <small>{message.attachmentCount} photos were attached to this message.</small> : null}
              {message.warning && <small>{message.warning}</small>}
              {message.role === 'assistant' && message.mode === 'local' && <small>Local hint first. Ask for a detailed explanation to use AI Coach.</small>}
              {message.role === 'assistant' && message.mode === 'offline' && <small>Offline hint only; retry when AI Coach is available.</small>}
              {message.role === 'assistant' && retryRequest?.assistantId === message.id && <>
                {retryRequest.unavailableAttachmentCount > 0 && <small>Original photos are not kept in account history. Retry can continue with the saved question and text context.</small>}
                <button type="button" className="ai-message__retry" disabled={loading} onClick={retryLastRequest}><RefreshCcw size={13} />Retry</button>
              </>}
            </article>
          ))}
          {loading && <div className="ai-coach__thinking"><span />Reviewing the current question...</div>}
          <div ref={endRef} />
        </div>

        <footer>
          <div className="ai-coach__photo-actions" aria-label="Photograph or upload a question">
            <button type="button" data-camera-intent="true" disabled={preparingImages || loading || imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS} onClick={() => cameraInputRef.current?.click()}><Camera size={16} />Take photo</button>
            <button type="button" data-upload-intent="true" disabled={preparingImages || loading || imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS} onClick={() => screenshotInputRef.current?.click()}><Upload size={16} />Upload photo</button>
            {hasImageAttachments && <button type="button" className="ai-coach__analyze-photo" disabled={preparingImages || loading} onClick={() => ask('Analyze this photographed question. Read the full question and diagrams, identify what it asks, list the relevant concepts and known values, then explain the next step without inventing missing text.', 3)}><Sparkles size={16} />Analyze question</button>}
          </div>
          {hasImageAttachmentTray && <div className="ai-coach__attachments" role="status" aria-live="polite">
            <span className="ai-coach__attachment-summary"><strong>{readyImageAttachments.length}/{MAX_COACH_IMAGE_ATTACHMENTS}</strong> photos ready</span>
            {imageDataUrls.map((attachment, index) => {
              const image = attachmentDataUrl(attachment)
              const statusLabel = attachment.status === 'preparing' ? 'Preparing...' : attachment.status === 'error' ? 'Could not attach' : 'Ready'
              return <div className="ai-coach__attachment" key={attachment.id || `${image.slice(-24)}-${index}`}>
                {image ? <img src={image} alt={`${attachment.name} preview`} /> : <span className="ai-coach__attachment-placeholder">{statusLabel}</span>}
                <div className="ai-coach__attachment-meta"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.status}</small></div>
                <button type="button" onClick={() => setImageDataUrls((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove attached photo ${index + 1}`}><X size={14} /></button>
              </div>
            })}
          </div>}
          {preparingImages && <p className="ai-coach__attachment-status" role="status">Preparing photos...</p>}
          {(historySyncState === 'loading' || historySyncState === 'syncing') && <p className="ai-coach__history-status" role="status">Saving chat history...</p>}
          {historySyncState === 'pending' && <p className="ai-coach__history-status ai-coach__history-status--pending" role="status">Chat is kept on this device and will sync when the account service is available.</p>}
          {error && <p className="ai-coach__error" role="alert">{error}</p>}
          <form className="ai-coach__composer" onSubmit={submitComposer}>
            <button type="button" className="ai-coach__composer-attach" title="Add photos" aria-label="Add photos" disabled={preparingImages || imageDataUrls.length >= MAX_COACH_IMAGE_ATTACHMENTS} onClick={() => screenshotInputRef.current?.click()}><ImagePlus size={18} /></button>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" data-camera-input="true" hidden onChange={(event) => attachImage(event, 'camera')} />
            <input ref={screenshotInputRef} type="file" accept="image/*" multiple data-upload-input="true" hidden onChange={attachImage} />
            <textarea rows="2" value={draft} placeholder="Ask about a concept or your next step..." onChange={(event) => setDraft(event.target.value)} onPaste={attachClipboardImages} onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void ask(draft)
              }
            }} />
            <button type="submit" disabled={loading || preparingImages || (!draft.trim() && !hasImageAttachments)} aria-label="Send to AI Coach"><Send size={18} /></button>
          </form>
        </footer>
      </aside>
      {captureOpen && <section
        className="ai-coach__capture-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Capture a question area"
        onPointerDown={startCaptureSelection}
        onPointerMove={updateCaptureSelection}
        onPointerUp={finishCaptureSelection}
        onPointerCancel={finishCaptureSelection}
      >
        <div className="ai-coach__capture-guide">
          <strong>{captureSource === 'screen' ? 'Drag around the question, graph, table or working you want Coach to read.' : 'Drag over a visible question, graph, or handwritten area to attach it.'}</strong>
          <span>{captureSource === 'screen' ? 'The selected STEM tab was frozen before this selector opened.' : 'Screen sharing was not started, so STEM will crop visible source images and writing instead.'}</span>
        </div>
        {captureSelection && <div
          className="ai-coach__capture-selection"
          aria-hidden="true"
          style={{
            left: `${captureSelection.left}px`,
            top: `${captureSelection.top}px`,
            width: `${captureSelection.width}px`,
            height: `${captureSelection.height}px`,
          }}
        />}
        <div className="ai-coach__capture-toolbar" data-capture-controls onPointerDown={(event) => event.stopPropagation()}>
          {captureError && <p role="alert">{captureError}</p>}
          <button type="button" onClick={() => {
            setCaptureSelection(null)
            setCaptureError('')
          }}>Retake</button>
          <button type="button" className="primary-action" disabled={!hasCaptureSelection || attachingCapture} onClick={attachCapturedArea}>{attachingCapture ? 'Attaching...' : 'Attach screenshot'}</button>
          <button type="button" onClick={() => closeScreenshotCapture()}>Cancel</button>
        </div>
      </section>}
    </>
  )
}
