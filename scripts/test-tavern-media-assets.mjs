import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {DEFAULT_TAVERN_MEDIA_ROOT,compileTavernMediaCatalog} from '../server/tavernMedia.js'
const file=path.join(DEFAULT_TAVERN_MEDIA_ROOT,'catalog.json')
assert.ok(fs.existsSync(file),'The large original media catalog must exist before release')
const raw=JSON.parse(fs.readFileSync(file,'utf8')),catalog=compileTavernMediaCatalog(raw)
assert.ok(catalog.items.filter(item=>item.kind==='sticker').length>=96)
assert.ok(catalog.items.filter(item=>item.kind==='image').length>=12)
function jpegDimensions(bytes){assert.equal(bytes.readUInt16BE(0),0xffd8);let offset=2;while(offset+8<bytes.length){if(bytes[offset]!==255){offset++;continue}while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;const size=bytes.readUInt16BE(offset);assert.ok(size>=2&&offset+size<=bytes.length);if([0xc0,0xc1,0xc2].includes(marker))return{height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)};offset+=size}throw Error('Missing JPEG size')}
let total=0
for(const [name,expected] of catalog.files){
 const target=path.join(DEFAULT_TAVERN_MEDIA_ROOT,name);assert.equal(fs.lstatSync(target).isSymbolicLink(),false)
 const bytes=fs.readFileSync(target);total+=bytes.length
 assert.ok(bytes.length<512*1024,'each media file must be small enough for phone delivery')
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected.sha256)
 assert.deepEqual(jpegDimensions(bytes),{width:expected.width,height:expected.height})
}
assert.ok(total<8*1024*1024,'full library has a bounded server footprint; client does not bundle it')
const source=JSON.stringify(raw);assert.doesNotMatch(source,/C:\\\\Users|D:\\\\Users|api[_-]?key|Bearer\s/i)
console.log(JSON.stringify({status:'PASS_ORIGINAL_MEDIA_LIBRARY',stickers:catalog.items.filter(item=>item.kind==='sticker').length,images:catalog.items.filter(item=>item.kind==='image').length,sourceFiles:catalog.files.size,totalBytes:total,uniqueVisuals:catalog.items.length}))
