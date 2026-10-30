export const PDF_QUOTA_PROTOCOL = 'stemist-pdf-quota-v1'
export const PDF_FREE_DAILY_LIMIT = 2
const DAY_MS = 86400000, BEIJING_OFFSET_MS = 8 * 3600000
const account = value => {
  if (typeof value !== 'string' || !/^ielts:[1-9]\d{0,14}$/.test(value) || !Number.isSafeInteger(Number(value.slice(6)))) throw new Error('Invalid quota account')
  return value
}
const file = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid quota file identity')
  return value
}

export function beijingDownloadDay(value) {
  const now = Number(value)
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid quota time')
  const start = Math.floor((now + BEIJING_OFFSET_MS) / DAY_MS) * DAY_MS - BEIJING_OFFSET_MS
  return { day: new Date(start + BEIJING_OFFSET_MS).toISOString().slice(0, 10), resetAt: new Date(start + DAY_MS).toISOString() }
}

export function createPdfDownloadLedger({ database, clock = Date.now }) {
  // A second server connection may briefly own the write lock. Wait within a
  // small bound instead of turning a normal simultaneous download into a 503.
  database.exec('PRAGMA busy_timeout=2000')
  database.exec(`CREATE TABLE IF NOT EXISTS pdf_download_grants (
    user_id TEXT NOT NULL, beijing_day TEXT NOT NULL, file_sha256 TEXT NOT NULL,
    access_class TEXT NOT NULL CHECK(access_class IN ('free','member')),
    granted_at TEXT NOT NULL,
    PRIMARY KEY(user_id,beijing_day,file_sha256)
  );`)
  const find = database.prepare('SELECT access_class FROM pdf_download_grants WHERE user_id=? AND beijing_day=? AND file_sha256=?')
  const count = database.prepare("SELECT COUNT(*) AS used FROM pdf_download_grants WHERE user_id=? AND beijing_day=? AND access_class='free'")
  const insert = database.prepare('INSERT INTO pdf_download_grants(user_id,beijing_day,file_sha256,access_class,granted_at) VALUES(?,?,?,?,?)')
  function result(userId, period, unlimited, reused) {
    const used = Number(count.get(userId, period.day).used)
    return { protocol:PDF_QUOTA_PROTOCOL, timezone:'Asia/Shanghai', ...period, limit:PDF_FREE_DAILY_LIMIT, used, remaining:unlimited ? null : Math.max(0, PDF_FREE_DAILY_LIMIT-used), unlimited, reused, allowed:true }
  }
  function lookup({ userId, sha256 }) {
    account(userId);file(sha256)
    const period = beijingDownloadDay(clock())
    const prior = find.get(userId, period.day, sha256)
    // A prior grant proves this file is allowed, not that membership is still active.
    return prior ? {...result(userId, period, false, true), unlimited:null, remaining:null} : null
  }
  function grant({ userId, sha256, entitlement }) {
    account(userId);file(sha256)
    if (!entitlement || typeof entitlement.active !== 'boolean' || entitlement.active && !Number.isFinite(Date.parse(entitlement.expiresAt))) throw new Error('Invalid quota membership authority')
    database.exec('BEGIN IMMEDIATE')
    try {
      // Read time only after obtaining the write lock: requests waiting across
      // Beijing midnight belong to the day when their grant is actually made.
      const now = Number(clock()), period = beijingDownloadDay(now)
      const unlimited = entitlement.active && Date.parse(entitlement.expiresAt) > now
      const prior = find.get(userId, period.day, sha256)
      if (prior) {
        const existing = result(userId, period, unlimited, true)
        database.exec('COMMIT');return existing
      }
      const quota = result(userId, period, unlimited, false)
      if (!unlimited && quota.remaining === 0) {
        throw Object.assign(new Error('今日 2 份免费下载额度已用完，PDF 与听力音频合计；北京时间次日零点恢复，已缓存文件仍可打开。'), { statusCode:429, code:'pdf_daily_limit_reached', quota:{...quota,allowed:false}, headers:{'X-Pdf-Access-Code':'pdf_daily_limit_reached','X-Pdf-Quota-Limit':'2','X-Pdf-Quota-Remaining':'0','X-Pdf-Quota-Reset':period.resetAt,'Retry-After':String(Math.max(1,Math.ceil((Date.parse(period.resetAt)-now)/1000)))} })
      }
      insert.run(userId, period.day, sha256, unlimited ? 'member' : 'free', new Date(now).toISOString())
      const granted = result(userId, period, unlimited, false)
      database.exec('COMMIT');return granted
    } catch (error) {
      try { database.exec('ROLLBACK') } catch {}
      throw error
    }
  }
  return Object.freeze({lookup,grant})
}
