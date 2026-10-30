import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createPdfDownloadPolicy,authorizePdfFile,applyPdfQuotaHeaders} from '../server/pdfDownloadPolicy.js'
const db=new DatabaseSync(':memory:'),now=Date.now(),env={STEM_INTERNAL_AUTH_KEY:'synthetic-secret-only'},request={valid:true,headers:{'x-stemist-download-policy':'shared-files-v1'}}
let member=false
const options={env,clock:()=>now,authenticateRequest:r=>{if(!r?.valid)throw Object.assign(Error('unauthorized'),{statusCode:401});return{id:'ielts:42'}},databaseProvider:()=>db,fetchImpl:async()=>new Response(JSON.stringify({protocol:'stemist-membership-v1',authority:'ieltsist-membership',userId:'ielts:42',entitlement:{active:member,expiresAt:member?new Date(now+3600000).toISOString():null},checkedAt:new Date(now).toISOString(),maxAgeSeconds:30}))}
const policy=createPdfDownloadPolicy(options)
assert.equal(policy.enabled(),false,'global compatibility gate unchanged')
assert.equal(policy.enabled(request),true,'new client voluntarily enters strict shared-file quota')
assert.equal(await policy.authorize({request:{},sha256:'x'}),null)
await assert.rejects(policy.authorize({request:{headers:request.headers},sha256:'a'.repeat(64)}),e=>e.code==='pdf_auth_required')
await assert.rejects(authorizePdfFile({env,request,sha256:'a'.repeat(64)}),e=>e.code==='pdf_quota_unavailable','opt-in fails closed when wiring is missing')
const pdf=await policy.authorize({request,sha256:'a'.repeat(64)});assert.equal(pdf.used,1)
const forced=createPdfDownloadPolicy({...options,env:{...env,STEM_PDF_DOWNLOAD_QUOTA_ENABLED:'1',STEM_PDF_DOWNLOAD_QUOTA_READY:'1'}})
const audio=await forced.authorize({request,sha256:'b'.repeat(64)});assert.equal(audio.used,2)
await assert.rejects(forced.authorize({request,sha256:'c'.repeat(64)}),e=>e.code==='pdf_daily_limit_reached'&&/音频/.test(e.message))
assert.equal((await policy.authorize({request,sha256:'a'.repeat(64)})).reused,true)
member=true;assert.equal((await forced.authorize({request,sha256:'c'.repeat(64)})).unlimited,true)
const headers={};applyPdfQuotaHeaders({setHeader:(k,v)=>headers[k]=v},pdf);assert.match(headers.Vary,/X-Stemist-Download-Policy/i)
db.close();console.log('Shared PDF/audio client policy: opt-in, auth, canonical ledger, limit/member/retry and cache variation PASS')
