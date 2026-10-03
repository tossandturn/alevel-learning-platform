import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createCurriculumPracticeAccess, closeStemDatabaseForTests } from '../server/stemApi.js'
const canonical='fixture-curriculum-canonical',legacy='fixture-curriculum-legacy'
const now=Math.floor(Date.now()/1000)
const token=(key,overrides={})=>{
 const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
 const payload=Buffer.from(JSON.stringify({iss:'ieltsist.com',aud:'stem.ieltsist.com',sub:'ielts:999999',username:'Synthetic learner',iat:now,exp:now+300,...overrides})).toString('base64url')
 return `${header}.${payload}.${crypto.createHmac('sha256',key).update(`${header}.${payload}`).digest('base64url')}`
}
const request=(key,overrides)=>({headers:{authorization:'Bearer '+token(key,overrides)}})
const fail401=fn=>assert.throws(fn,error=>error?.statusCode===401)
const access=createCurriculumPracticeAccess({env:{STEM_INTERNAL_AUTH_KEY:canonical,STEM_IDENTITY_SIGNING_KEY:legacy,STEM_DB_PATH:':memory:'},questionBank:[]})
assert.ok(Object.isFrozen(access))
assert.equal(access.authenticateRequest(request(canonical)).id,'ielts:999999')
fail401(()=>access.authenticateRequest(request(legacy)))
fail401(()=>access.authenticateRequest({headers:{}}))
fail401(()=>access.authenticateRequest(request(canonical,{aud:'another-service'})))
fail401(()=>access.authenticateRequest(request(canonical,{exp:now+7200})))
assert.equal(createCurriculumPracticeAccess({env:{STEM_IDENTITY_SIGNING_KEY:legacy}}).authenticateRequest(request(legacy)).id,'ielts:999999')
try{
 const db=access.databaseProvider()
 assert.equal(access.databaseProvider(),db)
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='student_attempts'").get())
}finally{closeStemDatabaseForTests()}
console.log(JSON.stringify({status:'PASS',scope:'curriculum-shared-auth-key-precedence-and-lazy-database'}))
