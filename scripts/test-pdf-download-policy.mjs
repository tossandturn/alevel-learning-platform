import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
const module=await import('../server/pdfDownloadPolicy.js').catch(()=>({}))
assert.equal(typeof module.createPdfDownloadPolicy,'function','Hosted downloads need an authenticated quota policy')
const {createPdfDownloadPolicy}=module
assert.equal(typeof module.authorizePdfFile,'function','Enabled file routes must reject a missing authorizer')
const now=Date.now(),sha='a'.repeat(64),key='synthetic-test-key-only'
const env={STEM_PDF_DOWNLOAD_QUOTA_ENABLED:'1',STEM_PDF_DOWNLOAD_QUOTA_READY:'1',STEM_INTERNAL_AUTH_KEY:key}
await assert.rejects(module.authorizePdfFile({env,request:{},sha256:sha}),e=>e.code==='pdf_quota_unavailable')
await assert.rejects(module.authorizePdfFile({env,authorizeFile:async()=>null,request:{},sha256:sha}),e=>e.code==='pdf_quota_unavailable')
assert.equal(await module.authorizePdfFile({env:{},request:{},sha256:sha}),null)
let queries=0,broken=false,member=false,owner='ielts:42',dbCalls=0
const db=new DatabaseSync(':memory:')
const fetchImpl=async(url,options)=>{
 queries++;assert.equal(url,'http://127.0.0.1:4321/api/stem/internal/entitlements');assert.equal(options.redirect,'error')
 const payload=JSON.parse(options.body);assert.equal(payload.userId,owner);assert.deepEqual(payload.featureIds,['stem.all-access'])
 const timestamp=options.headers['x-stem-auth-timestamp'],digest=crypto.createHash('sha256').update(options.body).digest('hex')
 assert.equal(options.headers['x-stem-auth-signature'],crypto.createHmac('sha256',key).update(timestamp+'.'+digest).digest('base64url'))
 if(broken)throw Error('SENSITIVE PROVIDER DETAILS')
 return new Response(JSON.stringify({protocol:'stemist-membership-v1',authority:'ieltsist-membership',userId:owner,entitlement:{active:member,expiresAt:member?new Date(now+3600000).toISOString():null},enforcement:{enabled:false},features:{'stem.all-access':{allowed:true}},checkedAt:new Date(now).toISOString(),maxAgeSeconds:30}),{status:200})
}
const policy=createPdfDownloadPolicy({env,clock:()=>now,authenticateRequest:request=>{if(!request.valid)throw Object.assign(Error('bad identity'),{statusCode:401});return{id:owner}},databaseProvider:()=>{dbCalls++;return db},fetchImpl})
assert.equal(policy.enabled(),true)
const request={valid:true,method:'GET'}
await assert.rejects(policy.authorize({request:{},sha256:sha}),error=>error.statusCode===401&&error.code==='pdf_auth_required')
assert.equal(dbCalls,0,'Unauthenticated requests do not touch quota storage')
await policy.authorize({request,sha256:sha,consume:false});assert.equal(queries,0);assert.equal(dbCalls,0,'HEAD/304 authorization does not query entitlement or reserve')
const first=await policy.authorize({request,sha256:sha});assert.equal(first.used,1);assert.equal(first.unlimited,false,'Global features.allowed=true is not paid membership')
broken=true
const retry=await policy.authorize({request,sha256:sha});assert.equal(retry.reused,true);assert.equal(queries,1,'Previously granted file resumes without an authority dependency')
await assert.rejects(policy.authorize({request,sha256:'b'.repeat(64)}),error=>error.statusCode===503&&!error.message.includes('SENSITIVE'))
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pdf_download_grants').get().n,1)
broken=false;member=true
for(const char of ['b','c','d','e'])assert.equal((await policy.authorize({request,sha256:char.repeat(64)})).unlimited,true)
owner='ielts:43';member=false
await policy.authorize({request,sha256:sha});await policy.authorize({request,sha256:'b'.repeat(64)})
await assert.rejects(policy.authorize({request,sha256:'c'.repeat(64)}),error=>error.statusCode===429)
for(const origin of ['https://external.example','http://169.254.169.254','http://user:pass@127.0.0.1:4321']){
 const other=new DatabaseSync(':memory:');let calls=0
 const invalid=createPdfDownloadPolicy({env:{...env,STEM_AUTH_INTERNAL_ORIGIN:origin},authenticateRequest:()=>({id:'ielts:44'}),databaseProvider:()=>other,fetchImpl:async()=>{calls++;throw Error('should not fetch')}})
 await assert.rejects(invalid.authorize({request,sha256:sha}),error=>error.statusCode===503);assert.equal(calls,0);other.close()
}
const disabled=createPdfDownloadPolicy({env:{},authenticateRequest:()=>{throw Error('off')},databaseProvider:()=>{throw Error('off')},fetchImpl:()=>{throw Error('off')}})
assert.equal(disabled.enabled(),false);assert.equal(await disabled.authorize({request:{},sha256:''}),null)
for(const partial of [{STEM_PDF_DOWNLOAD_QUOTA_ENABLED:'1'},{STEM_PDF_DOWNLOAD_QUOTA_READY:'1'}]){
 const off=createPdfDownloadPolicy({env:partial,authenticateRequest:()=>{throw Error('must stay off')}})
 assert.equal(off.enabled(),false);assert.equal(await off.authorize({request:{},sha256:''}),null)
}
const authority={protocol:'stemist-membership-v1',authority:'ieltsist-membership',userId:'ielts:44',entitlement:{active:false,expiresAt:null},checkedAt:new Date(now).toISOString(),maxAgeSeconds:30}
for(const value of [{...authority,protocol:'wrong'},{...authority,authority:'wrong'},{...authority,userId:'ielts:45'},{...authority,maxAgeSeconds:300},{...authority,checkedAt:new Date(now-60001).toISOString()},{...authority,checkedAt:new Date(now+5001).toISOString()},{...authority,entitlement:{active:true,expiresAt:'invalid'}},'malformed']){
 const other=new DatabaseSync(':memory:')
 const invalid=createPdfDownloadPolicy({env,clock:()=>now,authenticateRequest:()=>({id:'ielts:44'}),databaseProvider:()=>other,fetchImpl:async()=>new Response(typeof value==='string'?value:JSON.stringify(value))})
 await assert.rejects(invalid.authorize({request,sha256:sha}),e=>e.code==='pdf_quota_unavailable')
 assert.equal(other.prepare('SELECT COUNT(*) AS n FROM pdf_download_grants').get().n,0);other.close()
}
{
 const other=new DatabaseSync(':memory:');let calls=0
 const parallel=createPdfDownloadPolicy({env,clock:()=>now,authenticateRequest:()=>({id:'ielts:44'}),databaseProvider:()=>other,fetchImpl:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return new Response(JSON.stringify(authority))}})
 const results=await Promise.allSettled(['a','b','c','d'].map(char=>parallel.authorize({request,sha256:char.repeat(64)})))
 assert.equal(calls,1,'Simultaneous new-file checks share one authority request')
 assert.equal(results.filter(value=>value.status==='fulfilled').length,2)
 assert.equal(results.filter(value=>value.reason?.code==='pdf_daily_limit_reached').length,2);other.close()
}
db.close();console.log('PDF quota policy: signed authority, actual membership, metadata/no-count, resume independence and fail closed PASS')
