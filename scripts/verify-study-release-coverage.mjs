import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import {createAiVerifiedQuestionBankLoader} from '../server/aiVerifiedQuestionBank.js'
import {createStemApi,closeStemDatabaseForTests} from '../server/stemApi.js'
import {isStudentReleasedAiStudyItem} from '../src/data/questionBank.js'
import {assertStudyReleaseInventory} from './study-release-policy.mjs'

const values=name=>process.argv.flatMap((arg,i)=>arg===name?[process.argv[i+1]]:[])
const routes=values('--route'),roots=values('--artifact-root'),libraryRoot=values('--pdf-library-root')[0]
assert.ok(routes.length&&routes.every(r=>/^[a-zA-Z0-9-]+$/.test(r))&&new Set(routes).size===routes.length,'explicit unique routes required')
assert.ok(roots.length&&libraryRoot,'explicit artifact and PDF roots required')
for(const p of [...roots,libraryRoot])assert.ok(fs.statSync(path.resolve(p)).isDirectory(),'source directory required')
const groups=roots.flatMap(artifactRoot=>createAiVerifiedQuestionBankLoader({artifactRoot,libraryRoot})().groups)
assert.ok(groups.length,'AI study release requires approved runtime artifacts')
assert.equal(new Set(groups.map(q=>q.routeId+':'+q.sourceQuestionId)).size,groups.length,'duplicate runtime identity')
assert.ok(groups.every(q=>isStudentReleasedAiStudyItem(q)&&q.formalProgressEligible===false),'runtime AI must be released-study and excluded from formal progress')
const api=createStemApi({env:{NODE_ENV:'production',STEM_DB_PATH:':memory:'},topicQuestionBankProvider:()=>groups,libraryRoot}),server=http.createServer((req,res)=>api(req,res,()=>{res.statusCode=404;res.end()})),reports=[]
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 for(const routeId of routes){const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/stem/routes/'+routeId+'/syllabus-topics');assert.equal(response.status,200);reports.push(assertStudyReleaseInventory(await response.json(),routeId))}
 console.log(JSON.stringify({status:'PASS',readinessMode:'student-study',runtimeGroups:groups.length,aiStudyFormalProgressEligible:false,routes:reports}))
}finally{await new Promise(r=>server.close(r));closeStemDatabaseForTests()}
