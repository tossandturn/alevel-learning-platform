import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {createIeltsPaperDownloads} from '../server/ieltsPaperDownloads.js'
import {createPdfDownloadLedger} from '../server/pdfDownloadQuota.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ielts-downloads-')),db=new DatabaseSync(':memory:'),ledger=createPdfDownloadLedger({database:db})
const owner='ielts:999',entitlement={active:false,expiresAt:null},otherHash='f'.repeat(64)
const files=['qp','ak'].map((kind,index)=>{const data=Buffer.from('%PDF-1.4\nsynthetic fixture '+kind),sha256=crypto.createHash('sha256').update(data).digest('hex'),file=sha256+'.pdf';fs.writeFileSync(path.join(root,file),data);return{id:'ielts-cam4-l-test1-'+kind,sourceId:'cam4-l-test1',book:4,test:1,module:'listening',task:0,kind,title:'Cambridge IELTS 4 - Test 1 - Listening',fileName:'Cambridge_IELTS_4_Test_1_Listening_'+kind+'.pdf',file,sha256,bytes:data.length,pages:1,answerStatus:'available'}})
fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify({schemaVersion:'ielts-paper-downloads-v1',version:'a'.repeat(24),files}))
const service=createIeltsPaperDownloads({root,authorizeFile:async({request,sha256,consume})=>{if(request.headers.authorization!=='Bearer synthetic')throw Object.assign(Error('请登录'),{code:'pdf_auth_required',statusCode:401});return consume?ledger.grant({userId:owner,sha256,entitlement}):{metadataOnly:true}}})
const server=http.createServer((req,res)=>Promise.resolve(service.handle(req,res,new URL(req.url,'http://local'))).then(handled=>{if(!handled){res.statusCode=404;res.end()}}).catch(()=>{res.statusCode=500;res.end()}))
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port
const get=(file=files[0],headers={},method='GET')=>fetch(base+'/api/stem/ielts-papers/files/'+file.id,{method,headers:{Authorization:'Bearer synthetic',...headers}})
try{
 const catalog=await(await fetch(base+'/api/stem/ielts-papers')).json();assert.equal(catalog.items.length,2);assert.equal(catalog.items[0].file,undefined)
 assert.equal((await get(files[0],{Authorization:''})).status,401)
 assert.equal((await get(files[0],{},'HEAD')).status,200)
 assert.equal((await get(files[0],{Range:'bytes=999999-'})).status,416)
 assert.equal(ledger.lookup({userId:owner,sha256:files[0].sha256}),null,'HEAD and invalid ranges do not consume')
 ledger.grant({userId:owner,sha256:otherHash,entitlement}) // Existing AP/CIE/IB quota consumes the same ledger.
 const first=await get(files[0],{Range:'bytes=0-4'});assert.equal(first.status,206);assert.equal(await first.text(),'%PDF-');assert.equal(first.headers.get('x-pdf-quota-used'),'2')
 assert.equal((await get(files[0],{Range:'bytes=5-'})).status,206)
 assert.equal((await get(files[0],{'If-None-Match':'"'+files[0].sha256+'"'})).status,304)
 const exhausted=await get(files[1]);assert.equal(exhausted.status,429);assert.equal(exhausted.headers.get('x-pdf-access-code'),'pdf_daily_limit_reached')
 assert.equal((await fetch(base+'/api/stem/ielts-papers/files/unknown')).status,404)
 console.log('PASS IELTS PDFs: shared allowance, original/answer IDs, auth, metadata, 206/resume, 304 and no quota bypass.')
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();fs.rmSync(root,{recursive:true})}
