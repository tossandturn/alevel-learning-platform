import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import {TAROT_DECK,HEXAGRAM_DECK} from '../server/tavernDivination.js'
const modulePath=new URL('../server/tavernDrawArt.js',import.meta.url)
assert.ok(fs.existsSync(modulePath),'canonical draw images need a dedicated validated asset service')
const {compileDrawArtCatalog,createDrawArtHandler,DRAW_ART_PREFIX}=await import(modulePath.href)
const hash=b=>crypto.createHash('sha256').update(b).digest('hex')
const raw={schemaVersion:'tavern-draw-art.v1',revision:'fixture-v1',credits:[{kind:'tarot',title:'Synthetic artwork',author:'Test',license:'CC BY 4.0',sourceUrl:'https://example.com/art',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},{kind:'hexagram',title:'Synthetic hexagrams',author:'Test',license:'Original',sourceUrl:'',licenseUrl:''}],items:[...TAROT_DECK.map(x=>({...x,kind:'tarot',deckVersion:'rws-text-78-v1'})),...HEXAGRAM_DECK.map(x=>({...x,kind:'hexagram',deckVersion:'zhouyi-64-v1'}))].map(x=>{const bytes=Buffer.concat([Buffer.from([255,216,255]),Buffer.from(x.id)]),sha256=hash(bytes);return{...x,file:x.id+'-'+sha256.slice(0,16)+'.jpg',width:720,height:1080,bytes:bytes.length,sha256,alt:x.name}})}
const catalog=compileDrawArtCatalog(raw)
assert.equal(catalog.public.items.length,142)
assert.deepEqual(new Set(catalog.public.items.map(x=>x.id)),new Set([...TAROT_DECK,...HEXAGRAM_DECK].map(x=>x.id)))
for(const mutate of [x=>x.items.pop(),x=>x.items.push(x.items[0]),x=>x.items[0].file='../private.jpg',x=>x.items[0].deckVersion='other',x=>x.items[0].kind='hexagram',x=>x.items[0].bytes=10000000,x=>x.items[0].width=0,x=>x.items[0].sha256='bad',x=>x.credits[0].sourceUrl='javascript:alert(1)']){const invalid=structuredClone(raw);mutate(invalid);assert.throws(()=>compileDrawArtCatalog(invalid))}
const scratch=path.resolve('.tmp-test');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'draw-art-'))
fs.writeFileSync(path.join(root,'catalog.json'),JSON.stringify(raw))
for(const x of raw.items)fs.writeFileSync(path.join(root,x.file),Buffer.concat([Buffer.from([255,216,255]),Buffer.from(x.id)]))
const handler=createDrawArtHandler({root}),server=http.createServer((req,res)=>{if(!handler(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
try{
 const index=await fetch(base+DRAW_ART_PREFIX+'catalog.json');assert.equal(index.status,200);assert.equal((await index.json()).items.length,142);assert.equal(index.headers.get('content-type'),'application/json; charset=utf-8')
 const url=base+catalog.public.items[0].src,asset=await fetch(url);assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),'image/jpeg');assert.match(asset.headers.get('cache-control'),/immutable/);assert.equal(hash(Buffer.from(await asset.arrayBuffer())),raw.items[0].sha256)
 const conditional=await fetch(url,{headers:{'If-None-Match':'"'+raw.items[0].sha256+'"'}});assert.equal(conditional.status,304)
 const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0)
 assert.equal((await fetch(base+DRAW_ART_PREFIX+'missing.jpg')).status,404)
 assert.equal((await fetch(base+DRAW_ART_PREFIX+'..%2fsecret')).status,404)
 fs.writeFileSync(path.join(root,raw.items[0].file),'tampered');assert.equal((await fetch(url)).status,404)
 const symlink=raw.items[1];fs.unlinkSync(path.join(root,symlink.file));try{fs.symlinkSync(path.join(root,raw.items[2].file),path.join(root,symlink.file));assert.equal((await fetch(base+DRAW_ART_PREFIX+symlink.file)).status,404)}catch(e){if(e.code!=='EPERM')throw e;console.log('Windows symlink creation unavailable; lstat rejection remains required')}
 console.log('Draw art API: 142 exact identities, fail-closed schema, immutable digest, conditional/head, traversal and tamper PASS')
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(scratch+path.sep)&&path.basename(root).startsWith('draw-art-'));fs.rmSync(root,{recursive:true,force:true})}
