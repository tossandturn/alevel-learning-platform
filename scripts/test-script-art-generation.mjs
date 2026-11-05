import assert from 'node:assert/strict'
import {createTavernImageGenerator} from '../server/tavernImageGeneration.js'
import {scriptImagePlan} from '../server/scriptArt.js'
import {newScriptGame} from '../server/scriptGameCatalog.js'
const game=newScriptGame('before-rain',2),plan=scriptImagePlan(game,0,'重新画许知夏和周泊舟在窗边喝茶')
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]),calls=[]
const generator=createTavernImageGenerator({env:{TAVERN_IMAGE_API_KEY:'fixture-only',TAVERN_IMAGE_BASE_URL:'https://fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'},fetchImpl:async(url,options)=>{
 calls.push({url,body:JSON.parse(options.body)})
 return {ok:true,json:async()=>({data:[{b64_json:png.toString('base64'),mime_type:'image/png'}]})}
}})
await generator.generate({ownerId:'ielts:980001',persona:'script-room',prompt:'重新画许知夏和周泊舟在窗边喝茶，改成真人照片',scriptScene:{id:game.id,version:2,stage:0,title:game.title,visualCanon:game.visualCanon,act:game.acts[0].title,setting:game.acts[0].opening,artDirection:plan.artDirection,referenceIds:[...plan.referenceIds,'https://evil.invalid/a','scriptanime-stars-role-map']}})
assert.equal(calls.length,1)
assert.match(calls[0].url,/ap-southeast-1.*\/images\/generations$/)
assert.equal(calls[0].body.image?.length,3,'real generation must include scoped art reference images')
for(const url of calls[0].body.image)assert.match(url,/^https:\/\/stem\.ieltsist\.com\/api\/ai\/tavern\/media\/v1\/scriptanime-rain-/)
assert.match(calls[0].body.prompt,/2D anime/);assert.match(calls[0].body.prompt,/never change the 2D anime style/)
assert.match(calls[0].body.prompt,/许知夏/);assert.doesNotMatch(calls[0].body.prompt,/secret|evil\.invalid/)
await generator.generate({ownerId:'ielts:980002',persona:'mystery-guide',prompt:'画一盏灯',scriptScene:{referenceIds:plan.referenceIds,id:game.id,stage:0}})
assert.equal(calls[1].body.image,undefined,'ordinary Tavern must not accidentally receive game references')
console.log('PASS: Singapore reference payload, anime style lock, untrusted URL and ordinary Tavern isolation')
