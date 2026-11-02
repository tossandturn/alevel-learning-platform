import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import {buildCoachSystemPrompt,resolveCoachRequestPolicy} from '../server/coachPolicy.js'
import {buildTavernSystemPrompt,resolveCoachFeature} from '../server/coachFeatures.js'
import {buildAdmissionsAdvisorSystemPrompt} from '../server/admissionsAdvisor.js'
import {buildIeltsTeacherSystemPrompt} from '../server/ieltsTeacher.js'
import {admissionsEvidencePreparation} from '../server/admissionsResearchEvidence.js'

function assertDefaultLanguage(prompt) {
  assert.match(prompt, /stem-coach-language-v2/)
  assert.match(prompt, /student.*(?:request|conversation).*language/i)
  assert.match(prompt, /Do not automatically translate|Do not force bilingual/i)
  assert.match(prompt, /earlier bilingual.*history/i, 'old bilingual answers must not keep the old default alive')
  assert.doesNotMatch(prompt, /For each generated prose sentence|no generated prose sentence is left without|preserve bilingual delivery|Use paired Chinese\/English/i)
}

for (const helpIntent of ['hint', 'worked-solution']) {
  for (const input of ['text', 'image']) {
    test(`${helpIntent}/${input}: only word or explanation questions require English plus Chinese`, () => {
      const context = { inputType: input, questionText: input === 'text' ? 'Explain why a metal feels colder than wood.' : '' }
      const prompt = buildCoachSystemPrompt({policy:resolveCoachRequestPolicy({typedIntent:helpIntent,context}),context})
      assertDefaultLanguage(prompt)
      assert.match(prompt, /Automatic bilingual scope: academic-word-explanation/)
      assert.match(prompt, /actual question.*(?:images|image).*not just.*message/is)
      assert.match(prompt, /word problem.*explanatory.*question/is)
      assert.match(prompt, /complete.*English.*explanation/is)
      assert.match(prompt, /Chinese.*(?:support|explanation)/i)
      assert.match(prompt, /pure.*(?:calculation|symbolic)/i)
      assert.match(prompt, /mixed.*subquestion/is)
      assert.match(prompt, /same.*generation/i)
      assert.match(prompt, /LaTeX/)
      assert.match(prompt, /untrusted|system instructions/)
      if (helpIntent === 'hint') assert.match(prompt, /English.*hint.*not.*(?:solution|answer)/is)
      assert.match(prompt, /required in BOTH complete-answer and hint modes/)
      assert.match(prompt, /car accelerating.*word problem.*one formula/is)
    })
  }
}

for (const [message, label] of [['查一下官网要求','来源'],['Check official requirements','Sources']]) {
  test(`source footer is localized without duplicate prose: ${label}`, () => {
    const source = {id:'S1-123456789012345678901234',title:'Official requirements',url:'https://example.edu/admissions',retrievedAt:'2026-11-03T00:00:00Z',applicableYears:['2027'],verification:{kind:'institution-requirements',requestedYear:'2027',yearMatched:true,limitations:[]}}
    const result = admissionsEvidencePreparation({message,status:'complete',scope:{},sources:[source]})
    assert.ok(result.answerSuffix.startsWith(`\n\n${label}\n`))
    assert.match(result.answerSuffix, /S1-123456789012345678901234/)
    assert.match(result.answerSuffix, /https:\/\/example.edu\/admissions/)
    assert.doesNotMatch(result.answerSuffix, /来源 \/ Sources|本次读取 \/ Retrieved/)
  })
}

for (const [feature, helpIntent] of [['steps','hint'],['answers','worked-solution']]) {
  test(`${feature}: route override still selects the academic language exception`, () => {
    const resolvedFeature = resolveCoachFeature({feature})
    const policy = resolveCoachRequestPolicy({typedIntent:'check-work',feature:resolvedFeature})
    assert.equal(policy.helpIntent, helpIntent)
    assert.match(buildCoachSystemPrompt({policy,feature:resolvedFeature}), /Automatic bilingual scope: academic-word-explanation/)
  })
}

test('check work is not automatically bilingual and active exams still cannot reveal answers', () => {
  const prompt = buildCoachSystemPrompt({policy:resolveCoachRequestPolicy({typedIntent:'check-work'})})
  assertDefaultLanguage(prompt)
  assert.match(prompt, /Automatic bilingual scope: none/)
  const exam = buildCoachSystemPrompt({policy:resolveCoachRequestPolicy({typedIntent:'worked-solution',context:{view:'full-paper'}})})
  assert.match(exam, /Do not reveal the final answer/)
  assert.match(exam, /never.*(?:exam|assessment).*limits/i)
})

for (const persona of ['keeper','study-buddy','cat-companion','story-traveler','xianxia-guide','mystery-guide','tarot-reader','eastern-oracle']) {
  test(`tavern/${persona}: natural single-language chat even with old bilingual history`, () => {
    const prompt = buildTavernSystemPrompt(resolveCoachFeature({feature:'tavern',persona}))
    assertDefaultLanguage(prompt)
    assert.match(prompt, /Automatic bilingual scope: none/)
    assert.doesNotMatch(prompt, /both language renditions/)
  })
}

for (const [role, build] of [['admissions',buildAdmissionsAdvisorSystemPrompt],['ielts',buildIeltsTeacherSystemPrompt]]) {
  test(`${role}: no automatic paired output, preserve requested English drafts`, () => {
    const prompt = build()
    assertDefaultLanguage(prompt)
    assert.match(prompt, /Automatic bilingual scope: none/)
    assert.match(prompt, /English.*(?:draft|examples|corrections)/i)
    assert.doesNotMatch(prompt, /English rendition.*Chinese|counterpart|self-contained Chinese explanation first/i)
  })
}

test('structured marking keeps its schema and stops mandatory paired comments', () => {
  const marking = fs.readFileSync(new URL('../server/wholePaperAi.js',import.meta.url),'utf8')
  assert.match(marking, /bilingualCoachPolicy\(\{structured:true\}\)/)
  assert.doesNotMatch(marking, /as adjacent Chinese\/English sentence pairs|equally concise English counterpart/)
})

for (const [message, expectedEnglish] of [['请查这门课程',false], ['Read this course page',true], ['请用英语回答这门课程要求',true], ['Please answer in Chinese',false]]) {
  test(`research unavailable copy uses one language: ${message}`, () => {
    for (const kind of ['curriculum','institution-requirements']) {
      const result = admissionsEvidencePreparation({message,status:'unavailable',scope:{kind}})
      assert.ok(result.guardedAnswer)
      assert.equal(/[\u3400-\u9fff]/u.test(result.guardedAnswer), !expectedEnglish)
      if (!expectedEnglish) assert.doesNotMatch(result.guardedAnswer, /The official|Usable official/)
      assert.equal(result.guardedOutcome.retryable,true)
    }
  })
}
