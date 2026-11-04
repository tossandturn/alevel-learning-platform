// Run only following an explicit human confirmation for this already imported batch.
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
const args=process.argv.slice(2),date=args[args.indexOf('--confirmed-on')+1]
if(!args.includes('--confirmed-on')||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!args.includes('--write'))throw Error('Explicit --confirmed-on YYYY-MM-DD and --write are required')
const file=path.resolve(import.meta.dirname,'../server/catalogs/alevel-extra-papers.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8'))
if(catalog.schemaVersion!=='curriculum-paper-source-v1'||catalog.papers.length!==873||catalog.papers.some(p=>!['edexcel','oxfordaqa'].includes(p.board)||p.practiceReady!==false))throw Error('Unexpected source batch; review before authorizing')
const files=catalog.papers.flatMap(p=>[p.questionPaper,p.markScheme].filter(Boolean))
if(files.length!==1746||files.some(f=>f.integrityStatus!=='verified'||!/[a-f0-9]{64}/.test(f.sha256)))throw Error('Unverified or unexpected file set')
const fingerprint=crypto.createHash('sha256').update(JSON.stringify(files.map(f=>[f.id,f.sha256]).sort((a,b)=>a[0].localeCompare(b[0],'en')))).digest('hex')
catalog.authorization={basis:'owner-confirmed-redistribution',confirmedOn:date,sourceBatch:'alevelclouds-20261104',fileCount:files.length,fileSetSha256:fingerprint,scope:'This frozen imported Edexcel and OxfordAQA question/answer PDF file set only. Future imports require separate verification.'}
for(const f of files)f.rightsStatus='licensed'
fs.writeFileSync(file,JSON.stringify(catalog,null,2)+'\n')
console.log(JSON.stringify({status:'AUTHORIZED',fileCount:files.length,fileSetSha256:fingerprint,confirmedOn:date,practiceReady:false}))
