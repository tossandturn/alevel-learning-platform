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
  /Topic Drill is being prepared for this course/,
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
  /sourceQuestionCount === 0[\s\S]*Topic Drill is being prepared for this course/,
  'a route with official topics but no ready question inventory must take the honest paper-first path',
)
assert.match(
  appSource,
  /const hasTopicInventory = practiceTopics\.some\(\(topic\) => Number\(topic\.inventory \|\| 0\) > 0\)/,
  'a course with no available Topic Drill inventory must be identified before rendering its controls',
)
assert.match(
  appSource,
  /hasTopicInventory && <label className="practice-topic-filter">/,
  'an unavailable Topic Drill route must not show a misleading topic filter',
)
assert.match(
  appSource,
  /className="practice-mode-group" aria-label="Learn by topic"/,
  'practice navigation must group the learn-by-topic routes instead of presenting every mode as one flat row',
)
assert.match(
  appSource,
  /Topic Drill is being prepared for this course/,
  'the unavailable state must explain the real status in student language',
)
assert.match(
  appSource,
  /const topicDirectoryIntro = sourceQuestionCount > 0/,
  'the syllabus header must use the same inventory state as the Topic Drill availability card',
)
assert.match(
  styles,
  /\.topic-directory__route-status/,
  'the Topic Drill directory needs a visible route-level inventory summary',
)
assert.match(
  styles,
  /\.practice-mode-group/,
  'practice navigation needs visual grouping for the learning workflow',
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
