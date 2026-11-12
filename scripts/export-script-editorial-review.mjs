import fs from 'node:fs'
import path from 'node:path'
import {currentEditorialBooks,editorialPacket,editorialMessages} from './helpers/script-editorial-review.mjs'
const output=process.argv[2]
if(!output||!path.isAbsolute(output))throw Error('Provide an absolute output directory under the task workspace')
fs.mkdirSync(output,{recursive:true})
const index=[]
for(const game of currentEditorialBooks()){
 const packet=editorialPacket(game),filename=`${game.id}.json`
 fs.writeFileSync(path.join(output,filename),JSON.stringify({packet,messages:editorialMessages(packet)},null,2)+'\n','utf8')
 index.push({id:game.id,title:game.title,version:game.version,contentEdition:game.contentEdition||null,contentHash:packet.contentHash,file:filename})
}
fs.writeFileSync(path.join(output,'index.json'),JSON.stringify({schemaVersion:'script-editorial-index-v1',books:index},null,2)+'\n','utf8')
console.log(JSON.stringify({status:'EXPORTED_NOT_REVIEWED',count:index.length,output,books:index.map(({id,contentHash})=>({id,contentHash}))},null,2))
