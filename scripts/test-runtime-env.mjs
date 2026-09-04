import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mergeRuntimeEnv } from '../src/lib/runtimeEnv.js'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-runtime-env-'))
const sharedEnvPath = path.join(tempRoot, 'shared', '.env')
const projectRoot = path.join(tempRoot, 'project')
const projectEnvPath = path.join(projectRoot, '.env')
fs.mkdirSync(path.dirname(sharedEnvPath), { recursive: true })
fs.mkdirSync(projectRoot, { recursive: true })
fs.writeFileSync(
  sharedEnvPath,
  [
    'OPENAI_API_KEY=shared-openai-key',
    'OPENAI_BASE_URL=https://ai.ieltsist.com/',
    'DASHSCOPE_API_KEY=shared-qwen-key',
    'DASHSCOPE_COMPAT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1',
    'STEM_INTERNAL_AUTH_KEY=shared-internal-key',
    '',
  ].join('\n'),
)
fs.writeFileSync(
  projectEnvPath,
  [
    'DASHSCOPE_API_KEY=project-qwen-key',
    'AI_PDF_INGESTION_MODEL=qwen-project-model',
    '',
  ].join('\n'),
)

const merged = mergeRuntimeEnv({
  cwd: path.join(tempRoot, 'releases', '20260819-57882ef'),
  env: {
    STEM_INTERNAL_AUTH_KEY: 'process-internal-key',
    OPENAI_API_KEY: '',
    COACH_AI_MODEL: 'gpt-5.6-test',
  },
})

assert.equal(merged.OPENAI_API_KEY, 'shared-openai-key', 'a shared env file must backfill missing provider credentials')
assert.equal(merged.OPENAI_BASE_URL, 'https://ai.ieltsist.com/', 'shared OpenAI base URL must be loaded when process env is missing it')
assert.equal(merged.DASHSCOPE_API_KEY, 'shared-qwen-key', 'shared Qwen fallback credentials must be loaded')
assert.equal(merged.STEM_INTERNAL_AUTH_KEY, 'process-internal-key', 'an explicit process env value must keep precedence over shared fallback')
assert.equal(merged.COACH_AI_MODEL, 'gpt-5.6-test', 'unrelated process env values must remain intact')
const projectMerged = mergeRuntimeEnv({
  cwd: projectRoot,
  env: {},
})
assert.equal(projectMerged.DASHSCOPE_API_KEY, 'project-qwen-key', 'a project .env must load provider credentials for local ingestion')
assert.equal(projectMerged.AI_PDF_INGESTION_MODEL, 'qwen-project-model', 'a project .env must load ingestion configuration')
assert.doesNotThrow(() => mergeRuntimeEnv({
  cwd: path.join(tempRoot, 'releases', '20260819-57882ef'),
  env: { COACH_AI_MODEL: 'gpt-5.6-test' },
}), 'missing shared env files must not break preview startup')

console.log('Runtime env shared-file fallback contract passed.')
