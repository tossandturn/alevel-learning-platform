import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {TAROT_DECK,HEXAGRAM_DECK} from './tavernDivination.js'

export const DRAW_ART_PREFIX='/api/ai/tavern/draw-art/v1/'
export const DRAW_ART_SCHEMA='tavern-draw-art.v1'
export const DEFAULT_DRAW_ART_ROOT=fileURLToPath(new URL('../public/tavern-draw-art/v1/',import.meta.url))
const identity=new Map([...TAROT_DECK.map(c=>[c.id,{kind:'tarot',deckVersion:'rws-text-78-v1'}]),...HEXAGRAM_DECK.map(c=>[c.id,{kind:'hexagram',deckVersion:'zhouyi-64-v1'}])])
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const clean=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n&&!/[\u0000-\u001f<>]/.test(v)?v.trim():null
const safeUrl=v=>typeof v==='string'&&/^https:\/\/[a-z0-9.-]+\/[a-zA-Z0-9_./%#-]*$/.test(v)&&v.length<300
const fail=()=>{throw Error('Invalid draw artwork catalog')}
export function compileDrawArtCatalog(raw){
 if(raw?.schemaVersion!==DRAW_ART_SCHEMA||!clean(raw.revision,80)||!Array.isArray(raw.items)||raw.items.length!==142||!Array.isArray(raw.credits)||raw.credits.length!==2)fail()
 const credits=raw.credits.map(c=>{
  if(!['tarot','hexagram'].includes(c?.kind)||!clean(c.title,120)||!clean(c.author,120)||!clean(c.license,80)||c.sourceUrl&&!safeUrl(c.sourceUrl)||c.licenseUrl&&!safeUrl(c.licenseUrl))fail()
  if(c.kind==='tarot'&&(!c.sourceUrl||!c.licenseUrl))fail()
  return{kind:c.kind,title:c.title,author:c.author,license:c.license,sourceUrl:c.sourceUrl||'',licenseUrl:c.licenseUrl||''}
 })
 if(new Set(credits.map(c=>c.kind)).size!==2)fail()
 const files=new Map(),ids=new Set(),digests=new Set(),items=[]
 for(const row of raw.items){
  const expected=identity.get(row?.id)
  if(!expected||ids.has(row.id)||row.kind!==expected.kind||row.deckVersion!==expected.deckVersion||!/^[a-f0-9]{64}$/.test(row.sha256||'')||digests.has(row.sha256))fail()
  const extension=String(row.file||'').split('.').at(-1)
  if(!['jpg','png'].includes(extension)||row.file!==row.id+'-'+row.sha256.slice(0,16)+'.'+extension||!Number.isInteger(row.bytes)||row.bytes<=0||row.bytes>614400||!Number.isInteger(row.width)||row.width<1||row.width>2048||!Number.isInteger(row.height)||row.height<1||row.height>3072||!clean(row.alt,160))fail()
  const item={id:row.id,...expected,src:DRAW_ART_PREFIX+row.file,width:row.width,height:row.height,bytes:row.bytes,sha256:row.sha256,alt:row.alt}
  items.push(item);files.set(row.file,item);ids.add(row.id);digests.add(row.sha256)
 }
 const value={schemaVersion:DRAW_ART_SCHEMA,revision:raw.revision,credits,items},body=Buffer.from(JSON.stringify(value))
 return{public:value,files,body,etag:'"'+sha(body)+'"'}
}
export function createDrawArtHandler({root=DEFAULT_DRAW_ART_ROOT,now=Date.now}={}){
 let cached=null,stamp='',nextCheck=0
 const catalog=()=>{
  if(now()<nextCheck)return cached
  nextCheck=now()+5000
  try{const target=path.join(root,'catalog.json'),stat=fs.lstatSync(target),key=stat.mtimeMs+':'+stat.size;if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024)throw Error('Invalid index');if(key!==stamp){const result=compileDrawArtCatalog(JSON.parse(fs.readFileSync(target,'utf8')));cached=result;stamp=key}}catch{/* Keep last complete known-good manifest on interrupted updates. */}
  return cached
 }
 return(request,response,url)=>{
  if(!url.pathname.startsWith(DRAW_ART_PREFIX))return false
  const reject=(status=404)=>{response.writeHead(status,{'Cache-Control':'no-store'});response.end();return true}
  if(!['GET','HEAD'].includes(request.method))return reject(405)
  const data=catalog();if(!data)return reject(503)
  const name=url.pathname.slice(DRAW_ART_PREFIX.length)
  let body,type,tag,cache
  if(name==='catalog.json'){body=data.body;type='application/json; charset=utf-8';tag=data.etag;cache='public, max-age=300, must-revalidate'}
  else{
   const item=data.files.get(name);if(!item)return reject()
   try{
    const file=path.join(root,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes)return reject()
    body=fs.readFileSync(file);if(sha(body)!==item.sha256)return reject()
    const png=name.endsWith('.png');if(png?!body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):body[0]!==255||body[1]!==216||body[2]!==255)return reject()
    type=png?'image/png':'image/jpeg';tag='"'+item.sha256+'"';cache='public, max-age=31536000, immutable'
   }catch{return reject()}
  }
  const headers={'Content-Type':type,'Cache-Control':cache,'ETag':tag,'X-Content-Type-Options':'nosniff'}
  if(request.headers?.['if-none-match']===tag){response.writeHead(304,headers);response.end();return true}
  response.writeHead(200,{...headers,'Content-Length':body.length});response.end(request.method==='HEAD'?undefined:body);return true
 }
}
