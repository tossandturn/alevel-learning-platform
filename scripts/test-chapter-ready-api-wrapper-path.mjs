import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const names = ['STEM_CHAPTER_READY_INFECTIOUS_DISEASES_ROOT', 'STEM_CHAPTER_READY_PROMOTED_ROOT']
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
const originalSpawn = childProcess.spawnSync, previousExit = process.exitCode
let captured
childProcess.spawnSync = (executable, argv, options) => {
  captured = { executable, argv, options }
  return { status: 0 }
}
syncBuiltinESMExports()
try {
  for (const [suffix, chapter, shared, expected] of [
    ['specific', '/synthetic/chapter-10', '/synthetic/other-topic', '/synthetic/chapter-10'],
    ['explicit-shared', undefined, '/synthetic/chapter-10-shared', '/synthetic/chapter-10-shared'],
    ['default', undefined, undefined, 'data/ai-pdf-ingestion/chapter-ready-9700-as-infectious-diseases-qwen-20261004-v1'],
  ]) {
    for (const [name, value] of [[names[0], chapter], [names[1], shared]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await import('./test-chapter-ready-infectious-diseases-api.mjs?path-case=' + suffix)
    assert.equal(captured.executable, process.execPath)
    assert.equal(captured.options.env.STEM_CHAPTER_READY_PROMOTED_ROOT, expected)
    assert.equal(captured.options.env.STEM_CHAPTER_READY_TOPIC_ID, '9700-as-topic-10')
    assert.equal(captured.options.env.STEM_CHAPTER_READY_QUESTION_COUNT, '6')
    assert.equal(captured.options.cwd, process.cwd())
    assert.equal(captured.argv.length, 1)
    assert.match(captured.argv[0], /test-chapter-ready-mcq-api\.mjs$/)
  }
  console.log(JSON.stringify({ status: 'PASS_CHAPTER_API_WRAPPER_PATH', cases: 3, providerCalls: 0, studentRecordsUsed: false }))
} finally {
  childProcess.spawnSync = originalSpawn
  syncBuiltinESMExports()
  process.exitCode = previousExit
  for (const name of names) {
    if (previous[name] === undefined) delete process.env[name]
    else process.env[name] = previous[name]
  }
}
