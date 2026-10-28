import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
const module=await import('../server/pdfDownloadQuota.js').catch(()=>({}))
assert.equal(typeof module.createPdfDownloadLedger,'function','A durable per-file quota ledger must exist')
const {createPdfDownloadLedger,beijingDownloadDay}=module
const db=new DatabaseSync(':memory:')
let now=Date.parse('2026-10-28T15:59:59.999Z')
const ledger=createPdfDownloadLedger({database:db,clock:()=>now})
const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64)
const free={active:false,expiresAt:null},member={active:true,expiresAt:'2026-10-30T00:00:00.000Z'}
const use=(sha,entitlement=free,userId='ielts:42')=>ledger.grant({userId,sha256:sha,entitlement})
assert.deepEqual(beijingDownloadDay(now),{day:'2026-10-28',resetAt:'2026-10-28T16:00:00.000Z'})
assert.equal(use(a).used,1);assert.equal(use(b).remaining,0)
for(let i=0;i<8;i++){const result=use(a);assert.equal(result.used,2);assert.equal(result.reused,true)}
assert.throws(()=>use(c),error=>error.statusCode===429&&error.code==='pdf_daily_limit_reached'&&error.quota.remaining===0)
assert.equal(use(c,free,'ielts:43').used,1,'Accounts do not share free quota')
assert.equal(use(c,member).unlimited,true,'An active member can access another file after free quota is used')
assert.equal(use(c,free).reused,true,'A member-granted file remains resumable on the same day after expiry')
assert.throws(()=>use('d'.repeat(64),{active:true,expiresAt:new Date(now).toISOString()}),error=>error.code==='pdf_daily_limit_reached','Expired entitlement is not unlimited')
assert.equal(ledger.lookup({userId:'ielts:42',sha256:a}).used,2)
now++
assert.equal(beijingDownloadDay(now).day,'2026-10-29');assert.equal(use(c).used,1);assert.equal(use(a).used,2)
assert.throws(()=>use(b),error=>error.code==='pdf_daily_limit_reached')
assert.equal(ledger.lookup({userId:'ielts:42',sha256:b}),null,'A prior-day grant does not silently grant a new day')
for(const userId of ['guest','42','ielts:0','ielts:01','ielts:9007199254740992'])assert.throws(()=>use(a,free,userId),/account/i)
for(const sha of ['a','A'.repeat(64),'../paper.pdf',''])assert.throws(()=>use(sha),/file/i)
assert.equal(beijingDownloadDay(Date.parse('2026-12-31T16:00:00Z')).day,'2027-01-01')
assert.throws(()=>beijingDownloadDay(NaN),/time/i)
db.close()
console.log('PDF quota: two distinct files, retries, account isolation, member expiry and Beijing midnight PASS')
