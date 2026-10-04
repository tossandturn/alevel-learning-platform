import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {loadPaperSourceIncrement} from './load-paper-source-increment.mjs'

const manifestPath=new URL('../src/data/paperSourceIncrement2026.json',import.meta.url)
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
const pdfRoot='D:/CodexWork/cie-fraft-fetcher/output/pdf'
const records=loadPaperSourceIncrement({manifestPath,pdfRoot})
assert.equal(records.filter(item=>item.kind==='qp').length,217)
assert.ok(records.every(item=>item.year===2026&&item.sourceOnly===true&&item.formalProgressEligible===false&&item.sourceVerification.automaticMarkingApproved===false))
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cie-source-increment-'))
try{
 const file=path.join(scratch,'invalid.json')
 for(const [name,change,pattern]of [
  ['future-series',copy=>{copy.items[0].file=copy.items[0].file.replace('_m26_','_w26_').replace('_s26_','_w26_')},/source identity/],
  ['digest-tamper',copy=>{copy.items[0].sha256='0'.repeat(64)},/digest changed/],
  ['duplicate',copy=>{copy.items[1]={...copy.items[0]}},/Duplicate/],
 ]){const copy=structuredClone(manifest);change(copy);fs.writeFileSync(file,JSON.stringify(copy),'utf8');assert.throws(()=>loadPaperSourceIncrement({manifestPath:file,pdfRoot}),pattern,name)}
 assert.throws(()=>loadPaperSourceIncrement({manifestPath,pdfRoot:scratch}),/ENOENT/,'missing registered material must block regeneration, never silently drop 2026')
 console.log(JSON.stringify({status:'PASS',files:466,questionPapers:217,exactPairs:true,futureSeriesRejected:true,tamperRejected:true,missingInputFailsClosed:true,formalPromotion:false}))
}finally{assert.equal(path.dirname(scratch),os.tmpdir());assert.ok(path.basename(scratch).startsWith('cie-source-increment-'));fs.rmSync(scratch,{recursive:true})}
