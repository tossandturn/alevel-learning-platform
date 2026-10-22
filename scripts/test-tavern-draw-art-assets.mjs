import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {createRequire} from 'node:module'
import {compileDrawArtCatalog,DEFAULT_DRAW_ART_ROOT,DRAW_ART_PREFIX} from '../server/tavernDrawArt.js'
import {createAiApi} from '../server/aiApi.js'
import http from 'node:http'
const require=createRequire(import.meta.url),sharp=require(path.resolve(process.argv[2]||'node_modules/sharp'))
const raw=JSON.parse(fs.readFileSync(path.join(DEFAULT_DRAW_ART_ROOT,'catalog.json'),'utf8')),catalog=compileDrawArtCatalog(raw),source=JSON.parse(fs.readFileSync(path.join(DEFAULT_DRAW_ART_ROOT,'provenance.json'),'utf8'))
const order='天 泽 火 雷 风 水 山 地'.split(' '),bits={天:'111',泽:'110',火:'101',雷:'100',风:'011',水:'010',山:'001',地:'000'}
const matrix=[[1,10,13,25,44,6,33,12],[43,58,49,17,28,47,31,45],[14,38,30,21,50,64,56,35],[34,54,55,51,32,40,62,16],[9,61,37,42,57,59,53,20],[5,60,63,3,48,29,39,8],[26,41,22,27,18,4,52,23],[11,19,36,24,46,7,15,2]],expected=new Map()
matrix.forEach((row,y)=>row.forEach((number,x)=>expected.set('hexagram-'+String(number).padStart(2,'0'),bits[order[x]]+bits[order[y]])))
let bytes=0
for(const item of raw.items){
 const file=path.join(DEFAULT_DRAW_ART_ROOT,item.file),content=fs.readFileSync(file),digest=crypto.createHash('sha256').update(content).digest('hex'),meta=await sharp(content).metadata()
 assert.equal(digest,item.sha256);assert.equal(content.length,item.bytes);assert.equal(meta.width,item.width);assert.equal(meta.height,item.height);bytes+=content.length
 const proof=source.items.find(x=>x.id===item.id);assert.ok(proof)
 if(item.kind==='tarot'){assert.equal(proof.bytesUnchanged,true);assert.equal(proof.sha256,digest);assert.match(proof.originalSha1,/^[a-f0-9]{40}$/);assert.equal(proof.license,'Public domain');assert.match(proof.descriptionUrl,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)}
 else{assert.equal(proof.bottomToTop,expected.get(item.id));const pixels=await sharp(content).ensureAlpha().raw().toBuffer();for(let row=0;row<6;row++){const red=pixels[((418+49*row+11)*720+360)*4];assert.equal(red<120,expected.get(item.id)[5-row]==='1',item.id+' visible line '+row)}}
}
assert.equal(source.items.length,142);assert.match(fs.readFileSync(path.join(DEFAULT_DRAW_ART_ROOT,'RWS-SOURCES.txt'),'utf8'),/Public Domain/)
const api=createAiApi({env:{AI_PROVIDER:'none'},libraryRoot:DEFAULT_DRAW_ART_ROOT,allowedSubjects:new Set()})
const server=http.createServer((req,res)=>api(req,res,()=>{res.writeHead(404);res.end()}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
try{const index=await fetch(base+DRAW_ART_PREFIX+'catalog.json');assert.equal(index.status,200);assert.equal((await index.json()).items.length,142);const image=await fetch(base+catalog.public.items[0].src);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png')}
finally{api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
console.log(JSON.stringify({status:'PASS',assets:142,tarotUnchanged:78,hexagramPixelsChecked:64,totalBytes:bytes,apiIntegration:'PASS'}))
