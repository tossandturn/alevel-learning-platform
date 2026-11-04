import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {createCurriculumPaperCatalog} from '../server/curriculumPaperCatalog.js'
import {createPdfDownloadPolicy} from '../server/pdfDownloadPolicy.js'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'alevel-quota-')),db=new DatabaseSync(':memory:'),env={STEM_PDF_DOWNLOAD_QUOTA_ENABLED:'1',STEM_PDF_DOWNLOAD_QUOTA_READY:'1',STEM_INTERNAL_AUTH_KEY:'synthetic-quota-key'}
const policy=createPdfDownloadPolicy({env,databaseProvider:()=>db,authenticateRequest:req=>{if(req.headers.authorization!=='Bearer synthetic')throw Object.assign(Error('auth'),{statusCode:401});return{id:'ielts:71'}},fetchImpl:async()=>new Response(JSON.stringify({protocol:'stemist-membership-v1',authority:'ieltsist-membership',userId:'ielts:71',checkedAt:new Date().toISOString(),maxAgeSeconds:30,entitlement:{active:false}}),{status:200})})
const courses=[{id:'edexcel-ial-physics',board:'edexcel',label:'Edexcel IAL Physics',subject:'Physics'}]
const papers=[1,2,3].map(n=>{const bytes=Buffer.from('%PDF-1.4\nsynthetic '+n+'\n%%EOF'),name='paper-'+n+'.pdf';fs.writeFileSync(path.join(root,name),bytes);return{id:'edexcel-paper-'+n,board:'edexcel',course:courses[0].id,courseLabel:courses[0].label,subject:'Physics',level:'International AS',year:2025,session:'June',paper:'U'+n,variant:'',title:name,section:'',fullExam:true,practiceReady:false,pairStatus:'missing',questionPaper:{id:'edexcel-file-'+n,name,relativePath:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,pages:1,rightsStatus:'licensed',integrityStatus:'verified'},markScheme:null}})
const manifest=path.join(root,'manifest.json');fs.writeFileSync(manifest,JSON.stringify({schemaVersion:'curriculum-paper-source-v1',courses,papers}))
const api=createCurriculumPaperCatalog({manifestPath:manifest,alevelAssetRoot:root,env,authorizeFile:policy.authorize}),server=http.createServer((req,res)=>api.handle(req,res))
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/stem/curriculum-papers/files/edexcel-file-`
try{
 const unauth=await fetch(base+'1');assert.equal(unauth.status,401)
 const headers={Authorization:'Bearer synthetic'}
 assert.equal((await fetch(base+'1',{headers,method:'HEAD'})).status,200)
 const first=await fetch(base+'1',{headers});assert.equal(first.status,200);assert.equal(first.headers.get('x-pdf-quota-used'),'1')
 const same=await fetch(base+'1',{headers:{...headers,Range:'bytes=0-4'}});assert.equal(same.status,206);assert.equal(same.headers.get('x-pdf-quota-reused'),'true')
 const second=await fetch(base+'2',{headers});assert.equal(second.headers.get('x-pdf-quota-used'),'2')
 const third=await fetch(base+'3',{headers});assert.equal(third.status,429);assert.equal((await third.json()).code,'pdf_daily_limit_reached')
 console.log('PASS new-board downloads preserve login, shared two-file quota, HEAD and retry/range idempotency')
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true})}
