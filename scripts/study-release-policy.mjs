import assert from 'node:assert/strict'
import {MIN_QUESTION_GROUPS_PER_TEST,MIN_VERIFIED_GROUPS_FOR_PRACTICE,topicPracticeEligibility} from '../src/lib/practiceConstants.js'

export function assertStudyReleaseInventory(inventory,routeId){
 assert.equal(inventory.routeId,routeId,'route mismatch')
 assert.ok(Array.isArray(inventory.topics)&&inventory.topics.length,'empty syllabus is not ready')
 for(const topic of inventory.topics){
  for(const key of ['verifiedQuestionCount','studyQuestionCount','availableQuestionCount'])assert.ok(Number.isSafeInteger(topic[key])&&topic[key]>=0,`invalid ${key}`)
  assert.equal(topic.availableQuestionCount,topic.verifiedQuestionCount+topic.studyQuestionCount,'count mismatch')
  const policy=topicPracticeEligibility(topic)
  assert.equal(topic.ready,policy.ready,'formal readiness drift')
  assert.equal(topic.studyReady,policy.studyReady,'study readiness drift')
  assert.equal(topic.apiStartable,policy.ready||policy.studyReady,'API readiness drift')
  assert.ok(topic.apiStartable,`${routeId}/${topic.id} is not study-startable`)
  assert.ok(topic.availableQuestionCount>=MIN_QUESTION_GROUPS_PER_TEST,'study floor must not be lowered')
  if(topic.ready)assert.ok(topic.verifiedQuestionCount>=MIN_VERIFIED_GROUPS_FOR_PRACTICE,'formal floor must not be lowered')
 }
 return {routeId,topics:inventory.topics.length,formalTopics:inventory.topics.filter(t=>t.ready).length,studyTopics:inventory.topics.filter(t=>t.studyReady).length,minimumStudyGroups:MIN_QUESTION_GROUPS_PER_TEST,minimumFormalGroups:MIN_VERIFIED_GROUPS_FOR_PRACTICE}
}
