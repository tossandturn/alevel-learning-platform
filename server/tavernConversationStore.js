import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const TAVERN_MEMORY_SCHEMA_VERSION = 'stem-tavern-memory.v1'
export const TAVERN_MEMORY_COUNTING_METHOD = 'utf8-provider-envelope-upper-bound-v2'
export const TAVERN_MEMORY_DEFAULT_QUOTA_BYTES = 64 * 1024 * 1024
export const TAVERN_MEMORY_DEFAULT_SEGMENT_BYTES = 64 * 1024
export const TAVERN_MEMORY_MAX_PROVIDER_BYTES = 12 * 1024 * 1024
export const TAVERN_MEMORY_MAX_MESSAGE_BYTES = 64 * 1024 - 1
export const TAVERN_MEMORY_MAX_LEGACY_IMPORT_BYTES = 1024 * 1024
export const TAVERN_MEMORY_MAX_PAGE_BYTES = 512 * 1024

const PERSONAS = new Set([
  'keeper', 'study-buddy', 'cat-companion', 'story-traveler',
  'xianxia-guide', 'mystery-guide', 'eastern-oracle', 'tarot-reader',
])
const KNOWN_CONTEXT_WINDOWS = Object.freeze({
  'qwen3.7-max': 1_000_000,
  'qwen3.7-plus': 1_000_000,
})
const UNKNOWN_CONTEXT_WINDOW = 32_768
const MAX_TURN_CONTENT_BYTES = TAVERN_MEMORY_MAX_MESSAGE_BYTES
const MAX_PAGE_LIMIT = 40
const MAX_PAGE_SERIALIZED_BYTES = TAVERN_MEMORY_MAX_PAGE_BYTES
const MAX_LEGACY_IMPORT_BYTES = TAVERN_MEMORY_MAX_LEGACY_IMPORT_BYTES

function memoryError(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra })
}

function databaseSync() {
  const module = process.getBuiltinModule?.('node:sqlite')
  if (!module?.DatabaseSync) throw memoryError(503, 'tavern_memory_unavailable', 'Tavern memory storage is unavailable.')
  return module.DatabaseSync
}

function ownerValue(value) {
  if (typeof value !== 'string' || !/^ielts:\d+$/.test(value)) throw memoryError(401, 'coach_auth_required', 'Sign in to use Tavern memory.')
  return value
}

function personaValue(value) {
  if (typeof value !== 'string' || !PERSONAS.has(value)) throw memoryError(400, 'coach_tavern_persona_invalid', 'Choose a server-owned Tavern persona.')
  return value
}

function boundedId(value, code, label, { optional = false } = {}) {
  if ((value === undefined || value === null || value === '') && optional) return ''
  if (typeof value !== 'string') throw memoryError(400, code, `${label} must be a bounded scalar identifier.`)
  const clean = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,180}$/.test(clean)) throw memoryError(400, code, `${label} must be a bounded scalar identifier.`)
  return clean
}

function cleanContent(value) {
  if (typeof value !== 'string') throw memoryError(400, 'tavern_turn_content_invalid', 'Tavern turn content must be text.')
  const clean = value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+/gi, '[image omitted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[secret omitted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [secret omitted]')
    .replaceAll(String.fromCharCode(0), '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!clean) throw memoryError(400, 'tavern_turn_content_invalid', 'Tavern turn content cannot be empty.')
  if (Buffer.byteLength(clean, 'utf8') > MAX_TURN_CONTENT_BYTES) {
    throw memoryError(413, 'tavern_turn_content_too_large', 'This Tavern turn is too large to store safely.')
  }
  return clean
}

function hashJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function transaction(database, operation) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    database.exec('COMMIT')
    return result
  } catch (error) {
    try { database.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
    throw error
  }
}

function publicConversation(row) {
  return {
    id: String(row.conversation_id),
    persona: String(row.persona),
    revision: Number(row.revision) || 0,
    turnCount: Number(row.turn_count) || 0,
  }
}

function publicTurn(row) {
  return {
    id: String(row.turn_id),
    role: String(row.role),
    content: String(row.content || ''),
    sequence: Number(row.sequence),
    status: String(row.status),
  }
}

function tokenize(value) {
  const text = String(value || '').normalize('NFKC').toLowerCase()
  const latin = text.match(/[a-z0-9]{2,}/g) || []
  const chineseRuns = text.match(/[\u3400-\u9fff]{2,}/g) || []
  const chinese = chineseRuns.flatMap((run) => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)))
  return [...new Set([...latin, ...chinese])].slice(0, 80)
}

function extractiveSummary(rows) {
  const snippets = rows
    .filter((row) => row.role === 'user')
    .map((row) => String(row.content || '').replace(/\s+/g, ' ').trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 12)
  return snippets.join(' | ').slice(0, 2400)
}

function encodeCursor(sequence) {
  return Buffer.from(JSON.stringify({ v: 1, before: Number(sequence) }), 'utf8').toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  if (typeof value !== 'string' || value.length > 120 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw memoryError(400, 'tavern_cursor_invalid', 'The message cursor is invalid.')
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed?.v !== 1 || !Number.isInteger(parsed.before) || parsed.before < 1) throw new Error('invalid')
    return parsed.before
  } catch {
    throw memoryError(400, 'tavern_cursor_invalid', 'The message cursor is invalid.')
  }
}

export function tavernModelContextWindow(model) {
  const normalized = String(model || '').trim().toLowerCase()
  const tokens = KNOWN_CONTEXT_WINDOWS[normalized]
  return Object.freeze({ model: normalized || 'unknown', tokens: tokens || UNKNOWN_CONTEXT_WINDOW, verified: Boolean(tokens) })
}

