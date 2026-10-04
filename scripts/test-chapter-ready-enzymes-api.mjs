import { spawnSync } from 'node:child_process'
import path from 'node:path'

const result = spawnSync(process.execPath, [path.resolve('scripts/test-chapter-ready-mcq-api.mjs')], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    STEM_CHAPTER_READY_TOPIC_ID: '9700-as-topic-03',
    STEM_CHAPTER_READY_PROMOTED_ROOT: process.env.STEM_CHAPTER_READY_ENZYMES_ROOT
      || process.env.STEM_CHAPTER_READY_PROMOTED_ROOT
      || 'data/ai-pdf-ingestion/chapter-ready-9700-as-enzymes-qwen-20261005-v1',
    STEM_CHAPTER_READY_QUESTION_COUNT: '6',
    STEM_CHAPTER_READY_STUDY_MODE: 'chapter-study',
  },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exitCode = result.status ?? 1
