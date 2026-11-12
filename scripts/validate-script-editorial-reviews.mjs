import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {normalizeEditorialReview} from './helpers/script-editorial-review.mjs'
const directory=process.argv[2]
if(!directory||!path.isAbsolute(directory))throw Error('Provide an absolute editorial packet directory')
const index=JSON.parse(fs.readFileSync(path.join(directory,'index.json'),'utf8')),output=path.join(directory,'validated');fs.mkdirSync(output,{recursive:true})
const summary=[]
for(const book of index.books){
 const file=path.join(directory,'reviews',book.id+'.review.json')
 if(!fs.existsSync(file)){summary.push({id:book.id,status:'NOT_REVIEWED'});continue}
 const raw=fs.readFileSync(file,'utf8'),packet=JSON.parse(fs.readFileSync(path.join(directory,book.file),'utf8')).packet
 const validation=normalizeEditorialReview(JSON.parse(raw),packet)
 const result={id:book.id,rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),...validation}
 fs.writeFileSync(path.join(output,book.id+'.validated.json'),JSON.stringify(result,null,2)+'\n','utf8')
 summary.push({id:book.id,status:validation.validationErrors.length?'INVALID_REVIEW':validation.review.verdict==='pass'?'MODEL_PASS_NEEDS_IMPLEMENTER_ACCEPTANCE':'REVISE',normalizations:validation.normalizations.length,errors:validation.validationErrors})
}
fs.writeFileSync(path.join(output,'index.json'),JSON.stringify(summary,null,2)+'\n','utf8');console.log(JSON.stringify(summary,null,2))
