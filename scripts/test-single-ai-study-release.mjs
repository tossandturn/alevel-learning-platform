import assert from 'node:assert/strict'
import { buildAiStudentStudyRelease, hasValidAiStudentStudyRelease, sourceReviewInputSha256 } from './ai-pdf-ingestion/contract.mjs'
const artifact={artifactId:'sha256:'+'a'.repeat(64),syllabusRouteId:'route',status:'ai-verified',source:{questionPdfSha256:'b'.repeat(64),markSchemePdfSha256:'c'.repeat(64)},extractor:{provider:'paddle',model:'ocr'},verifier:null,candidate:{questions:[{sourceQuestionId:'p:q1',regions:[{page:1,pageImageSha256:'d'.repeat(64)}],parts:[{label:'a',marks:1}],markSchemeEvidence:[{page:2,pageImageSha256:'e'.repeat(64)}]}]},verification:{questions:[{questionNumber:'1',parts:[{label:'a',marks:1}]}]}}
const confirmations=Object.fromEntries(['sourceBindingConfirmed','wholeQuestionConfirmed','partStructureConfirmed','marksConfirmed','markSchemeEvidenceConfirmed','topicMappingConfirmed'].map(k=>[k,true]))
artifact.sourceReview={schemaVersion:'ai-source-semantic-review.v1',provider:'openai',model:'test-model',decision:'accept',reviewedAt:new Date().toISOString(),inputSha256:sourceReviewInputSha256(artifact),confirmations,reviewNote:'Synthetic test: source QP, MS, marks, question and syllabus checked.',evidence:[{document:'qp',page:1,pageImageSha256:'d'.repeat(64)},{document:'ms',page:2,pageImageSha256:'e'.repeat(64)}]}
const build=a=>buildAiStudentStudyRelease({...a,routeId:a.syllabusRouteId})
artifact.studentRelease=build(artifact)
assert.equal(artifact.studentRelease.studentStudyEligible,true)
assert.equal(artifact.studentRelease.review.independentPassCount,1)
assert.equal(artifact.studentRelease.review.method,'single-model-source-review')
assert.equal(artifact.studentRelease.formalProgressEligible,false)
assert.equal(artifact.studentRelease.qualityFlag,'aicheck')
assert.equal(hasValidAiStudentStudyRelease(artifact),true)
for(const change of [{decision:'defer'},{model:''},{evidence:[]},{confirmations:{...confirmations,marksConfirmed:false}},{inputSha256:'f'.repeat(64)}])assert.throws(()=>build({...artifact,sourceReview:{...artifact.sourceReview,...change}}),/source review/)
assert.equal(hasValidAiStudentStudyRelease({...artifact,sourceReview:{...artifact.sourceReview,reviewNote:'modified'}}),false)
const altered=structuredClone(artifact);altered.candidate.questions[0].parts[0].marks=2
assert.equal(hasValidAiStudentStudyRelease(altered),false)
assert.throws(()=>build(altered),/source review/)
assert.throws(()=>build({...artifact,sourceReview:null}),/Both structured/)
console.log('PASS: single real source review enables study; unreviewed OCR and stale receipts remain ineligible')
