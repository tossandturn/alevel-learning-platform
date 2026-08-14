import assert from 'node:assert/strict'
import { courseRoutes } from '../src/data/routeRegistry.js'
import { learningPlan } from '../src/data/learningPlan.js'
import { topicLearningContent, topicLearningContentSourceNote } from '../src/data/topicLearningContent.js'
import { coachPracticeOptions, verifiedPracticeQuestionGroups } from '../src/lib/verifiedPracticeCatalog.js'

function assertGuide(topic, label) {
  const guide = topicLearningContent(topic)
  assert.ok(guide.overview.length >= 80, `${label} needs a substantial overview`)
  assert.ok(guide.learningObjectives.length >= 3, `${label} needs learning objectives`)
  assert.ok(guide.keyIdeas.length >= 3, `${label} needs key ideas`)
  assert.ok(guide.commonMistakes.length >= 3, `${label} needs common mistakes`)
  assert.ok(guide.workedExample.prompt.length >= 50, `${label} needs an original guided example`)
  assert.ok(guide.workedExample.method.length >= 50, `${label} needs a method explanation`)
  assert.ok(guide.examChecklist.length >= 3, `${label} needs an exam checklist`)
  assert.equal(guide.sourceNote, topicLearningContentSourceNote, `${label} must disclose non-past-paper content`)
}

let topicCount = 0
for (const option of coachPracticeOptions()) {
  for (const topic of option.topics) {
    assertGuide({
      ...learningPlan.knowledgeGroups.find((group) => group.id === topic.id),
      id: topic.id,
      name: topic.label,
      subjectId: option.subjectId,
      stage: option.stage,
      themes: learningPlan.knowledgeGroups.find((group) => group.id === topic.id)?.themes || [],
    }, `${option.routeId}/${topic.id}`)
    topicCount += 1
  }
}

for (const route of courseRoutes) {
  for (const topic of route.syllabus.topics) {
    assertGuide({
      id: topic.id,
      name: topic.title,
      subjectId: route.subjectId,
      stage: route.stage,
      themes: [],
    }, `${route.routeId}/${topic.id}`)
  }
}

assert.ok(topicCount >= 60, `expected the registered learning map to expose at least 60 topics, got ${topicCount}`)
assert.equal(
  verifiedPracticeQuestionGroups.length,
  26,
  'learning content must not expand the canonical verified question inventory',
)

console.log(`Topic learning content checks passed for ${topicCount} practice topics and ${courseRoutes.reduce((sum, route) => sum + route.syllabus.topics.length, 0)} route topics`)
