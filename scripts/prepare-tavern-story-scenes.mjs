import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { compileTavernMediaCatalog } from '../server/tavernMedia.js'
const require = createRequire(import.meta.url)
const sharp = require(process.env.STEM_ART_SHARP || 'sharp')
const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const option = key => args[args.indexOf(key) + 1]
if (!args.includes('--source-root') || !args.includes('--archive-root')) throw Error('Pass --source-root and --archive-root for generated artwork.')
const sourceRoot = path.resolve(option('--source-root')), archiveRoot = path.resolve(option('--archive-root'))
const out = path.join(root, 'public', 'tavern-media', 'v1')
const scriptRooms=args.includes('--script-rooms')
const scriptActs=args.includes('--script-acts')
const manifest = JSON.parse(fs.readFileSync(path.join(root,scriptActs?'docs/art/script-room-act-prompts.json':scriptRooms?'docs/art/script-room-prompts.json':'docs/art/tavern-scene-prompts.json'),'utf8'))
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(archiveRoot,{recursive:true})
const items=[]
for(const item of manifest.items){
 if(path.basename(item.sourceFile)!==item.sourceFile || !/^(story|scriptroom)-[a-z-]+$/.test(item.id))throw Error('Invalid scene source')
 const original=fs.readFileSync(path.join(sourceRoot,item.sourceFile)), archived=path.join(archiveRoot,item.id+'.png')
 if(fs.existsSync(archived)){if(hash(fs.readFileSync(archived))!==hash(original))throw Error('Existing original differs: '+item.id)}
 else fs.writeFileSync(archived,original,{flag:'wx'})
 const {data,info}=await sharp(original).resize({width:1280,withoutEnlargement:true}).webp({quality:83}).toBuffer({resolveWithObject:true})
 if(data.length>2*1024*1024)throw Error('Scene exceeds delivery bound')
 const sha256=hash(data),file=item.id+'-'+sha256.slice(0,16)+'.webp',target=path.join(out,file)
 if(!fs.existsSync(target))fs.writeFileSync(target,data,{flag:'wx'})
 items.push({id:item.id,kind:'image',file,sha256,width:info.width,height:info.height,alt:item.alt,caption:item.caption,tags:[item.persona,item.id.split('-').at(-1),'原创剧本场景'],provenance:{method:'image_gen',sourceSha256:hash(original)}})
}
const catalog={schemaVersion:'tavern-media.v1',revision:manifest.version,items}
compileTavernMediaCatalog(catalog)
fs.writeFileSync(path.join(out,scriptActs?'script-act-scenes.json':scriptRooms?'script-scenes.json':'story-scenes.json'),JSON.stringify(catalog,null,2)+'\n','utf8')
console.log(JSON.stringify({status:'PASS',scenes:items.length,totalBytes:items.reduce((n,item)=>n+fs.statSync(path.join(out,item.file)).size,0),out,archiveRoot}))
