import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as api from '../server/stemApi.js'
import {unifiedQuestionBank} from '../src/data/questionBank.js'
import {sourceBindingSignature} from '../src/lib/sourceContentContract.js'
assert.equal(typeof api.nativePaperContext,'function','native paper context must be provided by the source authority')
const scope={routeId:'cie-9702-as-physics',stage:'AS',paperId:'cie-9702-9702_m25_qp_22'}
const context=api.nativePaperContext(unifiedQuestionBank,scope)
assert.equal(context.schemaVersion,'native-paper-context-v1');assert.equal(context.questions.length,7)
assert.equal(context.questions.flatMap(q=>q.parts).length,29)
assert.ok(context.questions.every(q=>q.sourceQuestionId.startsWith(scope.paperId+':q')))
assert.ok(context.questions.flatMap(q=>q.images).every(url=>url.includes('/qp-')))
assert.doesNotMatch(JSON.stringify(context),/"(?:answer|answerKey|exactAnswer|markPoints|markScheme)"\s*:/)
const tiny=unifiedQuestionBank.filter(q=>q.sourceRef?.paperId===scope.paperId).slice(0,2)
assert.equal(api.nativePaperContext(tiny,scope).questions.length,2,'whole-paper source access must not depend on Topic Drill 6/12 gates')
const sourceOnly=structuredClone(tiny[0]);sourceOnly.parts=[]
assert.equal(api.nativePaperContext([sourceOnly],scope).questions.length,0,'a stale audit cannot authorize modified source metadata')
// Test-only source publication with an updated audit and no marking parts.
sourceOnly.sourceContent.audit.bindingSignature=sourceBindingSignature(sourceOnly)
const readable=api.nativePaperContext([sourceOnly],scope)
assert.equal(readable.questions.length,1,'audited readable source does not require marking parts');assert.equal(readable.questions[0].parts.length,0);assert.ok(readable.questions[0].images.length)
sourceOnly.sourceContent.complete=false;assert.equal(api.nativePaperContext([sourceOnly],scope).questions.length,0,'unreleased source-only material stays excluded')
assert.throws(()=>api.nativePaperContext(unifiedQuestionBank,{...scope,stage:'A2'}))
const noDatabaseDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'stem-native-no-database-')),databasePath=path.join(noDatabaseDirectory,'must-not-be-created.sqlite')
const signingKey='native-paper-context-test-key',env={STEM_INTERNAL_AUTH_KEY:signingKey,STEM_DB_PATH:databasePath}
const middleware=api.createStemApi({env})
const server=http.createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end()}))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const url='http://127.0.0.1:'+server.address().port+'/api/stem/papers/'+scope.paperId+'/native-context?routeId='+scope.routeId+'&stage=AS'
try{
 const sourceResponse=await fetch(url.replace('/native-context?','/source-context?'))
 const sourceBody=await sourceResponse.json();assert.equal(sourceResponse.status,200);assert.equal(sourceBody.schemaVersion,'native-paper-sources-v1')
 assert.ok(sourceBody.questions.every(q=>q.images.every(image=>image.startsWith('/question-assets/'+scope.paperId+'/'))))
 assert.doesNotMatch(JSON.stringify(sourceBody),/"(?:parts|provenance|bindingSignature|marks|answer|markScheme)"\s*:/,'public image mapping never carries grading authority or answers')
 assert.equal((await fetch(url)).status,401)
 const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
 const payload=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:100',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')
 const signature=crypto.createHmac('sha256',signingKey).update(header+'.'+payload).digest('base64url')
 const response=await fetch(url,{headers:{Authorization:'Bearer '+header+'.'+payload+'.'+signature}})
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.questions.length,7)
 assert.equal(fs.existsSync(databasePath),false,'source and authenticated read-only context never initialize or seed the learning database')
 console.log('Native paper context: authenticated, route-bound, source-only metadata; independent 6/12 gates preserved.')
}finally{await new Promise(resolve=>server.close(resolve));api.closeStemDatabaseForTests();assert.equal(path.dirname(path.resolve(noDatabaseDirectory)),path.resolve(os.tmpdir()));assert.ok(path.basename(noDatabaseDirectory).startsWith('stem-native-no-database-'));fs.rmSync(noDatabaseDirectory,{recursive:true,force:true})}
