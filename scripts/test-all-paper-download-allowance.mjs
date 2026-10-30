import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {DatabaseSync} from 'node:sqlite'
import {sendLocalPdf} from '../vite.config.js'
import {createCurriculumPaperCatalog} from '../server/curriculumPaperCatalog.js'
import {createIeltsPaperDownloads} from '../server/ieltsPaperDownloads.js'
import {createPdfDownloadPolicy,sendPdfAccessError} from '../server/pdfDownloadPolicy.js'

// One HTTP server, one database and actual file handlers across all families.
// Fixtures are original synthetic bytes, not student files or live accounts.
const root=await fs.mkdtemp(path.join(os.tmpdir(),'all-paper-quota-')),db=new DatabaseSync(':memory:')
const env={CIE_LIBRARY_ROOT:root,STEM_PDF_ACCESS_LOG_PATH:path.join(root,'access.jsonl'),STEM_PDF_DOWNLOAD_QUOTA_ENABLED:'1',STEM_PDF_DOWNLOAD_QUOTA_READY:'1',STEM_INTERNAL_AUTH_KEY:'synthetic-allowance-only'}
const documents=[],routes={},catalogPapers=[],ieltsFiles=[]
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
for(const [family,subject] of [['alevel','9702'],['igcse','0625'],['competition','bpho'],['ap','ap'],['ib','ib'],['ielts','ielts']]){
 await fs.mkdir(path.join(root,subject),{recursive:true});routes[family]=[]
 const pair={}
 for(const kind of ['qp','ms']){
  const bytes=Buffer.from('%PDF-1.4\nOriginal synthetic '+family+' '+kind+'\n%%EOF\n'),checksum=sha(bytes)
  if(['alevel','igcse','competition'].includes(family)){
   const file='synthetic_2026_'+kind+'.pdf';await fs.writeFile(path.join(root,subject,file),bytes)
   documents.push({id:family+'-'+kind,subject,file,kind,bytes:bytes.length,sha256:checksum});routes[family].push('/local-pdf/'+subject+'/'+file)
  }else if(family==='ielts'){
   const suffix=kind==='qp'?'qp':'ak',id='ielts-cam4-l-test1-'+suffix,file=checksum+'.pdf';await fs.writeFile(path.join(root,subject,file),bytes)
   ieltsFiles.push({id,sourceId:'cam4-l-test1',book:4,test:1,module:'listening',task:0,kind:suffix,title:'Synthetic IELTS fixture',fileName:'Cambridge_IELTS_4_Test_1_Listening_'+suffix+'.pdf',file,sha256:checksum,bytes:bytes.length,pages:1,answerStatus:'available'})
   routes[family].push('/api/stem/ielts-papers/files/'+id)
  }else{
   const id='file-'+family+'-'+kind,file=family+'/'+kind+'.pdf';await fs.writeFile(path.join(root,file),bytes)
   pair[kind]={id,name:kind+'.pdf',bytes:bytes.length,pages:1,sha256:checksum,relativePath:file,rightsStatus:'licensed',integrityStatus:'verified'};routes[family].push('/api/stem/curriculum-papers/files/'+id)
  }
 }
 if(pair.qp)catalogPapers.push({id:'synthetic-'+family,board:family,course:family+'-physics',courseLabel:family+' Physics',subject:'Physics',level:family==='ib'?'HL':'AP',year:2026,session:'May',paper:'1',variant:'',title:'Original synthetic paper',section:'Questions',fullExam:false,practiceReady:false,pairStatus:'verified',questionPaper:pair.qp,markScheme:pair.ms})
}
await fs.writeFile(path.join(root,'catalog.json'),JSON.stringify({schemaVersion:'curriculum-paper-source-v1',generatedAt:new Date().toISOString(),courses:['ap','ib'].map(board=>({id:board+'-physics',board,label:board+' Physics',subject:'Physics'})),papers:catalogPapers}))
await fs.writeFile(path.join(root,'ielts','catalog.json'),JSON.stringify({schemaVersion:'ielts-paper-downloads-v1',version:'a'.repeat(24),files:ieltsFiles}))
const policy=createPdfDownloadPolicy({env,databaseProvider:()=>db,authenticateRequest:req=>/^Bearer synthetic-\d+$/.test(req.headers.authorization||'')?{id:'ielts:'+req.headers.authorization.split('-').at(-1)}:null,fetchImpl:async(_url,options)=>{
 const {userId}=JSON.parse(options.body),member=userId==='ielts:9999'
 return new Response(JSON.stringify({protocol:'stemist-membership-v1',authority:'ieltsist-membership',userId,entitlement:{active:member,expiresAt:member?new Date(Date.now()+3600000).toISOString():null},checkedAt:new Date().toISOString(),maxAgeSeconds:30}))
}})
const authorizeFile=options=>policy.authorize(options),catalog=createCurriculumPaperCatalog({manifestPath:path.join(root,'catalog.json'),assetRoot:root,env,authorizeFile}),ielts=createIeltsPaperDownloads({root:path.join(root,'ielts'),authorizeFile})
const server=http.createServer(async(req,res)=>{try{if(await ielts.handle(req,res,new URL(req.url,'http://local'))||await catalog.handle(req,res))return;await sendLocalPdf(req,res,()=>{res.statusCode=404;res.end()},env,()=>documents,{authorizeFile})}catch(e){if(!sendPdfAccessError(res,e)){res.statusCode=500;res.end('Synthetic test failure')}}})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port
async function get(route,owner,range){const r=await fetch(origin+route,{headers:{...(owner?{Authorization:'Bearer synthetic-'+owner}:{}),...(range?{Range:range}:{})}});await r.arrayBuffer();return r}
try{
 let owner=100
 for(const [family,pair] of Object.entries(routes)){
  assert.equal((await get(pair[0])).status,401,family+' anonymous must not bypass quota')
  const first=await get(pair[0],owner,'bytes=0-4');assert.equal(first.status,206,family+' QP');assert.equal(first.headers.get('x-pdf-quota-used'),'1')
  const second=await get(pair[1],owner);assert.equal(second.status,200,family+' answer');assert.equal(second.headers.get('x-pdf-quota-used'),'2')
  const another=routes[family==='alevel'?'ielts':'alevel'][0];assert.equal((await get(another,owner)).status,429,family+' shares its two files with all other families')
  const resumed=await get(pair[0],owner,'bytes=5-');assert.equal(resumed.status,206);assert.equal(resumed.headers.get('x-pdf-quota-used'),'2');assert.equal(resumed.headers.get('x-pdf-quota-reused'),'true')
  owner++
 }
 for(const [a,b,c] of [['ielts','alevel','ap'],['ap','ib','ielts'],['igcse','competition','alevel']]){
  assert.equal((await get(routes[a][0],owner)).status,200);assert.equal((await get(routes[b][1],owner)).status,200)
  assert.equal((await get(routes[c][0],owner)).status,429,'Mixed QP and MS must not get per-board budgets');owner++
 }
 for(const pair of Object.values(routes))for(const route of pair){const r=await get(route,9999);assert.equal(r.status,200);assert.equal(r.headers.get('x-pdf-quota-unlimited'),'true')}
 console.log('PASS all six families: QP + answer = 2, mixed-family third rejected, resume counted once, member unlimited, anonymous denied.')
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('all-paper-quota-'))throw Error('Unsafe fixture cleanup');await fs.rm(root,{recursive:true,force:true})}
