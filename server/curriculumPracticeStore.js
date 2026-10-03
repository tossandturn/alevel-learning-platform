function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function safeId(value, label, max = 160) {
  const text = String(value || '').trim()
  if (!text || text.length > max || !/^[A-Za-z0-9._:-]+$/.test(text)) throw Object.assign(new Error(`${label} is invalid.`), { statusCode: 400, code: 'curriculum_practice_id_invalid' })
  return text
}

function key(userId, sessionId) {
  return `${userId}\u0000${sessionId}`
}

function normalizeSession(value) {
  return {
    userId: safeId(value.userId, 'userId'),
    sessionId: safeId(value.sessionId, 'sessionId'),
    routeId: safeId(value.routeId, 'routeId'),
    topicId: value.topicId ? safeId(value.topicId, 'topicId') : null,
    releaseHash: safeId(value.releaseHash, 'releaseHash'),
    questionSetHash: safeId(value.questionSetHash, 'questionSetHash'),
    questionIds: [...value.questionIds],
    status: 'draft',
    answers: null,
    results: null,
    score: null,
    maxScore: value.questionIds.length,
    submissionId: null,
    submissionHash: null,
    createdAt: value.createdAt,
    submittedAt: null,
    updatedAt: value.createdAt,
  }
}

export function createMemoryCurriculumPracticeStore() {
  const sessions = new Map()
  const owners = new Map()

  return Object.freeze({
    create(value) {
      const session = normalizeSession(value)
      if (owners.has(session.sessionId)) throw Object.assign(new Error('Session already exists.'), { statusCode: 409, code: 'curriculum_practice_session_exists' })
      owners.set(session.sessionId, session.userId)
      sessions.set(key(session.userId, session.sessionId), session)
      return clone(session)
    },
    get(userId, sessionId) {
      return clone(sessions.get(key(safeId(userId, 'userId'), safeId(sessionId, 'sessionId'))) || null)
    },
    list(userId, { limit = 50 } = {}) {
      const owner = safeId(userId, 'userId')
      return [...sessions.values()]
        .filter((session) => session.userId === owner)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, limit)
        .map(clone)
    },
    submit(userId, sessionId, submission) {
      const storageKey = key(safeId(userId, 'userId'), safeId(sessionId, 'sessionId'))
      const current = sessions.get(storageKey)
      if (!current) return null
      const submissionId = safeId(submission.submissionId, 'submissionId')
      if (current.status === 'submitted') {
        if (current.submissionId === submissionId && current.submissionHash === submission.submissionHash) return { session: clone(current), duplicate: true }
        if (current.submissionId === submissionId) throw Object.assign(new Error('The idempotency key was reused with different answers.'), { statusCode: 409, code: 'curriculum_practice_idempotency_mismatch' })
        throw Object.assign(new Error('This session has already been submitted.'), { statusCode: 409, code: 'curriculum_practice_session_immutable' })
      }
      const updated = {
        ...current,
        status: 'submitted',
        answers: clone(submission.answers),
        results: clone(submission.results),
        score: submission.score,
        maxScore: submission.maxScore,
        submissionId,
        submissionHash: submission.submissionHash,
        submittedAt: submission.submittedAt,
        updatedAt: submission.submittedAt,
      }
      sessions.set(storageKey, updated)
      return { session: clone(updated), duplicate: false }
    },
  })
}

function databaseSession(row) {
  if (!row) return null
  return {
    userId: String(row.user_id),
    sessionId: String(row.session_id),
    routeId: String(row.route_id),
    topicId: row.topic_id ? String(row.topic_id) : null,
    releaseHash: String(row.release_hash),
    questionSetHash: String(row.question_set_hash),
    questionIds: JSON.parse(row.question_ids_json),
    status: String(row.status),
    answers: row.answers_json ? JSON.parse(row.answers_json) : null,
    results: row.results_json ? JSON.parse(row.results_json) : null,
    score: row.score === null ? null : Number(row.score),
    maxScore: Number(row.max_score),
    submissionId: row.submission_id ? String(row.submission_id) : null,
    submissionHash: row.submission_hash ? String(row.submission_hash) : null,
    createdAt: String(row.created_at),
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    updatedAt: String(row.updated_at),
  }
}

