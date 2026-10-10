import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {buildUniversityDirectory} from '../server/universityDirectory.js'

const args=process.argv.slice(2)
function option(name){const index=args.indexOf(name);if(index<0||!args[index+1])throw Error('Required option: '+name);return args[index+1]}
const sources=[option('--qs'),option('--us')],updatedAt=option('--verified-at'),output=path.resolve(option('--out'))
const rankings=sources.map(file=>JSON.parse(fs.readFileSync(file,'utf8')))
const directory=buildUniversityDirectory({rankings,updatedAt})
const bytes=Buffer.from(JSON.stringify(directory,null,2)+'\n','utf8')
fs.mkdirSync(path.dirname(output),{recursive:true})
if(fs.existsSync(output))throw Error('Output already exists; preserve the previous reviewed snapshot')
fs.writeFileSync(output,bytes,{flag:'wx'})
console.log(JSON.stringify({output,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,updatedAt,rankings:directory.rankings.map(({id,editionYear,items})=>({id,editionYear,count:items.length,rankLimit:100}))}))