export function estimateTavernTokensUpperBound(value, overhead = 16) {
  return Buffer.byteLength(String(value || ''), 'utf8') + Math.max(0, Number(overhead) || 0)
}

export function resolveTavernMemoryRoot(env = {}, cwd = process.cwd()) {
  const configuredDatabasePath = String(env.STEM_DATABASE_PATH || env.STEM_DB_PATH || path.join(cwd, 'data', 'stem.sqlite'))
  if (configuredDatabasePath === ':memory:') {
    throw memoryError(503, 'tavern_memory_root_required', 'An explicit Tavern memory store is required for in-memory STEM tests.')
  }
  return path.dirname(path.resolve(configuredDatabasePath))
}

function completePairs(messages) {
  const pairs = []
  for (let index = 0; index < messages.length - 1; index += 1) {
    if (messages[index]?.role !== 'user' || messages[index + 1]?.role !== 'assistant') continue
    if ((messages[index]?.status && messages[index].status !== 'complete')
      || (messages[index + 1]?.status && messages[index + 1].status !== 'complete')) continue
    pairs.push([messages[index], messages[index + 1]])
    index += 1
  }
  return pairs
}

export function selectTavernProviderContext({
  model,
  protocol = 'chat-completions',
  metadata = null,
  systemPrompt = '',
  currentMessage = '',
  recentMessages = [],
  retrievedSegments = [],
  sourceHistoryTruncated = false,
  contextWindowOverride = null,
  maxOutboundBytes = TAVERN_MEMORY_MAX_PROVIDER_BYTES,
} = {}) {
  const modelWindow = tavernModelContextWindow(model)
  const contextWindowTokens = Number.isInteger(contextWindowOverride) && contextWindowOverride > 256
    ? contextWindowOverride
    : modelWindow.tokens
  const outputReserve = Math.min(2_048, Math.floor(contextWindowTokens * 0.2))
  const safetyReserve = Math.max(64, Math.floor(contextWindowTokens * 0.05))
  const responsesProtocol = protocol === 'responses'
  const fixedEnvelope = responsesProtocol
    ? {
        instructions: systemPrompt,
        input: [{ role: 'user', content: [{ type: 'input_text', text: currentMessage }] }],
        ...(metadata ? { metadata } : {}),
      }
    : {
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: currentMessage }],
        ...(metadata ? { metadata } : {}),
      }
  const fixedEstimate = estimateTavernTokensUpperBound(JSON.stringify(fixedEnvelope), 64)
  const inputBudget = Math.max(128, contextWindowTokens - outputReserve - safetyReserve - fixedEstimate)
  const outboundBudget = Math.max(1024, Math.min(Number(maxOutboundBytes) || TAVERN_MEMORY_MAX_PROVIDER_BYTES, TAVERN_MEMORY_MAX_PROVIDER_BYTES))
  let usedEstimate = fixedEstimate
  let usedBytes = Buffer.byteLength(JSON.stringify(fixedEnvelope), 'utf8')
  const memoryMessages = []
  let usedSegments = 0

  for (const segment of (Array.isArray(retrievedSegments) ? retrievedSegments : []).slice(0, 8)) {
    const content = `[Derived extract from turns ${segment.firstSequence}-${segment.lastSequence}; source ${segment.sourceChecksum}]\n${segment.summary}`
    const serialized = responsesProtocol
      ? JSON.stringify({ role: 'user', content: [{ type: 'input_text', text: content }] })
      : JSON.stringify({ role: 'user', content })
    const estimate = estimateTavernTokensUpperBound(serialized, 16)
    const bytes = Buffer.byteLength(serialized, 'utf8')
    if (usedEstimate + estimate > contextWindowTokens - outputReserve - safetyReserve || usedBytes + bytes > outboundBudget) continue
    memoryMessages.push({ role: 'user', content })
    usedEstimate += estimate
    usedBytes += bytes
    usedSegments += 1
  }

  const pairs = completePairs(Array.isArray(recentMessages) ? recentMessages : [])
  const selectedNewestFirst = []
  let consideredPairs = 0
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    consideredPairs += 1
    const pair = pairs[index].map(({ role, content }) => ({ role, content: String(content || '') }))
    let pairBytes = 0
    const estimate = pair.reduce((total, message) => {
      const content = responsesProtocol && message.role === 'assistant'
        ? `[Previous Coach response]\n${message.content}`
        : message.content
      const serialized = responsesProtocol
        ? JSON.stringify({ role: 'user', content: [{ type: 'input_text', text: content }] })
        : JSON.stringify({ role: message.role, content })
      pairBytes += Buffer.byteLength(serialized, 'utf8')
      return total + estimateTavernTokensUpperBound(serialized, 16)
    }, 0)
    const bytes = pairBytes
    if (usedEstimate + estimate > contextWindowTokens - outputReserve - safetyReserve || usedBytes + bytes > outboundBudget) continue
    selectedNewestFirst.push(pair)
    usedEstimate += estimate
    usedBytes += bytes
  }
  const selectedHistory = selectedNewestFirst.reverse().flat()
  return Object.freeze({
    messages: Object.freeze([...memoryMessages, ...selectedHistory].map((message) => Object.freeze(message))),
    memory: Object.freeze({
      contextWindowTokens,
      estimatedInputUpperBoundTokens: usedEstimate,
      countingMethod: TAVERN_MEMORY_COUNTING_METHOD,
      historyTruncated: Boolean(sourceHistoryTruncated) || selectedHistory.length < pairs.length * 2,
      usedHistoryMessages: selectedHistory.length,
      retrievedSegments: usedSegments,
      providerModelVerified: modelWindow.verified,
      outputReserveTokens: outputReserve,
      consideredHistoryPairs: consideredPairs,
      inputBudgetUpperBoundTokens: inputBudget,
    }),
  })
}