export function createSqliteCurriculumPracticeStore({ databaseProvider } = {}) {
  if (typeof databaseProvider !== 'function') throw new TypeError('databaseProvider is required')
  let initialized = false
  function database() {
    const db = databaseProvider()
    if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') throw new TypeError('databaseProvider must return a SQLite-compatible database')
    if (!initialized) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS curriculum_practice_sessions (
          user_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          route_id TEXT NOT NULL,
          topic_id TEXT,
          release_hash TEXT NOT NULL,
          question_set_hash TEXT NOT NULL,
          question_ids_json TEXT NOT NULL,
          status TEXT NOT NULL,
          answers_json TEXT,
          results_json TEXT,
          score INTEGER,
          max_score INTEGER NOT NULL,
          submission_id TEXT,
          submission_hash TEXT,
          created_at TEXT NOT NULL,
          submitted_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, session_id),
          UNIQUE (session_id),
          UNIQUE (user_id, submission_id)
        );
        CREATE INDEX IF NOT EXISTS idx_curriculum_practice_user_updated
          ON curriculum_practice_sessions(user_id, updated_at DESC);
      `)
      const columns = db.prepare('PRAGMA table_info(curriculum_practice_sessions)').all()
      if (!columns.some((column) => column.name === 'submission_hash')) db.exec('ALTER TABLE curriculum_practice_sessions ADD COLUMN submission_hash TEXT')
      initialized = true
    }
    return db
  }
  const select = `
    SELECT user_id, session_id, route_id, topic_id, release_hash, question_set_hash,
      question_ids_json, status, answers_json, results_json, score, max_score,
      submission_id, submission_hash, created_at, submitted_at, updated_at
    FROM curriculum_practice_sessions
  `

  return Object.freeze({
    create(value) {
      const session = normalizeSession(value)
      const db = database()
      try {
        db.prepare(`
          INSERT INTO curriculum_practice_sessions
            (user_id, session_id, route_id, topic_id, release_hash, question_set_hash,
             question_ids_json, status, max_score, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)
        `).run(session.userId, session.sessionId, session.routeId, session.topicId, session.releaseHash, session.questionSetHash, JSON.stringify(session.questionIds), session.maxScore, session.createdAt, session.updatedAt)
      } catch (error) {
        throw Object.assign(new Error('Session already exists.'), { statusCode: 409, code: 'curriculum_practice_session_exists', cause: error })
      }
      return databaseSession(db.prepare(`${select} WHERE user_id = ? AND session_id = ?`).get(session.userId, session.sessionId))
    },
    get(userId, sessionId) {
      return databaseSession(database().prepare(`${select} WHERE user_id = ? AND session_id = ?`).get(safeId(userId, 'userId'), safeId(sessionId, 'sessionId')))
    },
    list(userId, { limit = 50 } = {}) {
      return database().prepare(`${select} WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`).all(safeId(userId, 'userId'), limit).map(databaseSession)
    },
    submit(userId, sessionId, submission) {
      const owner = safeId(userId, 'userId')
      const id = safeId(sessionId, 'sessionId')
      const submissionId = safeId(submission.submissionId, 'submissionId')
      const db = database()
      db.exec('BEGIN IMMEDIATE')
      try {
        const current = databaseSession(db.prepare(`${select} WHERE user_id = ? AND session_id = ?`).get(owner, id))
        if (!current) {
          db.exec('ROLLBACK')
          return null
        }
        if (current.status === 'submitted') {
          db.exec('ROLLBACK')
          if (current.submissionId === submissionId && current.submissionHash === submission.submissionHash) return { session: current, duplicate: true }
          if (current.submissionId === submissionId) throw Object.assign(new Error('The idempotency key was reused with different answers.'), { statusCode: 409, code: 'curriculum_practice_idempotency_mismatch' })
          throw Object.assign(new Error('This session has already been submitted.'), { statusCode: 409, code: 'curriculum_practice_session_immutable' })
        }
        db.prepare(`
          UPDATE curriculum_practice_sessions
          SET status = 'submitted', answers_json = ?, results_json = ?, score = ?, max_score = ?,
              submission_id = ?, submission_hash = ?, submitted_at = ?, updated_at = ?
          WHERE user_id = ? AND session_id = ? AND status = 'draft'
        `).run(JSON.stringify(submission.answers), JSON.stringify(submission.results), submission.score, submission.maxScore, submissionId, submission.submissionHash, submission.submittedAt, submission.submittedAt, owner, id)
        const updated = databaseSession(db.prepare(`${select} WHERE user_id = ? AND session_id = ?`).get(owner, id))
        db.exec('COMMIT')
        return { session: updated, duplicate: false }
      } catch (error) {
        try { db.exec('ROLLBACK') } catch { /* Preserve the original failure. */ }
        throw error
      }
    },
  })
}
