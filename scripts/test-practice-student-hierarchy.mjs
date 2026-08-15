import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/StudentV2.css', import.meta.url), 'utf8')

assert.match(
  appSource,
  /<PracticeTopicDirectory[\s\S]*query=\{selectedTopic\}/,
  'an unmatched topic query must not empty the current route topic directory',
)
assert.match(
  appSource,
  /Topic practice is not available for \{activeRoute\.stage\} \{activeRoute\.subject\} yet/,
  'a route with no reviewed topic questions must explain the real content gap',
)
assert.match(
  appSource,
  /Browse \{activeRoute\.stage\} \{activeRoute\.subject\} papers/,
  'a route without Topic Drill inventory must still give students an immediate paper path',
)
assert.match(
  appSource,
  /const availableTopics = topics\.filter\(\(topic\) => Number\(topic\.inventory \|\| 0\) > 0\)/,
  'zero-inventory syllabus topics must not be presented as openable Topic Drill sessions',
)
assert.match(
  appSource,
  /sourceQuestionCount === 0[\s\S]*Topic practice is not available for/,
  'a route with official topics but no ready question inventory must take the honest paper-first path',
)
assert.match(
  styles,
  /\.topic-directory__route-status/,
  'the Topic Drill directory needs a visible route-level inventory summary',
)
assert.match(
  styles,
  /\.topic-directory__open/,
  'each topic row needs an explicit next action rather than an unexplained chevron',
)
assert.match(
  styles,
  /\.app-shell--topic > \.ai-coach-trigger[\s\S]*display: none/,
  'the global Coach launcher must not obscure mobile Topic Drill controls',
)

console.log('Practice student hierarchy regression checks passed')
