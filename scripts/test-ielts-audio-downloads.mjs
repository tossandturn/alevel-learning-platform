import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {createPdfDownloadLedger} from '../server/pdfDownloadQuota.js'
const module=await import('../server/ieltsAudioDownloads.js').catch(()=>({}))
assert.equal(typeof module.createIeltsAudioDownloads,'function','A canonical protected audio download gateway is required')
const parent=path.resolve(import.meta.dirname,'../..'),root=fs.mkdtempSync(path.join(parent,'audio-fixture-')),db=new DatabaseSync(':memory:'),ledger=createPdfDownloadLedger({database:db}),owner='ielts:999',entitlement={active:false,expiresAt:null}
const files=[0,1,2].map(i=>{const bytes=Buffer.alloc(2048,65+i);bytes.write('ID3');const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),file=sha256+'.mp3';fs.writeFileSync(path.join(root,file),bytes);return{id:'audio-'+String(i+1).repeat(32),taskId:'cam12-l-test1',book:12,test:5,practiceTest:1,track:i+1,trackCount:3,title:'Synthetic Cambridge12 Test5 audio'+i,fileName:'Cambridge_IELTS_12_Test_5_Listening_Audio_'+(i+1)+'.mp3',file,sha256,bytes:bytes.length,sourceRelative:'private-should-not-leak'}})
fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify({schemaVersion:'ielts-audio-downloads-v1',version:'a'.repeat(24),files}))
const service=module.createIeltsAudioDownloads({root,authorizeFile:async({request,sha256,consume})=>{if(request.headers.authorization!=='Bearer synthetic')throw Object.assign(Error('请登录'),{code:'pdf_auth_required',statusCode:401});return consume?ledger.grant({userId:owner,sha256,entitlement}):{metadataOnly:true}}})
const server=http.createServer((req,res)=>Promise.resolve(service.handle(req,res,new URL(req.url,'http://local'))).then(handled=>{if(!handled){res.statusCode=404;res.end()}}).catch(()=>{res.statusCode=500;res.end()}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port
const get=(file=files[0],headers={},method='GET')=>fetch(base+'/api/stem/ielts-audio/files/'+file.id,{method,headers:{Authorization:'Bearer synthetic',...headers}})
try{
 const catalog=await(await fetch(base+'/api/stem/ielts-audio?taskId=cam12-l-test1')).json();assert.equal(catalog.items.length,3);assert.equal(catalog.items[0].test,5);assert.equal(catalog.items[0].practiceTest,1);assert.equal(catalog.items[0].file,undefined);assert.equal(catalog.items[0].sourceRelative,undefined)
 assert.equal((await(await fetch(base+'/api/stem/ielts-audio?book=21')).json()).items.length,0)
 assert.equal((await get(files[0],{Authorization:''})).status,401);assert.equal((await get(files[0],{},'HEAD')).status,200);assert.equal((await get(files[0],{Range:'bytes=9000-'})).status,416)
 assert.equal((await get(files[0],{'If-None-Match':'"'+files[0].sha256+'"'})).status,304);assert.equal((await get(files[0],{'If-Match':'"stale-source"'})).status,412);assert.equal(ledger.lookup({userId:owner,sha256:files[0].sha256}),null)
 ledger.grant({userId:owner,sha256:'f'.repeat(64),entitlement})
 const first=await get(files[0],{Range:'bytes=0-2'});assert.equal(first.status,206);assert.equal(await first.text(),'ID3');assert.equal(first.headers.get('x-pdf-quota-used'),'2');assert.equal(first.headers.get('content-type'),'audio/mpeg')
 assert.equal((await get(files[0],{Range:'bytes=3-'})).status,206)
 const denied=await get(files[1]);assert.equal(denied.status,429);assert.equal(denied.headers.get('x-pdf-access-code'),'pdf_daily_limit_reached')
 entitlement.active=true;entitlement.expiresAt=new Date(Date.now()+3600000).toISOString();assert.equal((await get(files[1])).status,200)
 fs.writeFileSync(path.join(root,files[2].file),Buffer.alloc(files[2].bytes,0));assert.equal((await get(files[2])).status,503);assert.equal(ledger.lookup({userId:owner,sha256:files[2].sha256}),null,'corrupt files do not spend allowance')
 assert.equal((await fetch(base+'/api/stem/ielts-audio/files/unknown')).status,404)
 assert.equal((await fetch(base+'/api/stem/ielts-audio/files/%2e%2e%2fprivate')).status,404)
 console.log('Audio gateway: metadata, source bounds, original test labels, shared PDF allowance, auth, member, Range/resume, no-count metadata and integrity PASS')
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();assert.ok(root.startsWith(parent+path.sep+'audio-fixture-'));fs.rmSync(root,{recursive:true})}
