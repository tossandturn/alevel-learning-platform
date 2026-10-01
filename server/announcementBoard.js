import crypto from 'node:crypto'

export const STEM_ANNOUNCEMENT_PROTOCOL = 'stem-announcements-v1'

const MAX_LIST_LIMIT = 30
const MAX_LIST_OFFSET = 100000
const MAX_TITLE_LENGTH = 90
const MAX_SUMMARY_LENGTH = 180
const MAX_BODY_LENGTH = 6000
const MAX_ACTION_LABEL_LENGTH = 30
const MAX_ACTION_URL_LENGTH = 260
const VALID_CATEGORIES = new Set(['system', 'feature', 'learning', 'service'])
const VALID_STATUSES = new Set(['draft', 'published', 'archived'])
const ALLOWED_ACTION_QUERY_KEYS = new Set(['board', 'category', 'course', 'family', 'level', 'mode', 'module', 'paper', 'routeId', 'session', 'stage', 'subject', 'subjectCode', 'year'])
const ALLOWED_ACTION_PATHS = new Set([
  '/pages/index/index',
  '/pages/practice/index',
  '/pages/papers/index',
  '/pages/calculator/index',
  '/pages/coach/index',
  '/pages/progress/index',
  '/pages/notebook/index',
  '/pages/stem/capture',
  '/pages/stem/camera',
  '/pages/stem/topics',
  '/pages/stem/practice',
  '/pages/stem/paper',
  '/pages/stem/coach',
  '/pages/ielts/listening',
  '/pages/ielts/library',
  '/pages/ielts/home',
  '/pages/ielts/exam',
  '/pages/ielts/vocabulary',
  '/pages/ielts/reading',
  '/pages/ielts/writing',
  '/pages/ielts/writing-full',
  '/pages/ielts/speaking',
  '/bundles/curricula/index',
  '/bundles/marking/index',
])
const INITIAL_ANNOUNCEMENT_ID = 'system-announcement-board-v1'

function boardError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}

function singleLine(value, maxLength, field, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw boardError(`announcement_${field}_required`, `${field} is required.`)
    return ''
  }
  if (typeof value !== 'string') throw boardError(`announcement_${field}_invalid`, `${field} must be text.`)
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().normalize('NFC')
  if (required && !normalized) throw boardError(`announcement_${field}_required`, `${field} is required.`)
  if (normalized.length > maxLength) throw boardError(`announcement_${field}_too_long`, `${field} is too long.`)
  return normalized
}

function bodyText(value, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw boardError('announcement_body_required', 'body is required.')
    return ''
  }
  if (typeof value !== 'string') throw boardError('announcement_body_invalid', 'body must be text.')
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .normalize('NFC')
  if (required && !normalized) throw boardError('announcement_body_required', 'body is required.')
  if (normalized.length > MAX_BODY_LENGTH) throw boardError('announcement_body_too_long', 'body is too long.')
  return normalized
}

function summaryFromBody(body) {
  return body.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_LENGTH)
}

export function isSafeAnnouncementRoute(value) {
  try {
    if (typeof value !== 'string' || value.length < 2 || value.length > MAX_ACTION_URL_LENGTH || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false
    const parsed = new URL(value, 'https://stemist.invalid')
    if (parsed.origin !== 'https://stemist.invalid' || parsed.hash || !ALLOWED_ACTION_PATHS.has(parsed.pathname)) return false
    for (const [key, routeValue] of parsed.searchParams) {
      if (!ALLOWED_ACTION_QUERY_KEYS.has(key) || routeValue.length > 100 || /[\u0000-\u001f\u007f]/.test(routeValue)) return false
    }
    return true
  } catch {
    return false
  }
}

function normalizeAction(value) {
  if (value == null || value === '') return null
  if (!isPlainObject(value)) throw boardError('announcement_action_invalid', 'action must contain an in-app label and route.')
  const keys = Object.keys(value)
  if (keys.some((key) => !['label', 'url'].includes(key))) throw boardError('announcement_action_invalid', 'action fields are not supported.')
  const label = singleLine(value.label, MAX_ACTION_LABEL_LENGTH, 'action_label')
  const url = singleLine(value.url, MAX_ACTION_URL_LENGTH, 'action_url')
  if (!label && !url) return null
  if (!label || !url || !isSafeAnnouncementRoute(url)) throw boardError('announcement_action_invalid', 'action must use a permitted in-app route.')
  return { label, url }
}

function normalizeCategory(value) {
  const category = String(value || 'system').trim().toLowerCase()
  if (!VALID_CATEGORIES.has(category)) throw boardError('announcement_category_invalid', 'announcement category is not supported.')
  return category
}

function normalizeStatus(value, { allowArchived = true } = {}) {
  const status = String(value || 'draft').trim().toLowerCase()
  if (!VALID_STATUSES.has(status) || (!allowArchived && status === 'archived')) throw boardError('announcement_status_invalid', 'announcement status is not supported.')
  return status
}

function normalizeExpiresAt(value, now) {
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > 80) throw boardError('announcement_expiry_invalid', 'expiry must be an ISO timestamp.')
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp <= Date.parse(now)) throw boardError('announcement_expiry_invalid', 'expiry must be in the future.')
  return new Date(timestamp).toISOString()
}

