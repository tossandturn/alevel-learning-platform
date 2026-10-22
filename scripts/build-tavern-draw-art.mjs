// Import public licensed Tarot bytes unchanged; render new vector hexagram diagrams locally.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {TAROT_DECK,HEXAGRAM_DECK} from '../server/tavernDivination.js'
import {compileDrawArtCatalog} from '../server/tavernDrawArt.js'
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1]
if(!args.includes('--sources')||!args.includes('--sharp'))throw Error('Supply --sources verified-commons-metadata.json and --sharp local-module-directory')
const require=createRequire(import.meta.url),sharp=require(path.resolve(option('--sharp'))),source=JSON.parse(fs.readFileSync(path.resolve(option('--sources')),'utf8'))
if(!Array.isArray(source.items)||source.items.length!==78||source.items.some(x=>x.license!=='Public domain'||!/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(x.descriptionUrl)||!/^[a-f0-9]{40}$/.test(x.originalSha1)))throw Error('Unverified primary-source rights or identity')
const root=path.resolve(import.meta.dirname,'../public/tavern-draw-art/v1');fs.mkdirSync(root,{recursive:true})
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),xml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const save=(name,bytes)=>{const target=path.join(root,name);if(fs.existsSync(target)){if(sha(fs.readFileSync(target))!==sha(bytes))throw Error('Existing immutable asset differs: '+name);return}fs.writeFileSync(target,bytes,{flag:'wx'})}
async function retrieve(file){
 const address=new URL(file.url);if(address.hostname!=='thumb.wikimedia.org'||!address.pathname.startsWith('/wikipedia/commons/'))throw Error('Unexpected image source');address.search='';const url=address.href
 let error
 for(let attempt=0;attempt<2;attempt++)try{
  let bytes
  if(args.includes('--proxy')){const proxy=option('--proxy');if(proxy!=='http://127.0.0.1:7897')throw Error('Only the existing local QA proxy is supported');bytes=await new Promise((resolve,reject)=>execFile('curl.exe',['--fail','--silent','--show-error','--connect-timeout','10','--max-time','30','--proxy',proxy,'-A','STEMist-Art-Provenance/1.0',url],{encoding:'buffer',windowsHide:true,maxBuffer:1024*1024},(e,out,err)=>e?reject(Error('Public source download failed: '+e.code+' '+String(err).slice(0,160))):resolve(out)))}
  else{const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Public asset HTTP '+r.status);bytes=Buffer.from(await r.arrayBuffer())}
  if(bytes.length>614400)throw Error('Asset exceeds client image budget');return bytes
 }catch(e){error=e}
 throw error
}
const sourceFiles=source.items
if(sourceFiles.length!==78)throw Error('Expected exactly 78 licensed card images')
const items=[],provenance=[];let cursor=0,done=0
function sourceFor(card){
 const result=sourceFiles.find(x=>x.id===card.id)
 if(!result)throw Error('No pinned image for '+card.id);return result
}
const makeItem=(card,kind,bytes,meta)=>{const sha256=sha(bytes),extension=kind==='tarot'?'jpg':'png',file=card.id+'-'+sha256.slice(0,16)+'.'+extension;save(file,bytes);return{id:card.id,kind,deckVersion:kind==='tarot'?'rws-text-78-v1':'zhouyi-64-v1',file,width:meta.width,height:meta.height,bytes:bytes.length,sha256,alt:card.name}}
await Promise.all(Array.from({length:3},async()=>{while(cursor<TAROT_DECK.length){const card=TAROT_DECK[cursor++],file=sourceFor(card),bytes=await retrieve(file),meta=await sharp(bytes).metadata();if(meta.format!=='jpeg'||meta.width!==file.width||meta.height!==file.height)throw Error('Unexpected card image');items.push(makeItem(card,'tarot',bytes,meta));provenance.push({id:card.id,descriptionUrl:file.descriptionUrl,sourceTitle:file.resolvedTitle,sourcePageId:file.pageId,originalSha1:file.originalSha1,license:file.license,licenseUrl:file.licenseUrl,downloadUrl:file.url,sha256:sha(bytes),bytesUnchanged:true});if(++done%13===0)console.log('Primary-source Tarot images verified: '+done+'/78')}}))

// King Wen sequence: each pair is upper trigram followed by lower trigram.
// Trigram bits are bottom-to-top. Draw rows reverse the six-bit sequence.
const trigrams={天:{name:'乾',bits:'111'},地:{name:'坤',bits:'000'},水:{name:'坎',bits:'010'},雷:{name:'震',bits:'100'},山:{name:'艮',bits:'001'},风:{name:'巽',bits:'011'},泽:{name:'兑',bits:'110'},火:{name:'离',bits:'101'}}
const pairs='天天 地地 水雷 山水 水天 天水 地水 水地 风天 天泽 地天 天地 天火 火天 地山 雷地 泽雷 山风 地泽 风地 火雷 山火 山地 地雷 天雷 山天 山雷 泽风 水水 火火 泽山 雷风 天山 雷天 火地 地火 风火 火泽 水山 雷水 山泽 风雷 泽天 天风 泽地 地风 泽水 水风 泽火 火风 雷雷 山山 风山 雷泽 雷火 火山 风风 泽泽 风水 水泽 风泽 雷山 水火 火水'.split(' ')
if(pairs.length!==64||new Set(pairs).size!==64)throw Error('Incomplete trigram sequence')
for(let i=0;i<HEXAGRAM_DECK.length;i++){
 const card=HEXAGRAM_DECK[i],[upper,lower]=pairs[i],bits=trigrams[lower].bits+trigrams[upper].bits
 const bars=Array.from(bits).reverse().map((bit,row)=>bit==='1'?`<rect x="184" y="${418+row*49}" width="352" height="23" rx="4"/>`:`<rect x="184" y="${418+row*49}" width="146" height="23" rx="4"/><rect x="390" y="${418+row*49}" width="146" height="23" rx="4"/>`).join('')
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080" viewBox="0 0 720 1080"><defs><linearGradient id="paper" x2="0.8" y2="1"><stop stop-color="#fbf6e9"/><stop offset="1" stop-color="#ead7ae"/></linearGradient><linearGradient id="ink" x2="1" y2="1"><stop stop-color="#163f48"/><stop offset="1" stop-color="#32636b"/></linearGradient></defs><rect width="720" height="1080" rx="32" fill="url(#paper)"/><rect x="24" y="24" width="672" height="1032" rx="20" fill="none" stroke="#b3995e" stroke-width="3"/><rect x="38" y="38" width="644" height="1004" rx="12" fill="none" stroke="#cbb887"/><path d="M68 116V70h46 M606 70h46v46 M68 964v46h46 M606 1010h46v-46" fill="none" stroke="#214c54" stroke-width="5"/><g font-family="Microsoft YaHei,SimSun,sans-serif" text-anchor="middle"><text x="360" y="117" fill="#315760" font-size="30" letter-spacing="8">东方卦象</text><text x="360" y="176" fill="#8b713b" font-size="24">第 ${i+1} 卦</text><text x="360" y="300" fill="#183f48" font-size="100" font-weight="600">${xml(card.name)}</text><text x="360" y="361" fill="#6b6148" font-size="30">${upper===lower?xml(trigrams[upper].name+'为'+upper):xml(upper+lower+card.name)}</text><g fill="url(#ink)">${bars}</g><path d="M150 745H570" stroke="#b3995e" stroke-width="2"/><text x="360" y="803" fill="#315760" font-size="28">上卦 ${xml(trigrams[upper].name)} · ${upper}</text><text x="360" y="850" fill="#315760" font-size="28">下卦 ${xml(trigrams[lower].name)} · ${lower}</text><path d="M160 934L238 900 286 923 365 877 445 922 488 901 560 934" fill="none" stroke="#9c8755" stroke-width="3"/><text x="360" y="993" fill="#766947" font-size="20" letter-spacing="4">STEMist · 休闲启发</text></g></svg>`
 const bytes=await sharp(Buffer.from(svg)).png({compressionLevel:9}).toBuffer(),meta=await sharp(bytes).metadata();items.push(makeItem(card,'hexagram',bytes,meta));provenance.push({id:card.id,originalVector:true,upper,lower,bottomToTop:bits,svgSha256:sha(Buffer.from(svg))})
}
const license=Buffer.from('Rider-Waite-Smith Tarot. Artist: Pamela Colman Smith. Original artwork: 1909/1910.\nAll 78 file-description records were checked as Public domain on Wikimedia Commons.\nPublic Domain Mark: https://creativecommons.org/publicdomain/mark/1.0/\nIndividual source URLs, original image SHA-1 and downloaded thumbnail SHA-256 are retained in provenance.json.\nDownloaded thumbnail image bytes are unchanged. Reversed position is a client display transform only.\nSTEMist hexagram diagrams are original vector renderings of traditional factual trigram relations.\n')
save('RWS-SOURCES.txt',license)
items.sort((a,b)=>a.id.localeCompare(b.id,'en'))
const catalog={schemaVersion:'tavern-draw-art.v1',revision:'rws-hexagrams-20261022-v1',credits:[{kind:'tarot',title:'Rider-Waite-Smith',author:'Pamela Colman Smith',license:'Public domain',sourceUrl:'https://commons.wikimedia.org/wiki/Category%3ARider-Waite_tarot_deck',licenseUrl:'https://creativecommons.org/publicdomain/mark/1.0/'},{kind:'hexagram',title:'六十四卦图示',author:'STEMist',license:'原创图示',sourceUrl:'',licenseUrl:''}],items}
compileDrawArtCatalog(catalog)
save('catalog.json',Buffer.from(JSON.stringify(catalog,null,2)+'\n'))
save('provenance.json',Buffer.from(JSON.stringify({schemaVersion:'tavern-draw-art-provenance.v1',source:'Wikimedia Commons per-file imageinfo and rights metadata',sourceMetadataRetrievedAt:source.retrievedAt,sourceMetadataSha256:sha(Buffer.from(JSON.stringify(source))),licenseSha256:sha(license),tarotChanges:'Source-provided 500px thumbnail bytes unchanged; optional client display rotation only.',hexagramReference:'King Wen order and traditional trigram relations; independently drawn rectangles, not copied chart/font data.',items:provenance.sort((a,b)=>a.id.localeCompare(b.id,'en'))},null,2)+'\n'))
console.log(JSON.stringify({status:'ASSETS_VERIFIED',count:items.length,totalBytes:items.reduce((n,x)=>n+x.bytes,0),root,tarot:78,hexagrams:64}))
