import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {COACH_SOURCE_PAGE_SCHEMA,sourcePageRows} from '../server/coachSourcePages.js'
import {spatialPdfSourceText} from './lib/coach-pdf-source-text.mjs'

const args=Object.fromEntries(process.argv.slice(2).map(a=>{const at=a.indexOf('=');return[at<0?a:a.slice(0,at),at<0?true:a.slice(at+1)]}))
const library=path.resolve(String(args['--library']||'')),output=path.resolve(String(args['--output']||'')),catalog=JSON.parse(fs.readFileSync(String(args['--catalog']||'public/data/papers.json'),'utf8'))
if(!args['--library']||!args['--output'])throw Error('--library and --output are required')
const subjects=String(args['--subjects']||'0580,0606,0625,9231,9702,9709').split(',')
const year=Number(args['--through-year']||2026),from=Number(args['--from-year']||2017)
const files=catalog.items.filter(d=>d.kind==='qp'&&d.year>=from&&d.year<=year&&subjects.includes(d.subject)&&/^\d{4}_[msw]\d{2}_qp_\d{2}\.pdf$/.test(d.file))
const documents=[],skips=[],started=Date.now();let scanned=0
for(const item of files){
 const file=path.join(library,item.subject,item.file)
 let pdf=null
 try{
  const stat=fs.statSync(file);if(stat.size>30*1024*1024)throw Error('oversize')
  const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex');if(hash!==item.sha256)throw Error('source-checksum-mismatch')
  pdf=await getDocument({data:new Uint8Array(bytes),verbosity:0,stopAtErrors:true}).promise
  if(pdf.numPages>100)throw Error('page-limit')
  const pages=[]
  for(let pageNumber=2;pageNumber<=pdf.numPages;pageNumber++){
   const page=await pdf.getPage(pageNumber),content=await page.getTextContent()
   const text=spatialPdfSourceText(content.items,page.view[3])
   // Obfuscated fonts and scanned pages need OCR; never index gibberish.
   const words=text.match(/[A-Za-z]{3,}/g)||[],common=words.filter(w=>/^(?:the|and|which|that|find|with|shown|calculate|determine|point|curve|line|diagram|figure|when|from|distance|function|mass|velocity|using|answer|show)$/i.test(w))
   if(text.length<80||text.length>12000||words.length<12||common.length<3||((text.match(/[^\x20-\x7e\r\n\tα-ωΑ-Ω−–—×÷²³⁻¹°πθµ]/g)||[]).length/text.length)>.12)continue
   pages.push({page:pageNumber,text})
  }
  if(pages.length)documents.push({paperFile:item.file,paperId:item.id,subjectCode:item.subject,year:item.year,documentSha256:hash,pages})
  else skips.push({file:item.file,reason:'no-usable-text-layer'})
 }catch(e){skips.push({file:item.file,reason:e.code==='ENOENT'?'missing-local-pdf':String(e.message||'parse-error').slice(0,100)})}
 finally{await pdf?.destroy()}
 if(++scanned%100===0)console.log(JSON.stringify({scanned,total:files.length,indexed:documents.length,skipped:skips.length,elapsedSeconds:Math.round((Date.now()-started)/1000)}))
}
const index={schemaVersion:COACH_SOURCE_PAGE_SCHEMA,source:'checksum-matched-catalog-pdf-text',fromYear:from,throughYear:year,documents}
const rows=sourcePageRows(index);fs.mkdirSync(path.dirname(output),{recursive:true});const compressed=zlib.gzipSync(JSON.stringify(index),{level:9});fs.writeFileSync(output,compressed)
const report={status:'PASS',scanned:files.length,papers:documents.length,pages:rows.length,bytes:compressed.length,sha256:crypto.createHash('sha256').update(compressed).digest('hex'),elapsedSeconds:Math.round((Date.now()-started)/1000),bySubject:Object.fromEntries(subjects.map(subject=>[subject,{papers:documents.filter(d=>d.subjectCode===subject).length,pages:documents.filter(d=>d.subjectCode===subject).reduce((n,d)=>n+d.pages.length,0)}])),skips}
fs.writeFileSync(output+'.report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,skips:report.skips.length}))