function limit(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return 10
  return Math.min(parsed, MAX_LIST_LIMIT)
}

function offset(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return 0
  return Math.min(parsed, MAX_LIST_OFFSET)
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : new Date().toISOString()
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString()
}

function publicAnnouncement(row, { includeStatus = false, includeReadAt = false } = {}) {
  const action = row.action_label && row.action_url ? { label: row.action_label, url: row.action_url } : null
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    body: row.body,
    category: row.category,
    pinned: Boolean(row.pinned),
    publishedAt: row.published_at || null,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at || null,
    action,
    ...(includeReadAt ? { readAt: row.read_at || null } : {}),
    ...(includeStatus ? { status: row.status, archivedAt: row.archived_at || null, createdAt: row.created_at } : {}),
  }
}

function ensureAnnouncementSchema(database, now) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      action_label TEXT,
      action_url TEXT,
      published_at TEXT,
      expires_at TEXT,
      created_by_user_id TEXT NOT NULL,
      updated_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_public ON announcements(status, pinned DESC, published_at DESC);
    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (announcement_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id, read_at DESC);
  `)
  const exists = database.prepare('SELECT 1 FROM announcements WHERE id = ?').get(INITIAL_ANNOUNCEMENT_ID)
  if (exists) return
  const createdAt = nowIso(now)
  database.prepare(`
    INSERT INTO announcements (
      id, title, summary, body, category, pinned, status, action_label, action_url,
      published_at, expires_at, created_by_user_id, updated_by_user_id, created_at, updated_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    INITIAL_ANNOUNCEMENT_ID,
    '公告中心已上线',
    '课程更新、资料状态和服务通知会集中发布在这里。',
    '你可以在首页查看最新公告。管理员可发布、置顶、下线公告，并为学生提供安全的站内跳转。',
    'feature',
    1,
    'published',
    '查看学习入口',
    '/pages/practice/index?category=alevel',
    createdAt,
    null,
    'system',
    'system',
    createdAt,
    createdAt,
    null,
  )
}

function activeAnnouncement(database, id, now) {
  return database.prepare(`
    SELECT * FROM announcements
    WHERE id = ? AND status = 'published' AND published_at IS NOT NULL AND published_at <= ?
      AND (expires_at IS NULL OR expires_at > ?)
  `).get(id, now, now)
}

function requiredActor(actor) {
  const id = singleLine(actor?.id, 120, 'actor', { required: true })
  return { id }
}

function createPayload(payload, now) {
  if (!isPlainObject(payload)) throw boardError('announcement_payload_invalid', 'announcement payload must be an object.')
  const title = singleLine(payload.title, MAX_TITLE_LENGTH, 'title', { required: true })
  const body = bodyText(payload.body, { required: true })
  const summary = singleLine(payload.summary || summaryFromBody(body), MAX_SUMMARY_LENGTH, 'summary', { required: true })
  const status = normalizeStatus(payload.status, { allowArchived: false })
  return {
    title,
    body,
    summary,
    category: normalizeCategory(payload.category),
    pinned: payload.pinned === true,
    status,
    action: normalizeAction(payload.action),
    expiresAt: normalizeExpiresAt(payload.expiresAt, now),
  }
}

function patchPayload(payload, current, now) {
  if (!isPlainObject(payload)) throw boardError('announcement_payload_invalid', 'announcement payload must be an object.')
  const allowed = new Set(['title', 'summary', 'body', 'category', 'pinned', 'status', 'action', 'expiresAt'])
  if (!Object.keys(payload).length || Object.keys(payload).some((key) => !allowed.has(key))) throw boardError('announcement_payload_invalid', 'announcement fields are not supported.')
  const next = {
    title: Object.hasOwn(payload, 'title') ? singleLine(payload.title, MAX_TITLE_LENGTH, 'title', { required: true }) : current.title,
    body: Object.hasOwn(payload, 'body') ? bodyText(payload.body, { required: true }) : current.body,
    summary: Object.hasOwn(payload, 'summary') ? singleLine(payload.summary, MAX_SUMMARY_LENGTH, 'summary', { required: true }) : current.summary,
    category: Object.hasOwn(payload, 'category') ? normalizeCategory(payload.category) : current.category,
    pinned: Object.hasOwn(payload, 'pinned') ? payload.pinned === true : Boolean(current.pinned),
    status: Object.hasOwn(payload, 'status') ? normalizeStatus(payload.status) : current.status,
    action: Object.hasOwn(payload, 'action') ? normalizeAction(payload.action) : (current.action_label && current.action_url ? { label: current.action_label, url: current.action_url } : null),
    expiresAt: Object.hasOwn(payload, 'expiresAt') ? normalizeExpiresAt(payload.expiresAt, now) : current.expires_at || null,
  }
  if (next.status === 'published' && next.expiresAt && Date.parse(next.expiresAt) <= Date.parse(now)) throw boardError('announcement_expiry_invalid', 'expiry must be in the future.')
  return next
}

