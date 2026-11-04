import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadTavernImageConfiguration } from '../server/tavernImageProvider.js'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tavern-image-provider-'))
const settingsPath = path.join(root, 'image.json')
const fixture = { schemaVersion: 'stem-tavern-image-provider.v1', enabled: true, apiKeyFile: 'regional-fixture.key', baseUrl: 'https://fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen-image-3.0' }
const write = value => fs.writeFileSync(settingsPath, JSON.stringify(value), { mode: 0o600 })
try {
 fs.writeFileSync(path.join(root, fixture.apiKeyFile), 'fake-unit-test-only', { mode: 0o600 })
 write(fixture)
 assert.equal(loadTavernImageConfiguration({ env: {}, settingsPath }).source, 'dedicated-private')
 write({ ...fixture, apiKeyFile: '../outside.key' })
 assert.throws(() => loadTavernImageConfiguration({ env: {}, settingsPath }), error => error.code === 'tavern_image_config_invalid')
 write({ ...fixture, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
 assert.throws(() => loadTavernImageConfiguration({ env: {}, settingsPath }), error => error.code === 'tavern_image_config_invalid')
 write({ ...fixture, enabled: false })
 assert.throws(() => loadTavernImageConfiguration({ env: { DASHSCOPE_API_KEY: 'fallback-fixture', DASHSCOPE_COMPAT_BASE_URL: fixture.baseUrl }, settingsPath }))
 write(fixture)
 assert.throws(() => loadTavernImageConfiguration({ env: { TAVERN_IMAGE_API_KEY: 'only-half' }, settingsPath }), error => error.code === 'tavern_image_not_configured', 'half configured dedicated override must fail closed')
 assert.equal(loadTavernImageConfiguration({ env: { TAVERN_IMAGE_API_KEY: 'explicit-fixture', TAVERN_IMAGE_BASE_URL: fixture.baseUrl }, settingsPath }).source, 'dedicated-env')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
console.log('PASS dedicated Singapore image settings, private credential reference, override precedence and fail-closed configuration')
