import assert from 'node:assert/strict'
import fs from 'node:fs'
import {studyQuestionBank,isVerifiedPastPaperItem,isStudentReleasedAiStudyItem} from '../src/data/questionBank.js'
assert(fs.existsSync(new URL('../server/coachQuestionSource.js',import.meta.url)),'Coach must resolve question origins from server evidence, not model guesses')
const {createCoachQuestionSourceResolver,createCoachSourceStream,extractCoachSourceTrailer,appendCoachQuestionSource,coachSourceInstruction}=await import('../server/coachQuestionSource.js')
const question=studyQuestionBank.find(q=>q.sourceRef?.paper==='9702_m24_qp_22.pdf'&&q.sourceRef.question==='Q2'&&(isVerifiedPastPaperItem(q)||isStudentReleasedAiStudyItem(q)))
assert(question,'A released canonical source fixture is required')
const resolver=createCoachQuestionSourceResolver({questionBankProvider:()=>[question]})
const full=resolver.resolve({message:question.prompt});assert.equal(full.status,'matched');assert.equal(full.year,2024);assert.equal(full.paperCode,'9702/22');assert.equal(full.questionNumber,2);assert.match(full.reference,/2–3月/);assert.match(full.reference,/第 2 题/)
assert.equal(resolver.resolve({message:'Define acceleration.'}).status,'unconfirmed','Generic short prompts are not source proof')
const other=studyQuestionBank.find(q=>!/^\d{4}_/.test(q.sourceRef?.paper||'')&&q.prompt?.length>150)
assert(other);assert.equal(createCoachQuestionSourceResolver({questionBankProvider:()=>[other]}).resolve({message:other.prompt}).status,'unconfirmed','Unreleased or unsupported exam records must not inherit a Cambridge citation')
assert.equal(resolver.resolve({message:question.prompt.replace('9.0 m','19.0 m')}).status,'unconfirmed','Changed numeric evidence must not silently map to a different original')
const visibleSubquestion=question.prompt.slice(question.prompt.indexOf('When the diver is on the platform'),question.prompt.indexOf('(c(i))')).trim()
assert.equal(resolver.resolve({hasImages:true,lookupText:visibleSubquestion}).method,'recognized-text-match','A long literal visible subquestion need not include its introductory figure reference')
assert.equal(resolver.resolve({hasImages:true,lookupText:visibleSubquestion.replace('9.0 m','19.0 m')}).status,'unconfirmed','A changed numerical value in the visible subquestion is not an exact match')
assert.equal(resolver.resolve({message:'Unrelated geometry question about a circle.',context:{question:{id:question.bankId},paper:{questionFile:question.sourceRef.paper}}}).status,'unconfirmed','A client filename/question ID alone is not proof')
const authorization={coachAccess:{binding:'authoritative-attempt'},routeId:question.routeId,paperId:question.sourceRef.paperId,paper:{id:question.sourceRef.paperId,questionFile:question.sourceRef.paper},question:{id:question.sourceQuestionId,number:2}}
assert.equal(resolver.resolve({message:'Give me a hint.',authorization}).method,'bound-record')
const wrong=structuredClone(authorization);wrong.question.number=3;assert.equal(resolver.resolve({authorization:wrong}).status,'unconfirmed')
const duplicate=structuredClone(studyQuestionBank.find(q=>q.sourceRef?.paper==='9702_m24_qp_22.pdf'&&q.sourceRef.question==='Q4'));duplicate.prompt=question.prompt;assert(isVerifiedPastPaperItem(duplicate)||isStudentReleasedAiStudyItem(duplicate),'Synthetic duplicate must keep a valid source record')
assert.equal(createCoachQuestionSourceResolver({questionBankProvider:()=>[question,duplicate]}).resolve({message:question.prompt}).status,'ambiguous')
const quarantined=structuredClone(question);quarantined.questionGroupStatus='quarantined';assert.equal(createCoachQuestionSourceResolver({questionBankProvider:()=>[quarantined]}).resolve({message:question.prompt}).status,'unconfirmed')
const unpublished=structuredClone(question);unpublished.sourceKind='original-foundation';assert.equal(createCoachQuestionSourceResolver({questionBankProvider:()=>[unpublished]}).resolve({message:question.prompt}).status,'unconfirmed')
const source=`\n<question_lookup>${JSON.stringify({text:question.prompt})}</question_lookup>`,answer='## 答案\n42\n\n## 解题步骤\nUse the equation.'
assert.equal(extractCoachSourceTrailer(answer+source).answer,answer);assert.equal(extractCoachSourceTrailer(answer+source).lookupText,question.prompt)
for(let i=0;i<=source.length;i++){const stream=createCoachSourceStream();const visible=stream.push(answer)+stream.push(source.slice(0,i))+stream.push(source.slice(i))+stream.finish();assert.equal(visible,answer);assert(!visible.includes('question_lookup'))}
assert.equal(extractCoachSourceTrailer(answer+'\n<question_lookup>{"text":').lookupText,'')
assert.equal(extractCoachSourceTrailer(answer+'\n<question_lookup>{"text":"'+('x'.repeat(9000))+'"}</question_lookup>').lookupText,'')
assert.match(appendCoachQuestionSource(answer,full),/题目出处/);assert.match(appendCoachQuestionSource(answer,full),/9702\/22/);assert.match(appendCoachQuestionSource(answer,{status:'unconfirmed'}),/未确认/)
assert.match(coachSourceInstruction({hasImages:true}),/question_lookup/);assert.doesNotMatch(coachSourceInstruction({hasImages:false}),/append.*question_lookup/i)
console.log('Coach source matching: authoritative binding, literal text, numeric mismatch, ambiguity, eligibility, bounded private trailer and every stream split PASS')