export function createAnnouncementBoard({ database, now = () => new Date().toISOString() } = {}) {
  if (!database || typeof database.prepare !== 'function') throw new Error('Announcement storage is unavailable.')
  ensureAnnouncementSchema(database, now)

  return {
    listPublic({ limit: requestedLimit, offset: requestedOffset, userId = '' } = {}) {
      const current = nowIso(now)
      const pageLimit = limit(requestedLimit)
      const pageOffset = offset(requestedOffset)
      const readerId = typeof userId === 'string' ? userId : ''
      const total = Number(database.prepare(`
        SELECT COUNT(*) AS count FROM announcements
        WHERE status = 'published' AND published_at IS NOT NULL AND published_at <= ?
          AND (expires_at IS NULL OR expires_at > ?)
      `).get(current, current)?.count || 0)
      const rows = database.prepare(`
        SELECT announcements.*, announcement_reads.read_at
        FROM announcements
        LEFT JOIN announcement_reads
          ON announcement_reads.announcement_id = announcements.id AND announcement_reads.user_id = ?
        WHERE announcements.status = 'published' AND announcements.published_at IS NOT NULL AND announcements.published_at <= ?
          AND (announcements.expires_at IS NULL OR announcements.expires_at > ?)
        ORDER BY announcements.pinned DESC, announcements.published_at DESC, announcements.created_at DESC
        LIMIT ? OFFSET ?
      `).all(readerId, current, current, pageLimit, pageOffset)
      const hasMore = pageOffset + rows.length < total
      return {
        schemaVersion: STEM_ANNOUNCEMENT_PROTOCOL,
        items: rows.map((row) => publicAnnouncement(row, { includeReadAt: Boolean(readerId) })),
        total,
        offset: pageOffset,
        limit: pageLimit,
        hasMore,
        nextOffset: hasMore ? pageOffset + rows.length : null,
      }
    },
    listManage() {
      const rows = database.prepare(`
        SELECT * FROM announcements
        ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
          pinned DESC, updated_at DESC, created_at DESC
      `).all()
      return { schemaVersion: STEM_ANNOUNCEMENT_PROTOCOL, canManage: true, items: rows.map((row) => publicAnnouncement(row, { includeStatus: true })) }
    },
    create(actor, payload) {
      const owner = requiredActor(actor)
      const current = nowIso(now)
      const values = createPayload(payload, current)
      const id = `announcement-${crypto.randomUUID()}`
      const publishedAt = values.status === 'published' ? current : null
      database.prepare(`
        INSERT INTO announcements (
          id, title, summary, body, category, pinned, status, action_label, action_url,
          published_at, expires_at, created_by_user_id, updated_by_user_id, created_at, updated_at, archived_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, values.title, values.summary, values.body, values.category, values.pinned ? 1 : 0, values.status,
        values.action?.label || null, values.action?.url || null, publishedAt, values.expiresAt,
        owner.id, owner.id, current, current, null,
      )
      return publicAnnouncement(database.prepare('SELECT * FROM announcements WHERE id = ?').get(id), { includeStatus: true })
    },
    update(actor, id, payload) {
      const owner = requiredActor(actor)
      const announcementId = singleLine(id, 120, 'id', { required: true })
      const current = database.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId)
      if (!current) throw boardError('announcement_not_found', 'Announcement not found.', 404)
      const timestamp = nowIso(now)
      const values = patchPayload(payload, current, timestamp)
      const publishedAt = values.status === 'published' ? current.published_at || timestamp : null
      const archivedAt = values.status === 'archived' ? timestamp : null
      database.prepare(`
        UPDATE announcements
        SET title = ?, summary = ?, body = ?, category = ?, pinned = ?, status = ?, action_label = ?, action_url = ?,
          published_at = ?, expires_at = ?, updated_by_user_id = ?, updated_at = ?, archived_at = ?
        WHERE id = ?
      `).run(
        values.title, values.summary, values.body, values.category, values.pinned ? 1 : 0, values.status,
        values.action?.label || null, values.action?.url || null, publishedAt, values.expiresAt,
        owner.id, timestamp, archivedAt, announcementId,
      )
      return publicAnnouncement(database.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId), { includeStatus: true })
    },
    recordRead(actor, id) {
      const owner = requiredActor(actor)
      const announcementId = singleLine(id, 120, 'id', { required: true })
      const current = nowIso(now)
      if (!activeAnnouncement(database, announcementId, current)) throw boardError('announcement_not_found', 'Announcement not found.', 404)
      database.prepare(`
        INSERT INTO announcement_reads (announcement_id, user_id, read_at)
        VALUES (?, ?, ?)
        ON CONFLICT(announcement_id, user_id) DO UPDATE SET read_at = excluded.read_at
      `).run(announcementId, owner.id, current)
      return { announcementId, readAt: current }
    },
  }
}
