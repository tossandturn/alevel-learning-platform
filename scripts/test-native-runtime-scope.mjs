import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {routeById} from '../src/data/routeRegistry.js'
import {SYLLABUS_PRACTICE_ROUTE_IDS,syllabusPracticeComponentsForRoute} from '../src/lib/syllabusPracticeRoutes.js'
import {questionGroupsFromAiArtifacts,createAiVerifiedQuestionBankLoader,MAX_RUNTIME_ARTIFACTS} from '../server/aiVerifiedQuestionBank.js'
import {artifactId,buildAiStudentStudyRelease} from './ai-pdf-ingestion/contract.mjs'
import {syllabusTopicsInventory,buildSyllabusPracticeSet} from '../src/lib/syllabusPractice.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'stem-runtime-scope-')),libraryRoot=path.join(root,'library')
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
function fixture(routeId,year,component,count=1,topicComponent=component){
 const route=routeById(routeId),subject=route.subjectCode,base=subject+'_s'+String(year).slice(-2),qp=base+'_qp_'+component+'1.pdf',ms=base+'_ms_'+component+'1.pdf',folder=path.join(libraryRoot,subject)
 fs.mkdirSync(folder,{recursive:true});const qBytes=Buffer.from('%PDF-1.4\nfixture-question-'+qp),mBytes=Buffer.from('%PDF-1.4\nfixture-ms-'+ms);fs.writeFileSync(path.join(folder,qp),qBytes);fs.writeFileSync(path.join(folder,ms),mBytes)
 const paperId='cie-'+subject+'-'+qp.slice(0,-4),topic=route.syllabus.topics.find(t=>Number(t.component)===topicComponent)||route.syllabus.topics.find(t=>!t.component)||route.syllabus.topics[0]
 const region={page:1,pageImageSha256:'d'.repeat(64),x0:.1,y0:.1,x1:.9,y1:.8},tags={primaryTopicId:topic.id,secondaryTopicIds:[],syllabusPointIds:[]},evidence=[{page:1,pageImageSha256:'e'.repeat(64)}]
 const artifact={schemaVersion:'ai-pdf-ingestion.v1',artifactId:artifactId({paperId,questionPdfSha256:sha(qBytes),markSchemePdfSha256:sha(mBytes)}),paperId,subject,stage:route.stage,syllabusRouteId:routeId,status:'ai-verified',storageMode:'coordinate-only',extractor:{provider:'openai',model:'fixture-extractor'},verifier:{provider:'qwen',model:'fixture-verifier'},source:{questionPdfPath:path.join(folder,qp),markSchemePdfPath:path.join(folder,ms),questionPdfSha256:sha(qBytes),markSchemePdfSha256:sha(mBytes),renderDpi:180,pageImageHashes:{1:'d'.repeat(64)},pageSizes:{1:{width:1200,height:1600}},markSchemePageHashes:{1:'e'.repeat(64)},markSchemePageSizes:{1:{width:1200,height:1600}}},candidate:{questions:[]},verification:{questions:[]}}
 for(let i=1;i<=count;i++){
  artifact.candidate.questions.push({questionNumber:String(i),questionStartPage:1,regions:[region],diagramRegions:[],parts:[{label:'a',marks:4,ocrText:'Synthetic fixture, not a published question.',math:[],diagramAssociations:[]}],tags,markSchemeEvidence:evidence})
  artifact.verification.questions.push({questionNumber:String(i),questionStartPage:1,pages:[1],regions:[region],diagramRegions:[],parts:[{label:'a',marks:4}],diagramRegionCount:0,tags,markSchemeEvidence:evidence})
 }
 release(artifact);return artifact
}
function release(a){a.extractor.schemaName='ai_pdf_question_extraction_v1';a.verifier.schemaName='ai_pdf_question_verification_v1';a.studentRelease=buildAiStudentStudyRelease({artifactId:a.artifactId,routeId:a.syllabusRouteId,status:a.status,source:a.source,extractor:a.extractor,verifier:a.verifier,candidate:a.candidate,verification:a.verification})}
const load=a=>questionGroupsFromAiArtifacts([a],{libraryRoot})
try{
 assert.equal(SYLLABUS_PRACTICE_ROUTE_IDS.length,22)
 for(const [route,component]of [['cie-9702-a2-physics',4],['cie-0610-igcse-biology',4],['cie-9700-a2-biology',4],['cie-9701-as-chemistry',2],['cie-9708-a2-economics',4]]){
  assert.ok(syllabusPracticeComponentsForRoute(route).includes(component))
  for(const year of [2017,2025])assert.equal(load(fixture(route,year,component)).length,1,route+' '+year)
  assert.equal(load(fixture(route,2016,component)).length,0);assert.equal(load(fixture(route,2026,component)).length,0)
 }
 for(const [route,component]of [['cie-9702-a2-physics',5],['cie-9700-as-biology',3],['cie-0610-igcse-biology',6],['cie-9709-as-p1-p5',7]])assert.equal(load(fixture(route,2025,component)).length,0,'practical/P7 exclusions remain')
 const legacyS1=load(fixture('cie-9709-as-p1-p5',2017,6,1,5));assert.equal(legacyS1.length,1);assert.equal(legacyS1[0].paperComponent,5);assert.equal(legacyS1[0].sourceRef.component,6)
 const legacyS2=load(fixture('cie-9709-a2-after-p1-p5-p3-p6',2019,7,1,6));assert.equal(legacyS2.length,1);assert.equal(legacyS2[0].paperComponent,6);assert.equal(legacyS2[0].sourceRef.component,7)
 assert.equal(load(fixture('cie-9709-as-p1-p5',2018,5,1,5)).length,0,'historical M2 is not current S1')
 const a=fixture('cie-9702-a2-physics',2025,4,12),groups=load(a),topic=routeById(a.syllabusRouteId).syllabus.topics[0].id
 const inv=syllabusTopicsInventory({routeId:a.syllabusRouteId,questionBank:groups,includeStudyOnly:false}),row=inv.topics.find(t=>t.id===topic)
 assert.deepEqual(inv.practicePolicy,{schemaVersion:'stem-topic-practice-policy-v1',minSourceGroups:6,minReviewedGroups:12,setSizes:[6,10,15]})
 assert.equal(row.apiStartable,true);assert.equal(row.formalScoreReady,false);assert.equal(row.questionIdsByComponent[4].apiReadyQuestionIds.length,12)
 const set=buildSyllabusPracticeSet({routeId:a.syllabusRouteId,syllabusTopicIds:[topic],components:[4],questionCount:6,questionBank:groups,includeStudyOnly:false});assert.equal(set.practiceMode,'study-only')
 const missing=structuredClone(a);delete missing.verification.questions[0].regions;assert.equal(load(missing).length,0,'missing independent regions still reject the whole artifact')
 const conflict=structuredClone(a);conflict.candidate.questions[0].parts[0].ocrText='Conflicting source text';release(conflict);const deduplicated=questionGroupsFromAiArtifacts([a,conflict],{libraryRoot});assert.equal(deduplicated.length,11);assert.ok(deduplicated.every(q=>!q.sourceQuestionId.endsWith(':q1')),'both conflicting versions of the source question are rejected, never first-wins')
 const art=path.join(root,'artifacts','paper');fs.mkdirSync(art,{recursive:true});for(let i=0;i<3;i++)fs.writeFileSync(path.join(art,i+'.json'),'{}')
 assert.equal(MAX_RUNTIME_ARTIFACTS,10000)
 assert.throws(()=>createAiVerifiedQuestionBankLoader({artifactRoot:path.dirname(art),libraryRoot,artifactLimit:2})(),e=>e.code==='AI_PDF_RUNTIME_ARTIFACT_LIMIT_EXCEEDED')
 console.log('Native scope: 2017–2025, 22 theory routes, practical/P7 exclusions, source policy, released study IDs, strict regions/duplicates and explicit capacity failure passed.')
}finally{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('stem-runtime-scope-'));fs.rmSync(root,{recursive:true,force:true})}
