import { spawnSync } from 'node:child_process'
import path from 'node:path'

const result = spawnSync(process.execPath, [path.resolve('scripts/test-chapter-ready-mcq-api.mjs')], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    STEM_CHAPTER_READY_TOPIC_ID: '9700-as-topic-10',
    STEM_CHAPTER_READY_PROMOTED_ROOT: process.env.STEM_CHAPTER_READY_INFECTIOUS_DISEASES_ROOT
      || process.env.STEM_CHAPTER_READY_PROMOTED_ROOT
      || 'data/ai-pdf-ingestion/chapter-ready-9700-as-infectious-diseases-qwen-20261004-v1',
    STEM_CHAPTER_READY_QUESTION_COUNT: '6',
  },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
