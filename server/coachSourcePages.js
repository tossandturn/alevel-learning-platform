import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

export const COACH_SOURCE_PAGE_SCHEMA='coach-source-pages.v1'
const FILE=/^(\d{4})_([msw])(\d{2})_qp_(\d{2})\.pdf$/
const SHA=/^[a-f0-9]{64}$/
export function sourcePageRows(index){
 if(index?.schemaVersion!==COACH_SOURCE_PAGE_SCHEMA||!Array.isArray(index.documents)||index.documents.length>12000)throw Error('Invalid source page index')
 let total=0;const rows=[]
 for(const doc of index.documents){
  const m=String(doc?.paperFile||'').match(FILE)
  if(!m||!SHA.test(doc.documentSha256)||doc.subjectCode!==m[1]||doc.year!==2000+Number(m[3])||doc.paperId!==`cie-${m[1]}-${doc.paperFile.slice(0,-4)}`||!Array.isArray(doc.pages)||doc.pages.length>100)throw Error('Invalid source document')
  const pages=new Set()
  for(const page of doc.pages){
   if(!Number.isInteger(page.page)||page.page<1||page.page>100||pages.has(page.page)||typeof page.text!=='string'||page.text.length<60||page.text.length>12000||/[\u0000-\u0008]/.test(page.text))throw Error('Invalid source page')
   total+=page.text.length;if(total>64*1024*1024||rows.length>=60000)throw Error('Source index capacity exceeded')
   pages.add(page.page)
   rows.push({key:doc.paperFile+':page'+page.page+':'+doc.documentSha256,source:{...doc,pages:undefined,page:page.page,status:'paper-matched',sourceKind:'past-paper',questionNumber:null},texts:[page.text]})
  }
 }
 return rows
}
// This index contains original source text, not a released question/answer bank.
// It stays outside the public web root and never makes practice content ready.
export function createCoachSourcePageProvider({libraryRoot,indexPath=null}={}){
 indexPath=indexPath||path.resolve(String(libraryRoot||'.'),'..','..','coach-source-index/current.json.gz')
 let version='',cached=[],failed=false;const hashes=new Map()
 function rows(){
  try{
   const stat=fs.statSync(indexPath,{throwIfNoEntry:false});if(!stat?.isFile()||stat.size>24*1024*1024)return[]
   const next=stat.size+':'+stat.mtimeMs;if(next===version)return cached
   const parsed=JSON.parse(zlib.gunzipSync(fs.readFileSync(indexPath),{maxOutputLength:96*1024*1024}).toString('utf8'))
   cached=sourcePageRows(parsed);version=next;failed=false;return cached
  }catch{failed=true;cached=[];return[]}
 }
 function verify(source){
  if(!libraryRoot||!FILE.test(source?.paperFile||''))return false
  try{
   const base=fs.realpathSync(libraryRoot),file=path.join(base,source.subjectCode,source.paperFile),real=fs.realpathSync(file)
   if(!real.startsWith(base+path.sep))return false
   const stat=fs.statSync(real);if(!stat.isFile()||stat.size>30*1024*1024)return false
   const signature=stat.size+':'+stat.mtimeMs;let record=hashes.get(real)
   if(!record||record.signature!==signature){record={signature,hash:crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex')};hashes.set(real,record);if(hashes.size>64)hashes.delete(hashes.keys().next().value)}
   return record.hash===source.documentSha256
  }catch{return false}
 }
 return{rows,verify,status:()=>failed?'unavailable':cached.length?'ready':'empty'}
}
