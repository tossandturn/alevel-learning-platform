import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {getExamPaperProfile} from '../src/data/examStructure.js'

const subjects=new Set(['0580','0606','0610','0625','9231','9700','9701','9702','9708','9709'])
const sha=file=>{const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024);try{let length;while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length))}finally{fs.closeSync(fd)}return hash.digest('hex')}

export function loadPaperSourceIncrement({manifestPath,pdfRoot}){
 const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'))
 assert.equal(manifest.schemaVersion,'cie-verified-source-increment.v1')
 assert.equal(manifest.year,2026);assert.equal(manifest.sourceOnly,true);assert.equal(manifest.formalProgressEligible,false)
 assert.equal(manifest.items.length,466)
 assert.match(manifest.evidence.preparationSha256,/^[a-f0-9]{64}$/)
 const seen=new Set(),root=fs.realpathSync(pdfRoot),items=[]
 for(const item of manifest.items){
  const match=/^(\d{4})_([ms])26_(qp|ms|ci)_(\d{2})\.pdf$/.exec(item.file||'')
  assert.ok(match&&subjects.has(match[1])&&item.subject===match[1]&&item.kind===match[3],`Invalid reviewed 2026 source identity: ${item.file}`)
  assert.ok(!seen.has(item.file),`Duplicate increment filename: ${item.file}`);seen.add(item.file)
  assert.match(item.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(item.bytes)&&item.bytes>100&&item.bytes<=32*1024*1024)
  assert.match(item.sourceUrl,/^https:\/\/cie\.fraft\.cn\/obj\/Common\/Fetch\/redir\/[A-Za-z0-9_.-]+\.pdf$/)
  const file=fs.realpathSync(path.join(root,item.subject,item.file)),relative=path.relative(root,file)
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))
  assert.equal(fs.statSync(file).size,item.bytes,`2026 source bytes changed: ${item.file}`)
  assert.equal(sha(file),item.sha256,`2026 source digest changed: ${item.file}`)
  const variant=String(Number(match[4])),sessionCode=match[2]+'26',paired=['qp','ms'].includes(item.kind)
  items.push({id:`cie-${item.subject}-${item.file.slice(0,-4)}`,subject:item.subject,year:2026,season:match[2]==='m'?'Mar':'Jun',kind:item.kind,file:item.file,
   sessionCode,documentCode:item.kind,variant,pairKey:paired?`${item.subject}-${sessionCode}-${variant}`:null,
   examProfile:getExamPaperProfile(item.subject,variant,2026),bytes:item.bytes,sha256:item.sha256,localUrl:`/local-pdf/${item.subject}/${item.file}`,sourceUrl:item.sourceUrl,
   provenance:'Validated 2026 increment from cie.fraft.cn; PDF-only source library',copyrightStatus:'Official exam material; personal study library',sourceOnly:true,formalProgressEligible:false,
   sourceVerification:{schemaVersion:'verified-source-pdf.v1',preparationSha256:manifest.evidence.preparationSha256,parserValidated:true,automaticMarkingApproved:false}})
 }
 const pairs=new Map()
 for(const item of items.filter(item=>item.pairKey)){if(!pairs.has(item.pairKey))pairs.set(item.pairKey,new Set());pairs.get(item.pairKey).add(item.kind)}
 assert.equal(pairs.size,217);assert.ok([...pairs.values()].every(kinds=>kinds.has('qp')&&kinds.has('ms')))
 return items
}
