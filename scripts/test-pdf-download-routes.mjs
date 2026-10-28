import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {sendLocalPdf} from '../vite.config.js'
import {createCurriculumPaperCatalog} from '../server/curriculumPaperCatalog.js'
import {createPdfDownloadPolicy,sendPdfAccessError} from '../server/pdfDownloadPolicy.js'

const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-quota-routes-')),db=new DatabaseSync(':memory:')
const originalCwd=process.cwd();process.chdir(dir)
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),bytes=tag=>Buffer.from('%PDF-1.4\nsynthetic '+tag+'\n%%EOF\n')
const data={a:bytes('question'),b:bytes('answer'),c:bytes('AP'),d:bytes('IB')}
await fs.mkdir(path.join(dir,'9702'));await fs.mkdir(path.join(dir,'assets'))
const docs=[]
for(const [key,kind] of [['a','qp'],['b','ms']]){const file='9702_m26_'+kind+'_12.pdf';await fs.writeFile(path.join(dir,'9702',file),data[key]);docs.push({id:'synthetic-'+key,subject:'9702',file,kind,bytes:data[key].length,sha256:sha(data[key])})}
await fs.writeFile(path.join(dir,'9702','bad.pdf'),data.a);docs.push({id:'bad',subject:'9702',file:'bad.pdf',kind:'qp',bytes:data.a.length,sha256:'0'.repeat(64)})
const files=[]
for(const key of ['a','c','d']){await fs.writeFile(path.join(dir,'assets',key+'.pdf'),data[key]);files.push({id:'file-'+key,name:key+'.pdf',bytes:data[key].length,pages:1,sha256:sha(data[key]),relativePath:key+'.pdf',rightsStatus:'licensed',integrityStatus:'verified'})}
const papers=files.map((file,index)=>({id:'synthetic-paper-'+index,board:index===2?'ib':'ap',course:index===2?'ib-physics':'ap-physics',courseLabel:index===2?'IB Physics':'AP Physics',subject:'Physics',level:index===2?'HL':'AP',year:2026,session:'May',paper:'1',variant:'',title:'Synthetic paper',section:'Questions',fullExam:false,practiceReady:false,pairStatus:'missing',questionPaper:file,markScheme:null}))
await fs.writeFile(path.join(dir,'catalog.json'),JSON.stringify({schemaVersion:'curriculum-paper-source-v1',generatedAt:new Date().toISOString(),courses:[{id:'ap-physics',board:'ap',label:'AP Physics',subject:'Physics'},{id:'ib-physics',board:'ib',label:'IB Physics',subject:'Physics'}],papers}))
const env={CIE_LIBRARY_ROOT:dir,STEM_PDF_ACCESS_LOG_PATH:path.join(dir,'access.jsonl'),STEM_PDF_DOWNLOAD_QUOTA_ENABLED:'1',STEM_PDF_DOWNLOAD_QUOTA_READY:'1',STEM_INTERNAL_AUTH_KEY:'synthetic-key'}
const policy=createPdfDownloadPolicy({env,databaseProvider:()=>db,authenticateRequest:request=>request.headers.authorization==='Bearer synthetic-free'?{id:'ielts:42'}:request.headers.cookie==='synthetic=other'?{id:'ielts:43'}:null,fetchImpl:async(_url,options)=>new Response(JSON.stringify({protocol:'stemist-membership-v1',authority:'ieltsist-membership',userId:JSON.parse(options.body).userId,entitlement:{active:false,expiresAt:null},checkedAt:new Date().toISOString(),maxAgeSeconds:30}),{status:200})})
const authorizeFile=context=>policy.authorize(context)
const catalog=createCurriculumPaperCatalog({manifestPath:path.join(dir,'catalog.json'),assetRoot:path.join(dir,'assets'),authorizeFile})
const server=http.createServer(async(request,response)=>{try{if(await catalog.handle(request,response))return;await sendLocalPdf(request,response,()=>{response.statusCode=404;response.end()},env,()=>docs,{authorizeFile})}catch(error){if(!sendPdfAccessError(response,error)){response.statusCode=500;response.end('Unexpected fixture failure')}}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer synthetic-free'},qp='/local-pdf/9702/9702_m26_qp_12.pdf',ms='/local-pdf/9702/9702_m26_ms_12.pdf',ap='/api/stem/curriculum-papers/files/file-c',ib='/api/stem/curriculum-papers/files/file-d'
const rows=()=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pdf_download_grants'").get()?db.prepare('SELECT COUNT(*) AS n FROM pdf_download_grants').get().n:0
async function get(url,options={}){const result=await fetch(origin+url,{...options,headers:{...headers,...options.headers}});await result.arrayBuffer();return result}
try{
 assert.equal((await get(qp,{headers:{Authorization:''}})).status,401,'Direct CIE bytes require an authenticated account')
 assert.equal((await get(ap,{headers:{Authorization:''}})).status,401,'Direct AP bytes require an authenticated account')
 assert.equal((await get(qp,{method:'HEAD'})).status,200);assert.equal((await get(ap,{method:'HEAD'})).status,200)
 assert.equal((await get(qp,{headers:{'If-None-Match':'"'+sha(data.a)+'"'}})).status,304)
 assert.equal((await get(ap,{headers:{'If-None-Match':'"'+sha(data.c)+'"'}})).status,304)
 assert.equal((await get(qp,{method:'POST'})).status,405)
 assert.equal((await get(qp,{headers:{Range:'bytes=99999-999999'}})).status,416)
 assert.equal((await get(ap,{headers:{Range:'bytes=99999-999999'}})).status,416)
 assert.equal((await get('/local-pdf/9702/missing.pdf')).status,404)
 assert.equal((await get('/local-pdf/9702/bad.pdf')).status,409)
 assert.equal(rows(),0,'HEAD/304/invalid source or range must not consume')
 assert.equal((await get(qp,{headers:{Range:'bytes=0-4'}})).status,206);assert.equal(rows(),1)
 for(let i=0;i<4;i++)assert.equal((await get(qp,{headers:{Range:'bytes=5-10'}})).status,206)
 assert.equal(rows(),1,'Multiple Range requests count one file')
 assert.equal((await get(ms)).status,200);assert.equal(rows(),2,'Question and answer together consume both free files')
 const blocked=await get(ap);assert.equal(blocked.status,429);assert.equal(blocked.headers.get('x-pdf-access-code'),'pdf_daily_limit_reached');assert.equal(rows(),2)
 assert.equal((await get('/api/stem/curriculum-papers/files/file-a')).status,200,'Same SHA through another catalog/URL does not consume again')
 const other={Authorization:'',Cookie:'synthetic=other'}
 assert.equal((await get(ap,{headers:other})).status,200);assert.equal((await get(ib,{headers:other})).status,200)
 assert.equal((await get(qp,{headers:other})).status,429,'AP/IB and CIE use one account/day budget')
 assert.equal(rows(),4)
 console.log('Hosted CIE/AP/IB quota routes: shared limit, alias SHA, Range, auth, metadata and invalid requests PASS')
}finally{await new Promise(resolve=>server.close(resolve));db.close();process.chdir(originalCwd);const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('pdf-quota-routes-'))throw Error('Unsafe fixture cleanup');await fs.rm(resolved,{recursive:true,force:true})}