export function createTavernConversationStore({
  root,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  quotaBytes = TAVERN_MEMORY_DEFAULT_QUOTA_BYTES,
  segmentTargetBytes = TAVERN_MEMORY_DEFAULT_SEGMENT_BYTES,
  leaseTtlMs = 60_000,
} = {}) {
  if (!root || typeof root !== 'string') throw new Error('An explicit private Tavern memory root is required.')
  if (!Number.isFinite(quotaBytes) || quotaBytes < 128) throw new Error('quotaBytes must be at least 128.')
  if (!Number.isFinite(segmentTargetBytes) || segmentTargetBytes < 256) throw new Error('segmentTargetBytes must be at least 256.')
  if (!Number.isFinite(leaseTtlMs) || leaseTtlMs < 1000 || leaseTtlMs > 10 * 60 * 1000) throw new Error('leaseTtlMs is outside the supported range.')
  const databasePath = path.join(path.resolve(root), 'tavern.sqlite')
  const extendedMemory = quotaBytes >= 1024 * 1024
  let database = null

  function db() {
    if (database) return database
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    const DatabaseSync = databaseSync()
    database = new DatabaseSync(databasePath)
    database.exec('PRAGMA page_size = 512;')
    database.exec(quotaBytes < 1024 * 1024 ? 'PRAGMA journal_mode = DELETE;' : 'PRAGMA journal_mode = WAL;')
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS tavern_conversations (
        owner_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        persona TEXT NOT NULL,
        generation INTEGER NOT NULL DEFAULT 1,
        revision INTEGER NOT NULL DEFAULT 0,
        turn_count INTEGER NOT NULL DEFAULT 0,
        next_sequence INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (owner_id, conversation_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS tavern_active_owner_persona
        ON tavern_conversations(owner_id, persona) WHERE active = 1 AND deleted_at IS NULL;
      CREATE TABLE IF NOT EXISTS tavern_turns (
        owner_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        turn_id TEXT NOT NULL,
        client_turn_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        content_bytes INTEGER NOT NULL,
        status TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        draw_json TEXT,
        provider TEXT,
        model TEXT,
        memory_json TEXT,
        lease_id TEXT,
        lease_expires_at INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, conversation_id, turn_id),
        UNIQUE (owner_id, conversation_id, sequence),
        UNIQUE (owner_id, conversation_id, client_turn_id, role),
        FOREIGN KEY (owner_id, conversation_id) REFERENCES tavern_conversations(owner_id, conversation_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS tavern_turns_page ON tavern_turns(owner_id, conversation_id, sequence DESC);
      CREATE INDEX IF NOT EXISTS tavern_turns_inflight ON tavern_turns(owner_id, conversation_id, status, role);
    `)
    if (extendedMemory) database.exec(`
      CREATE TABLE IF NOT EXISTS tavern_segments (
        owner_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        first_sequence INTEGER NOT NULL,
        last_sequence INTEGER NOT NULL,
        source_checksum TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        terms_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, conversation_id, segment_id),
        FOREIGN KEY (owner_id, conversation_id) REFERENCES tavern_conversations(owner_id, conversation_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS tavern_segment_terms (
        owner_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        term TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        first_sequence INTEGER NOT NULL,
        last_sequence INTEGER NOT NULL,
        PRIMARY KEY (owner_id, conversation_id, term, segment_id)
      );
      CREATE INDEX IF NOT EXISTS tavern_segment_terms_lookup
        ON tavern_segment_terms(owner_id, conversation_id, term, last_sequence DESC);
      CREATE TABLE IF NOT EXISTS tavern_imports (
        owner_id TEXT NOT NULL,
        persona TEXT NOT NULL,
        import_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, persona, import_id)
      );
    `)
    return database
  }

  function timestamp() {
    return new Date(Number(now())).toISOString()
  }

  function conversationRow(databaseHandle, ownerId, conversationId) {
    const row = databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND conversation_id = ?').get(ownerId, conversationId)
    if (!row) throw memoryError(404, 'tavern_conversation_not_found', 'This Tavern conversation is not available.')
    if (row.deleted_at) throw memoryError(410, 'tavern_conversation_deleted', 'This Tavern conversation was deleted and cannot be restored.')
    return row
  }

  function boundConversation(databaseHandle, ownerId, persona, conversationId) {
    const row = conversationRow(databaseHandle, ownerId, conversationId)
    if (String(row.persona) !== persona) throw memoryError(409, 'tavern_conversation_persona_mismatch', 'This conversation belongs to another Tavern persona.')
    return row
  }

  function storedBytes(databaseHandle, ownerId, conversationId) {
    const row = databaseHandle.prepare(`
      SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS bytes
      FROM tavern_turns WHERE owner_id = ? AND conversation_id = ?
    `).get(ownerId, conversationId)
    return Number(row?.bytes) || 0
  }

  function ownerStoredBytes(databaseHandle, ownerId) {
    const row = databaseHandle.prepare(`
      SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS bytes
      FROM tavern_turns WHERE owner_id = ?
    `).get(ownerId)
    return Number(row?.bytes) || 0
  }

  function assertQuota(databaseHandle, ownerId, conversationId, additionalBytes) {
    if (storedBytes(databaseHandle, ownerId, conversationId) + additionalBytes > quotaBytes
      || ownerStoredBytes(databaseHandle, ownerId) + additionalBytes > quotaBytes) {
      throw memoryError(413, 'tavern_storage_quota_exceeded', 'Tavern memory storage quota is full. Your draft was not committed.', { retryable: false })
    }
  }

  function physicalStorageBytes() {
    return ['', '-wal', '-shm']
      .map((suffix) => `${databasePath}${suffix}`)
      .filter((file) => fs.existsSync(file))
      .reduce((total, file) => total + fs.statSync(file).size, 0)
  }

  function assertPhysicalStorageBudget() {
    const usage = physicalStorageBytes()
    if (usage > quotaBytes) throw memoryError(413, 'tavern_physical_quota_exceeded', 'Tavern memory physical storage quota is full. Your draft was not committed.')
    const stat = fs.statfsSync(path.dirname(databasePath))
    const freeBytes = Number(stat.bavail) * Number(stat.bsize)
    if (!Number.isFinite(freeBytes) || freeBytes < Math.max(16 * 1024 * 1024, quotaBytes - usage)) {
      throw memoryError(507, 'tavern_storage_headroom_insufficient', 'Tavern memory storage does not have safe disk headroom.')
    }
  }

  function storageTransaction(databaseHandle, operation) {
    try {
      const result = transaction(databaseHandle, () => {
        const value = operation()
        assertPhysicalStorageBudget()
        return value
      })
      if (quotaBytes >= 1024 * 1024 && physicalStorageBytes() > quotaBytes * 0.75) databaseHandle.exec('PRAGMA wal_checkpoint(PASSIVE)')
      return result
    } catch (error) {
      try { databaseHandle.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch { /* Preserve the original storage error. */ }
      throw error
    }
  }

  function appendImportedMessages(databaseHandle, row, messages, importId, payloadHash) {
    if (!extendedMemory) throw memoryError(413, 'tavern_storage_quota_exceeded', 'This physical Tavern quota cannot support legacy import metadata.')
    const existing = databaseHandle.prepare('SELECT * FROM tavern_imports WHERE owner_id = ? AND persona = ? AND import_id = ?').get(row.owner_id, row.persona, importId)
    if (existing) {
      if (existing.status === 'deleted') throw memoryError(410, 'tavern_import_deleted', 'This legacy import belonged to a deleted conversation.')
      if (existing.payload_hash !== payloadHash) throw memoryError(409, 'tavern_import_idempotency_conflict', 'This legacy import ID was reused with different messages.')
      if (existing.conversation_id !== row.conversation_id) throw memoryError(409, 'tavern_import_conversation_conflict', 'This legacy import is already bound to another conversation.')
      return row
    }
    if (!Array.isArray(messages)) throw memoryError(400, 'tavern_legacy_import_invalid', 'Legacy import messages must be an array.')
    const normalized = messages.map((message) => {
      if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
        throw memoryError(400, 'tavern_legacy_import_invalid', 'Legacy import contains a non-canonical message.')
      }
      return { role: message.role, content: cleanContent(message.content) }
    })
    const additionalBytes = normalized.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0)
    if (additionalBytes > MAX_LEGACY_IMPORT_BYTES) throw memoryError(413, 'tavern_legacy_import_too_large', 'Legacy Tavern import exceeds the bounded migration payload.')
    assertQuota(databaseHandle, row.owner_id, row.conversation_id, additionalBytes)
    let sequence = Number(row.next_sequence)
    const nowText = timestamp()
    const insert = databaseHandle.prepare(`
      INSERT INTO tavern_turns
        (owner_id, conversation_id, sequence, turn_id, client_turn_id, role, content, content_bytes, status, request_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?)
    `)
    normalized.forEach((message, index) => {
      const clientTurnId = `legacy-${importId}-${Math.floor(index / 2)}`.slice(0, 180)
      insert.run(row.owner_id, row.conversation_id, sequence, `legacy-${importId}-${index}`.slice(0, 180), clientTurnId, message.role, message.content, Buffer.byteLength(message.content, 'utf8'), payloadHash, nowText, nowText)
      sequence += 1
    })
    databaseHandle.prepare(`
      UPDATE tavern_conversations SET revision = revision + 1, turn_count = turn_count + ?, next_sequence = ?, updated_at = ?
      WHERE owner_id = ? AND conversation_id = ?
    `).run(normalized.length, sequence, nowText, row.owner_id, row.conversation_id)
    databaseHandle.prepare(`
      INSERT INTO tavern_imports (owner_id, persona, import_id, payload_hash, conversation_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'complete', ?)
    `).run(row.owner_id, row.persona, importId, payloadHash, row.conversation_id, nowText)
    return databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND conversation_id = ?').get(row.owner_id, row.conversation_id)
  }

  function buildSegments(databaseHandle, ownerId, conversationId) {
    if (!extendedMemory) return
    const last = databaseHandle.prepare('SELECT COALESCE(MAX(last_sequence), 0) AS last_sequence FROM tavern_segments WHERE owner_id = ? AND conversation_id = ?').get(ownerId, conversationId)
    const rows = databaseHandle.prepare(`
      SELECT sequence, role, content FROM tavern_turns
      WHERE owner_id = ? AND conversation_id = ? AND sequence > ? AND status = 'complete'
      ORDER BY sequence ASC LIMIT 2000
    `).all(ownerId, conversationId, Number(last?.last_sequence) || 0)
    let batch = []
    let bytes = 0
    const insert = databaseHandle.prepare(`
      INSERT OR IGNORE INTO tavern_segments
        (owner_id, conversation_id, segment_id, first_sequence, last_sequence, source_checksum, summary_text, terms_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const flush = (force = false) => {
      if (!batch.length || (!force && bytes < segmentTargetBytes)) return false
      const first = Number(batch[0].sequence)
      const final = Number(batch.at(-1).sequence)
      const sourceChecksum = crypto.createHash('sha256').update(batch.map((row) => `${row.sequence}|${row.role}|${row.content}`).join('\n')).digest('hex')
      const summary = extractiveSummary(batch)
      const segmentId = `${first}-${final}`
      const terms = [...new Set(batch.flatMap((row) => tokenize(row.content)))].slice(0, 200)
      insert.run(ownerId, conversationId, segmentId, first, final, sourceChecksum, summary, terms.join(' '), timestamp())
      const insertTerm = databaseHandle.prepare(`
        INSERT OR IGNORE INTO tavern_segment_terms
          (owner_id, conversation_id, term, segment_id, first_sequence, last_sequence)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      terms.forEach((term) => insertTerm.run(ownerId, conversationId, term, segmentId, first, final))
      batch = []
      bytes = 0
      return true
    }
    for (const row of rows) {
      batch.push(row)
      bytes += Buffer.byteLength(String(row.content || ''), 'utf8')
      if (bytes >= segmentTargetBytes) flush()
    }
    if (rows.length === 2000) flush(true)
  }

  function resumeConversation({ ownerId: ownerInput, persona: personaInput, conversationId: conversationInput = '', legacyImport = null } = {}) {
    const ownerId = ownerValue(ownerInput)
    const persona = personaValue(personaInput)
    const conversationId = boundedId(conversationInput, 'tavern_conversation_id_invalid', 'conversationId', { optional: true })
    const databaseHandle = db()
    const result = storageTransaction(databaseHandle, () => {
      let row = conversationId
        ? conversationRow(databaseHandle, ownerId, conversationId)
        : databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND persona = ? AND active = 1 AND deleted_at IS NULL').get(ownerId, persona)
      if (row && row.persona !== persona) throw memoryError(409, 'tavern_conversation_persona_mismatch', 'This conversation belongs to another Tavern persona.')
      if (!row) {
        const id = String(randomUUID()).toLowerCase()
        const nowText = timestamp()
        const generationRow = databaseHandle.prepare('SELECT COALESCE(MAX(generation), 0) AS generation FROM tavern_conversations WHERE owner_id = ? AND persona = ?').get(ownerId, persona)
        const generation = (Number(generationRow?.generation) || 0) + 1
        try {
          databaseHandle.prepare(`
            INSERT INTO tavern_conversations
              (owner_id, conversation_id, persona, generation, revision, turn_count, next_sequence, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 0, 1, 1, ?, ?)
          `).run(ownerId, id, persona, generation, nowText, nowText)
          row = databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND conversation_id = ?').get(ownerId, id)
        } catch (error) {
          row = databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND persona = ? AND active = 1 AND deleted_at IS NULL').get(ownerId, persona)
          if (!row) throw error
        }
      }
      if (legacyImport) {
        const importId = boundedId(legacyImport.importId, 'tavern_import_id_invalid', 'legacyImport.importId')
        const payloadHash = hashJson(legacyImport.messages)
        row = appendImportedMessages(databaseHandle, row, legacyImport.messages, importId, payloadHash)
      }
      return row
    })
    buildSegments(databaseHandle, ownerId, result.conversation_id)
    return publicConversation(result)
  }

  function beginTurn({ ownerId: ownerInput, persona: personaInput, conversationId: conversationInput, clientTurnId: clientInput, expectedRevision, message, requestHash, draw = null } = {}) {
    const ownerId = ownerValue(ownerInput)
    const persona = personaValue(personaInput)
    const conversationId = boundedId(conversationInput, 'tavern_conversation_id_invalid', 'conversationId')
    const clientTurnId = boundedId(clientInput, 'tavern_client_turn_id_invalid', 'clientTurnId')
    const cleanMessage = cleanContent(message)
    const hash = boundedId(requestHash, 'tavern_request_hash_invalid', 'requestHash')
    const databaseHandle = db()
    return storageTransaction(databaseHandle, () => {
      const row = boundConversation(databaseHandle, ownerId, persona, conversationId)
      const existingUser = databaseHandle.prepare(`
        SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'user'
      `).get(ownerId, conversationId, clientTurnId)
      if (existingUser) {
        if (existingUser.request_hash !== hash || existingUser.content !== cleanMessage) {
          throw memoryError(409, 'tavern_turn_idempotency_conflict', 'This clientTurnId is already bound to a different request.')
        }
        const existingAssistant = databaseHandle.prepare(`
          SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'assistant'
        `).get(ownerId, conversationId, clientTurnId)
        if (existingAssistant.status === 'complete') {
          return {
            replay: true,
            providerCallRequired: false,
            conversation: publicConversation(row),
            turns: [publicTurn(existingUser), publicTurn(existingAssistant)],
            provider: String(existingAssistant.provider || ''),
            model: String(existingAssistant.model || ''),
            draw: existingUser.draw_json ? JSON.parse(String(existingUser.draw_json)) : null,
            memory: existingAssistant.memory_json ? JSON.parse(String(existingAssistant.memory_json)) : null,
          }
        }
        if (existingAssistant.status === 'pending' && Number(existingAssistant.lease_expires_at) > Number(now())) {
          throw memoryError(409, 'tavern_turn_in_progress', 'This Tavern turn is already being processed.', { retryable: true })
        }
        const leaseId = String(randomUUID()).toLowerCase()
        const nowText = timestamp()
        databaseHandle.prepare(`
          UPDATE tavern_turns SET content = '', content_bytes = 0, status = 'pending', provider = NULL, model = NULL, memory_json = NULL, lease_id = ?, lease_expires_at = ?, updated_at = ?
          WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'assistant'
        `).run(leaseId, Number(now()) + leaseTtlMs, nowText, ownerId, conversationId, clientTurnId)
        databaseHandle.prepare(`
          UPDATE tavern_conversations SET revision = revision + 1, updated_at = ?
          WHERE owner_id = ? AND conversation_id = ?
        `).run(nowText, ownerId, conversationId)
        const nextRow = databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND conversation_id = ?').get(ownerId, conversationId)
        const retryAssistant = databaseHandle.prepare(`
          SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'assistant'
        `).get(ownerId, conversationId, clientTurnId)
        return {
          replay: true,
          providerCallRequired: true,
          leaseId,
          conversation: publicConversation(nextRow),
          turns: [publicTurn(existingUser), publicTurn(retryAssistant)],
          draw: existingUser.draw_json ? JSON.parse(String(existingUser.draw_json)) : null,
        }
      }
      const otherPending = databaseHandle.prepare(`
        SELECT client_turn_id FROM tavern_turns
        WHERE owner_id = ? AND conversation_id = ? AND role = 'assistant' AND status = 'pending'
        LIMIT 1
      `).get(ownerId, conversationId)
      if (otherPending) throw memoryError(409, 'tavern_turn_in_progress', 'Another Tavern turn is already being processed.', { retryable: true })
      if (!Number.isInteger(expectedRevision) || Number(expectedRevision) !== Number(row.revision)) {
        throw memoryError(409, 'tavern_conversation_revision_conflict', 'The Tavern conversation changed on another client.', { currentRevision: Number(row.revision) })
      }
      assertQuota(databaseHandle, ownerId, conversationId, Buffer.byteLength(cleanMessage, 'utf8'))
      const nowText = timestamp()
      const leaseId = String(randomUUID()).toLowerCase()
      const userSequence = Number(row.next_sequence)
      const assistantSequence = userSequence + 1
      const insert = databaseHandle.prepare(`
        INSERT INTO tavern_turns
          (owner_id, conversation_id, sequence, turn_id, client_turn_id, role, content, content_bytes, status, request_hash, draw_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      insert.run(ownerId, conversationId, userSequence, `${clientTurnId}:user`, clientTurnId, 'user', cleanMessage, Buffer.byteLength(cleanMessage, 'utf8'), 'complete', hash, draw ? JSON.stringify(draw) : null, nowText, nowText)
      databaseHandle.prepare(`
        INSERT INTO tavern_turns
          (owner_id, conversation_id, sequence, turn_id, client_turn_id, role, content, content_bytes, status, request_hash, lease_id, lease_expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'assistant', '', 0, 'pending', ?, ?, ?, ?, ?)
      `).run(ownerId, conversationId, assistantSequence, `${clientTurnId}:assistant`, clientTurnId, hash, leaseId, Number(now()) + leaseTtlMs, nowText, nowText)
      databaseHandle.prepare(`
        UPDATE tavern_conversations SET revision = revision + 1, turn_count = turn_count + 2, next_sequence = ?, updated_at = ?
        WHERE owner_id = ? AND conversation_id = ?
      `).run(assistantSequence + 1, nowText, ownerId, conversationId)
      const nextRow = databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND conversation_id = ?').get(ownerId, conversationId)
      const turns = databaseHandle.prepare('SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? ORDER BY sequence').all(ownerId, conversationId, clientTurnId)
      return { replay: false, providerCallRequired: true, leaseId, conversation: publicConversation(nextRow), turns: turns.map(publicTurn), draw }
    })
  }

  function replayCompletedTurn({ ownerId: ownerInput, persona: personaInput, conversationId: conversationInput, clientTurnId: clientInput, message, requestHash } = {}) {
    const ownerId = ownerValue(ownerInput)
    const persona = personaValue(personaInput)
    const conversationId = boundedId(conversationInput, 'tavern_conversation_id_invalid', 'conversationId')
    const clientTurnId = boundedId(clientInput, 'tavern_client_turn_id_invalid', 'clientTurnId')
    const cleanMessage = cleanContent(message)
    const hash = boundedId(requestHash, 'tavern_request_hash_invalid', 'requestHash')
    const databaseHandle = db()
    const row = boundConversation(databaseHandle, ownerId, persona, conversationId)
    const user = databaseHandle.prepare(`
      SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'user'
    `).get(ownerId, conversationId, clientTurnId)
    if (!user) return null
    if (user.request_hash !== hash || user.content !== cleanMessage) {
      throw memoryError(409, 'tavern_turn_idempotency_conflict', 'This clientTurnId is already bound to a different request.')
    }
    const assistant = databaseHandle.prepare(`
      SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'assistant'
    `).get(ownerId, conversationId, clientTurnId)
    if (!assistant || assistant.status !== 'complete') return null
    return {
      conversation: publicConversation(row),
      turns: [publicTurn(user), publicTurn(assistant)],
      provider: String(assistant.provider || ''),
      model: String(assistant.model || ''),
      draw: user.draw_json ? JSON.parse(String(user.draw_json)) : null,
      memory: assistant.memory_json ? JSON.parse(String(assistant.memory_json)) : null,
    }
  }

  function settleTurn({ ownerId: ownerInput, persona: personaInput, conversationId: conversationInput, clientTurnId: clientInput, assistantContent = '', status, leaseId: leaseInput = '', provider = '', model = '', memory = null }) {
    const ownerId = ownerValue(ownerInput)
    const persona = personaValue(personaInput)
    const conversationId = boundedId(conversationInput, 'tavern_conversation_id_invalid', 'conversationId')
    const clientTurnId = boundedId(clientInput, 'tavern_client_turn_id_invalid', 'clientTurnId')
    const leaseId = boundedId(leaseInput, 'tavern_turn_lease_invalid', 'leaseId')
    const content = assistantContent ? cleanContent(assistantContent) : ''
    const databaseHandle = db()
    const result = storageTransaction(databaseHandle, () => {
      const row = boundConversation(databaseHandle, ownerId, persona, conversationId)
      const assistant = databaseHandle.prepare(`
        SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'assistant'
      `).get(ownerId, conversationId, clientTurnId)
      if (!assistant) throw memoryError(404, 'tavern_turn_not_found', 'This Tavern turn is not available.')
      if (assistant.status === 'complete') {
        const turns = databaseHandle.prepare('SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? ORDER BY sequence').all(ownerId, conversationId, clientTurnId)
        const user = turns.find((turn) => turn.role === 'user')
        return { conversation: publicConversation(row), turns: turns.map(publicTurn), replay: true, provider: String(assistant.provider || ''), model: String(assistant.model || ''), draw: user?.draw_json ? JSON.parse(String(user.draw_json)) : null, memory: assistant.memory_json ? JSON.parse(String(assistant.memory_json)) : null }
      }
      if (String(assistant.lease_id || '') !== leaseId) throw memoryError(409, 'tavern_turn_lease_conflict', 'This Tavern turn lease is no longer current.')
      if (content) assertQuota(databaseHandle, ownerId, conversationId, Buffer.byteLength(content, 'utf8') - Buffer.byteLength(String(assistant.content || ''), 'utf8'))
      const nowText = timestamp()
      databaseHandle.prepare(`
        UPDATE tavern_turns SET content = ?, content_bytes = ?, status = ?, provider = ?, model = ?, memory_json = ?, lease_id = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? AND role = 'assistant'
      `).run(content, Buffer.byteLength(content, 'utf8'), status, String(provider || '').slice(0, 80), String(model || '').slice(0, 120), memory ? JSON.stringify(memory) : null, nowText, ownerId, conversationId, clientTurnId)
      databaseHandle.prepare(`
        UPDATE tavern_conversations SET revision = revision + 1, updated_at = ?
        WHERE owner_id = ? AND conversation_id = ?
      `).run(nowText, ownerId, conversationId)
      const nextRow = databaseHandle.prepare('SELECT * FROM tavern_conversations WHERE owner_id = ? AND conversation_id = ?').get(ownerId, conversationId)
      const turns = databaseHandle.prepare('SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND client_turn_id = ? ORDER BY sequence').all(ownerId, conversationId, clientTurnId)
      const user = turns.find((turn) => turn.role === 'user')
      const assistantNext = turns.find((turn) => turn.role === 'assistant')
      return { conversation: publicConversation(nextRow), turns: turns.map(publicTurn), replay: false, draw: user?.draw_json ? JSON.parse(String(user.draw_json)) : null, memory: assistantNext?.memory_json ? JSON.parse(String(assistantNext.memory_json)) : memory }
    })
    if (status === 'complete') buildSegments(databaseHandle, ownerId, conversationId)
    return result
  }

  function completeTurn(input) {
    return settleTurn({ ...input, status: 'complete' })
  }

  function failTurn(input) {
    const status = ['partial', 'unavailable', 'interrupted'].includes(input?.status) ? input.status : 'unavailable'
    return settleTurn({ ...input, status })
  }

  function getMessages({ ownerId: ownerInput, persona: personaInput, conversationId: conversationInput, before = '', limit = 40 } = {}) {
    const ownerId = ownerValue(ownerInput)
    const persona = personaValue(personaInput)
    const conversationId = boundedId(conversationInput, 'tavern_conversation_id_invalid', 'conversationId')
    const pageLimit = Math.max(1, Math.min(MAX_PAGE_LIMIT, Number.parseInt(String(limit || 40), 10) || 40))
    const beforeSequence = decodeCursor(before)
    const databaseHandle = db()
    const row = boundConversation(databaseHandle, ownerId, persona, conversationId)
    const headers = databaseHandle.prepare(`
      SELECT sequence, content_bytes FROM tavern_turns
      WHERE owner_id = ? AND conversation_id = ? AND sequence < ?
      ORDER BY sequence DESC LIMIT ?
    `).all(ownerId, conversationId, beforeSequence || Number.MAX_SAFE_INTEGER, pageLimit)
    const selectedSequences = []
    let estimatedBytes = 1024
    for (const header of headers) {
      const rowBytes = Number(header.content_bytes) + 512
      if (estimatedBytes + rowBytes > MAX_PAGE_SERIALIZED_BYTES) break
      selectedSequences.push(Number(header.sequence))
      estimatedBytes += rowBytes
    }
    const selectTurn = databaseHandle.prepare('SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND sequence = ?')
    let messages = selectedSequences.map((sequence) => selectTurn.get(ownerId, conversationId, sequence)).filter(Boolean).reverse().map(publicTurn)
    let nextBefore = messages.length && messages[0].sequence > 1 ? encodeCursor(messages[0].sequence) : null
    const conversation = publicConversation(row)
    while (messages.length > 1 && Buffer.byteLength(JSON.stringify({ conversation, messages, nextBefore }), 'utf8') > MAX_PAGE_SERIALIZED_BYTES) {
      messages = messages.slice(1)
      nextBefore = messages[0]?.sequence > 1 ? encodeCursor(messages[0].sequence) : null
    }
    return { conversation, messages, nextBefore }
  }

  function relevantSegments(databaseHandle, ownerId, conversationId, query) {
    if (!extendedMemory) return []
    const terms = tokenize(query)
    if (!terms.length) return []
    const placeholders = terms.map(() => '?').join(', ')
    const candidates = databaseHandle.prepare(`
      SELECT segments.*, COUNT(DISTINCT terms.term) AS score
      FROM tavern_segment_terms AS terms
      JOIN tavern_segments AS segments
        ON segments.owner_id = terms.owner_id
       AND segments.conversation_id = terms.conversation_id
       AND segments.segment_id = terms.segment_id
      WHERE terms.owner_id = ? AND terms.conversation_id = ? AND terms.term IN (${placeholders})
      GROUP BY segments.owner_id, segments.conversation_id, segments.segment_id
      ORDER BY score DESC, segments.last_sequence DESC
      LIMIT 8
    `).all(ownerId, conversationId, ...terms)
    return candidates.map((row) => {
        const sourceRows = databaseHandle.prepare(`
          SELECT sequence, role, content FROM tavern_turns
          WHERE owner_id = ? AND conversation_id = ? AND sequence BETWEEN ? AND ? AND status = 'complete'
          ORDER BY sequence ASC LIMIT 2000
        `).all(ownerId, conversationId, Number(row.first_sequence), Number(row.last_sequence))
        const exactSnippets = sourceRows
          .filter((turn) => terms.some((term) => String(turn.content || '').normalize('NFKC').toLowerCase().includes(term)))
          .slice(0, 8)
          .map((turn) => `[turn ${turn.sequence} ${turn.role}] ${String(turn.content || '').replace(/\s+/g, ' ').trim().slice(0, 320)}`)
        return {
          segmentId: String(row.segment_id),
          firstSequence: Number(row.first_sequence),
          lastSequence: Number(row.last_sequence),
          sourceChecksum: String(row.source_checksum),
          summary: exactSnippets.join(' | ') || String(row.summary_text),
        }
      })
  }

  function contextForProvider({ ownerId: ownerInput, persona: personaInput, conversationId: conversationInput, model, protocol = 'chat-completions', metadata = null, currentMessage, systemPrompt, contextWindowOverride = null, maxOutboundBytes = TAVERN_MEMORY_MAX_PROVIDER_BYTES, excludeClientTurnId = '' } = {}) {
    const ownerId = ownerValue(ownerInput)
    const persona = personaValue(personaInput)
    const conversationId = boundedId(conversationInput, 'tavern_conversation_id_invalid', 'conversationId')
    const databaseHandle = db()
    const row = boundConversation(databaseHandle, ownerId, persona, conversationId)
    const modelWindow = Number.isInteger(contextWindowOverride) ? contextWindowOverride : tavernModelContextWindow(model).tokens
    const readByteLimit = Math.min(maxOutboundBytes, Math.max(16 * 1024, modelWindow))
    const recent = []
    let before = Number(row.next_sequence)
    let bytes = 0
    const selectTurn = databaseHandle.prepare('SELECT * FROM tavern_turns WHERE owner_id = ? AND conversation_id = ? AND sequence = ?')
    let recentBudgetReached = false
    while (before > 1 && bytes < readByteLimit) {
      const page = databaseHandle.prepare(`
        SELECT sequence, content_bytes FROM tavern_turns
        WHERE owner_id = ? AND conversation_id = ? AND sequence < ? AND status = 'complete' AND client_turn_id != ?
        ORDER BY sequence DESC LIMIT 40
      `).all(ownerId, conversationId, before, String(excludeClientTurnId || ''))
      if (!page.length) break
      for (const header of page) {
        const contentBytes = Number(header.content_bytes) || 0
        if (bytes + contentBytes > readByteLimit) {
          recentBudgetReached = true
          break
        }
        const turn = selectTurn.get(ownerId, conversationId, Number(header.sequence))
        if (!turn) continue
        bytes += contentBytes
        recent.push(publicTurn(turn))
      }
      before = Number(page.at(-1).sequence)
      if (recentBudgetReached) break
    }
    recent.reverse()
    return selectTavernProviderContext({
      model,
      protocol,
      metadata,
      systemPrompt,
      currentMessage,
      recentMessages: recent,
      retrievedSegments: relevantSegments(databaseHandle, ownerId, conversationId, currentMessage),
      sourceHistoryTruncated: recentBudgetReached || before > 1,
      contextWindowOverride,
      maxOutboundBytes,
    })
  }

  function deleteConversation({ ownerId: ownerInput, persona: personaInput, conversationId: conversationInput } = {}) {
    const ownerId = ownerValue(ownerInput)
    const persona = personaValue(personaInput)
    const conversationId = boundedId(conversationInput, 'tavern_conversation_id_invalid', 'conversationId')
    const databaseHandle = db()
    storageTransaction(databaseHandle, () => {
      boundConversation(databaseHandle, ownerId, persona, conversationId)
      if (extendedMemory) {
        databaseHandle.prepare('DELETE FROM tavern_segment_terms WHERE owner_id = ? AND conversation_id = ?').run(ownerId, conversationId)
        databaseHandle.prepare('DELETE FROM tavern_segments WHERE owner_id = ? AND conversation_id = ?').run(ownerId, conversationId)
      }
      databaseHandle.prepare('DELETE FROM tavern_turns WHERE owner_id = ? AND conversation_id = ?').run(ownerId, conversationId)
      if (extendedMemory) databaseHandle.prepare("UPDATE tavern_imports SET status = 'deleted' WHERE owner_id = ? AND persona = ? AND conversation_id = ?").run(ownerId, persona, conversationId)
      const nowText = timestamp()
      databaseHandle.prepare(`
        UPDATE tavern_conversations
        SET active = 0, deleted_at = ?, updated_at = ?, revision = revision + 1, turn_count = 0, next_sequence = 1
        WHERE owner_id = ? AND conversation_id = ?
      `).run(nowText, nowText, ownerId, conversationId)
    })
    databaseHandle.exec('PRAGMA wal_checkpoint(PASSIVE)')
    return { deleted: true, conversationId }
  }

  function close() {
    database?.close()
    database = null
  }

  return Object.freeze({
    databasePath,
    resumeConversation,
    beginTurn,
    replayCompletedTurn,
    completeTurn,
    failTurn,
    getMessages,
    contextForProvider,
    deleteConversation,
    close,
  })
}
