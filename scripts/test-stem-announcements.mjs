import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'stem-announcement-test-signing-key'
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-announcements-'))
const databasePath = path.join(tempRoot, 'stem.sqlite')

function signedToken({ id, username, roles }) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: id, username, roles, workspaceRoles: roles, iat: now, exp: now + 300,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { method, url, body, token = '' }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.url = url
    request.headers = token ? { authorization: `Bearer ${token}` } : {}
    const response = {
      headers: new Map(), statusCode: 0,
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value) },
      end(raw) {
        let payload = {}
        try { payload = JSON.parse(raw || '{}') } catch { payload = { raw: String(raw || '') } }
        resolve({ statusCode: this.statusCode, body: payload })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const studentToken = signedToken({ id: 'ielts:101', username: 'student', roles: ['student'] })
const adminToken = signedToken({ id: 'ielts:202', username: 'admin', roles: ['school_admin'] })

try {
  const api = createStemApi({ env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: databasePath, STEM_SESSION_SECURE: '0' }, questionBank: [] })
  const initial = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=10' })
  assert.equal(initial.statusCode, 200)
  assert.equal(initial.body.schemaVersion, 'stem-announcements-v1')
  assert.equal(initial.body.items.length, 1)
  assert.equal(initial.body.items[0].pinned, true)

  const studentManage = await call(api, { method: 'GET', url: '/api/stem/announcements/manage', token: studentToken })
  assert.equal(studentManage.statusCode, 403)
  const studentPublish = await call(api, {
    method: 'POST', url: '/api/stem/announcements', token: studentToken,
    body: { title: 'Forbidden', summary: 'No permission', body: 'Students cannot publish.', status: 'published' },
  })
  assert.equal(studentPublish.statusCode, 403)

  const invalid = await call(api, {
    method: 'POST', url: '/api/stem/announcements', token: adminToken,
    body: { title: 'Invalid', summary: 'Blocked', body: 'External links must not be published.', status: 'published', action: { label: 'External', url: 'https://example.com' } },
  })
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.body.code, 'announcement_action_invalid')

  for (const url of ['/pages/stem/../practice/index', '/pages/%2e%2e/pages/practice/index']) {
    const nonLiteralRoute = await call(api, {
      method: 'POST', url: '/api/stem/announcements', token: adminToken,
      body: {
        title: 'Invalid route', summary: 'Blocked', body: 'Dot-segment routes must remain rejected.', status: 'published',
        action: { label: 'Open', url },
      },
    })
    assert.equal(nonLiteralRoute.statusCode, 400, url)
    assert.equal(nonLiteralRoute.body.code, 'announcement_action_invalid', url)
  }

  const created = await call(api, {
    method: 'POST', url: '/api/stem/announcements', token: adminToken,
    body: {
      title: '学习功能更新', summary: '章节练习支持新的选择题路径。', body: '现在可以从课程入口直接开始选择题练习。', category: 'feature', pinned: true, status: 'published',
      action: { label: '开始练习', url: '/pages/practice/index?category=alevel' },
    },
  })
  assert.equal(created.statusCode, 201)
  assert.equal(created.body.announcement.status, 'published')
  assert.equal(created.body.announcement.action.url, '/pages/practice/index?category=alevel')

  const lifecycleExpiresAt = new Date(Date.now() + 1_200).toISOString()
  const lifecycleDraft = await call(api, {
    method: 'POST', url: '/api/stem/announcements', token: adminToken,
    body: {
      title: 'Lifecycle draft', summary: 'Draft lifecycle', body: 'Initial body.', category: 'service', status: 'draft',
      expiresAt: lifecycleExpiresAt,
    },
  })
  assert.equal(lifecycleDraft.statusCode, 201)
  const lifecyclePublished = await call(api, {
    method: 'PATCH', url: `/api/stem/announcements/${lifecycleDraft.body.announcement.id}`, token: adminToken,
    body: {
      title: 'Lifecycle published', body: 'Edited body.', status: 'published',
      action: { label: 'Open practice', url: '/pages/practice/index?category=alevel' },
    },
  })
  assert.equal(lifecyclePublished.statusCode, 200)
  assert.equal(lifecyclePublished.body.announcement.status, 'published')
  assert.equal(lifecyclePublished.body.announcement.title, 'Lifecycle published')
  const lifecyclePinned = await call(api, {
    method: 'PATCH', url: `/api/stem/announcements/${lifecycleDraft.body.announcement.id}`, token: adminToken,
    body: { pinned: true },
  })
  assert.equal(lifecyclePinned.statusCode, 200)
  assert.equal(lifecyclePinned.body.announcement.pinned, true)
  const expiringDraft = await call(api, {
    method: 'POST', url: '/api/stem/announcements', token: adminToken,
    body: { title: 'Expiring draft', summary: 'Draft expiry', body: 'Draft body.', category: 'service', status: 'draft', expiresAt: lifecycleExpiresAt },
  })
  assert.equal(expiringDraft.statusCode, 201)
  const lifecycleVisible = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=10' })
  assert.equal(lifecycleVisible.body.items.some((item) => item.id === lifecycleDraft.body.announcement.id && item.pinned), true)

  await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(lifecycleExpiresAt) - Date.now() + 80)))
  const lifecycleExpired = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=10' })
  assert.equal(lifecycleExpired.body.items.some((item) => item.id === lifecycleDraft.body.announcement.id), false)
  const expiredRepublish = await call(api, {
    method: 'PATCH', url: `/api/stem/announcements/${lifecycleDraft.body.announcement.id}`, token: adminToken,
    body: { status: 'published', expiresAt: lifecycleExpiresAt },
  })
  assert.equal(expiredRepublish.statusCode, 400)
  assert.equal(expiredRepublish.body.code, 'announcement_expiry_invalid')
  const expiredArchive = await call(api, {
    method: 'PATCH', url: `/api/stem/announcements/${lifecycleDraft.body.announcement.id}`, token: adminToken,
    body: { status: 'archived', expiresAt: lifecycleExpiresAt },
  })
  assert.equal(expiredArchive.statusCode, 200)
  assert.equal(expiredArchive.body.announcement.status, 'archived')
  const expiredDraftUpdate = await call(api, {
    method: 'PATCH', url: `/api/stem/announcements/${expiringDraft.body.announcement.id}`, token: adminToken,
    body: { status: 'draft', expiresAt: lifecycleExpiresAt },
  })
  assert.equal(expiredDraftUpdate.statusCode, 200)
  const invalidArchivedExpiry = await call(api, {
    method: 'PATCH', url: `/api/stem/announcements/${lifecycleDraft.body.announcement.id}`, token: adminToken,
    body: { status: 'archived', expiresAt: 'not-an-iso-timestamp' },
  })
  assert.equal(invalidArchivedExpiry.statusCode, 400)
  assert.equal(invalidArchivedExpiry.body.code, 'announcement_expiry_invalid')

  const draft = await call(api, {
    method: 'POST', url: '/api/stem/announcements', token: adminToken,
    body: { title: '草稿', summary: '不应公开', body: 'Draft only.', status: 'draft', category: 'service' },
  })
  assert.equal(draft.statusCode, 201)
  const publicList = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=10' })
  assert.equal(publicList.statusCode, 200)
  assert.equal(publicList.body.items.some((item) => item.id === created.body.announcement.id), true)
  assert.equal(publicList.body.items.some((item) => item.id === draft.body.announcement.id), false)
  assert.equal(publicList.body.items[0].id, created.body.announcement.id)

  for (let index = 0; index < 29; index += 1) {
    const extra = await call(api, {
      method: 'POST', url: '/api/stem/announcements', token: adminToken,
      body: { title: `分页公告 ${index + 1}`, summary: '分页测试', body: '分页测试正文。', status: 'published', category: 'system' },
    })
    assert.equal(extra.statusCode, 201)
  }
  const firstPage = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=30&offset=0' })
  assert.equal(firstPage.body.total, 31)
  assert.equal(firstPage.body.items.length, 30)
  assert.equal(firstPage.body.hasMore, true)
  assert.equal(firstPage.body.nextOffset, 30)
  const secondPage = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=30&offset=30' })
  assert.equal(secondPage.body.offset, 30)
  assert.equal(secondPage.body.items.length, 1)
  assert.equal(secondPage.body.hasMore, false)

  const receipt = await call(api, { method: 'POST', url: `/api/stem/announcements/${created.body.announcement.id}/read`, token: studentToken, body: {} })
  assert.equal(receipt.statusCode, 200)
  assert.equal(receipt.body.receipt.announcementId, created.body.announcement.id)
  const restoredRead = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=10&offset=0', token: studentToken })
  assert.equal(restoredRead.statusCode, 200)
  assert.equal(restoredRead.body.items.find((item) => item.id === created.body.announcement.id)?.readAt, receipt.body.receipt.readAt)

  const manager = await call(api, { method: 'GET', url: '/api/stem/announcements/manage', token: adminToken })
  assert.equal(manager.statusCode, 200)
  assert.equal(manager.body.canManage, true)
  assert.equal(manager.body.items.some((item) => item.id === draft.body.announcement.id && item.status === 'draft'), true)

  const archived = await call(api, { method: 'PATCH', url: `/api/stem/announcements/${created.body.announcement.id}`, token: adminToken, body: { status: 'archived' } })
  assert.equal(archived.statusCode, 200)
  const hidden = await call(api, { method: 'GET', url: '/api/stem/announcements?limit=10' })
  assert.equal(hidden.body.items.some((item) => item.id === created.body.announcement.id), false)

  closeStemDatabaseForTests()
  const reopenedApi = createStemApi({ env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: databasePath, STEM_SESSION_SECURE: '0' }, questionBank: [] })
  const reopenedManager = await call(reopenedApi, { method: 'GET', url: '/api/stem/announcements/manage', token: adminToken })
  assert.equal(reopenedManager.statusCode, 200)
  const persistedLifecycle = reopenedManager.body.items.find((item) => item.id === lifecycleDraft.body.announcement.id)
  assert.equal(persistedLifecycle.status, 'archived')
  assert.equal(persistedLifecycle.pinned, true)
  assert.equal(persistedLifecycle.title, 'Lifecycle published')
  assert.equal(persistedLifecycle.action.url, '/pages/practice/index?category=alevel')
  console.log('STEM announcements: publishing permissions, public visibility, read receipts and archive flow passed.')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
