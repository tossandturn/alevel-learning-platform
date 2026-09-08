import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {createNativeQuestionImages} from '../server/nativeQuestionImages.js'
const bytes=Buffer.from('synthetic-page'),hash=crypto.createHash('sha256').update(bytes).digest('hex')
const evidence={page:1,documentSha256:'a'.repeat(64),pageImageSha256:hash,imageSize:[1488,2105],coordinateSpace:'normalized-xyxy',region:[.1,.2,.9,.8]}
const question={routeId:'cie-9702-a2-physics',sourceQuestionId:'cie-9702-9702_s25_qp_41:q1',subjectCode:'9702',released:true,sourceRef:{paper:'9702_s25_qp_41.pdf',sha256:'a'.repeat(64),renderDpi:180},sourceContent:{schemaVersion:'ai-verified-coordinate-source-v1',complete:true,fileComplete:true,bindingSignature:'fixture-binding'},parts:[{sourceEvidence:[evidence]},{sourceEvidence:[evidence]}],diagramRegions:[{...evidence,region:[.2,.3,.8,.6]}]}
let bank=[question],calls=0,finish
const service=createNativeQuestionImages({getQuestionBank:()=>bank,libraryRoot:'/fixture',isReleased:q=>q.released===true,pageReader:async spec=>{calls++;assert.equal(spec.role,'question-paper');assert.equal(spec.expectedPdfSha256,'a'.repeat(64));assert.equal(spec.expectedPageImageSha256,hash);await new Promise(resolve=>{finish=resolve});return {bytes,contentType:'image/png',sha256:hash}}})
const descriptors=service.descriptors(question.routeId,question.sourceQuestionId);assert.equal(descriptors.length,1,'deduplicate shared parts and retain the containing whole-question region')
const input=Object.fromEntries(new URL(descriptors[0].url,'https://example.test').searchParams)
assert.throws(()=>service.image({...input,sourceQuestionId:'missing'}),e=>e.statusCode===404);assert.equal(calls,0)
assert.throws(()=>service.image({...input,v:'c'.repeat(64)}),e=>e.statusCode===409);assert.equal(calls,0)
const first=service.image(input),same=service.image(input);assert.equal(first,same);finish();const result=await first;assert.deepEqual(result.bytes,bytes);assert.equal(calls,1);await service.image(input);assert.equal(calls,1,'cached verified pixels do not reread')
bank=[{...question,released:false}];assert.throws(()=>service.image(input),e=>e.statusCode===404,'release is rechecked before a cache hit')
assert.equal(service.descriptors(question.routeId,question.sourceQuestionId).length,0)
bank=[{...question,parts:[{sourceEvidence:[{...evidence,documentSha256:'e'.repeat(64)}]}],diagramRegions:[]}];assert.equal(service.descriptors(question.routeId,question.sourceQuestionId).length,0,'foreign document evidence cannot render')
bank=[question];const projected=service.projectSet({questionGroups:[{id:question.sourceQuestionId,routeId:question.routeId,sourceContent:{assetUrls:[]}}]});assert.equal(projected.questionGroups[0].nativeSourceImages[0].page,1)
console.log('Native question images: released source-only lookup, exact hash/region binding, duplicate/diagram containment, scoped URLs, coalescing/cache and revocation passed.')
