import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {SCRIPT_ANIME_ASSETS} from '../server/scriptArtSpec.js'
import {loadTavernMediaCatalog,selectTavernMediaCandidates,DEFAULT_TAVERN_MEDIA_ROOT} from '../server/tavernMedia.js'
import {SCRIPT_GAMES,scriptGame,newScriptGame,publicScriptCatalog} from '../server/scriptGameCatalog.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'

const catalog=loadTavernMediaCatalog()
assert.equal(catalog.items.filter(i=>i.id.startsWith('scriptanime-')).length,64,'approved original, campus and Venice art packs are loaded')
const {scriptSceneArt,scriptImagePlan,scriptImageIntent,scriptArtReferenceUrls}=await import('../server/scriptArt.js')
for(const asset of SCRIPT_ANIME_ASSETS){
 const item=catalog.byId.get('scriptanime-'+asset.id)
 const bytes=fs.readFileSync(path.join(DEFAULT_TAVERN_MEDIA_ROOT,item.file))
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256)
 assert.ok(bytes.length<2*1024*1024);assert.equal(item.kind,'image')
}
assert.ok(!selectTavernMediaCandidates(catalog,{message:'许知夏 合影 星图'}).some(i=>i.id.startsWith('scriptanime-')))
const game=newScriptGame('before-rain',2),portrait=scriptImagePlan(game,0,'给我看看许知夏的立绘')
assert.equal(portrait.asset.id,'scriptanime-rain-role-letter')
assert.equal(scriptImagePlan(game,0,'看看白色纸袋的图片').asset.id,'scriptanime-rain-prop-paperbag')
assert.equal(scriptImagePlan(game,0,'看看全员合影').asset.id,'scriptanime-rain-ensemble')
assert.equal(scriptImagePlan(game,0,'看看当前场景').asset.id,'scriptanime-rain-scene-0')
assert.ok(scriptImagePlan(game,0,'画出凶手').blocked)
assert.ok(scriptImagePlan(game,0,'画旧广播室').blocked,'future scene cannot be generated early')
assert.equal(scriptImagePlan(newScriptGame('one-more-stop',2),0,'画出候车室窗边的暖灯').blocked,false,'generic window details must not be mistaken for an unreached chapter')
assert.ok(scriptImagePlan(game,0,'画裸体许知夏').blocked,'stock matching must not bypass safety')
assert.equal(scriptImagePlan(game,0,'重新画许知夏站在窗边的画面').asset,null)
assert.equal(scriptImagePlan(game,0,'画许知夏和周泊舟在雨窗前喝茶').asset,null)
assert.ok(scriptImageIntent('画许知夏站在窗边的画面'))
assert.ok(scriptImageIntent('我想看看许知夏的立绘'))
for(const s of ['你记得照片吗','看看证据','不要画图','他画了一幅画','画图会扣次数吗'])assert.equal(scriptImageIntent(s),false,s)
const refs=scriptImagePlan(game,0,'重新画许知夏和周泊舟在窗边喝茶')
assert.equal(refs.referenceIds.length,3)
assert.ok(refs.referenceIds.includes('scriptanime-rain-role-letter'))
assert.ok(refs.referenceIds.includes('scriptanime-rain-role-repair'))
assert.equal(scriptArtReferenceUrls({referenceIds:['https://evil.invalid/a','scriptanime-stars-role-map','scriptanime-rain-role-letter'],id:'before-rain',stage:0}).length,1)
for(const row of publicScriptCatalog())assert.match(row.cover,/scriptanime-.*scene-0-/)
assert.equal(crypto.createHash('sha256').update(JSON.stringify(SCRIPT_GAMES)).digest('hex'),'da32207fa29d8bdba4dcd2fb08344d85d2d4fcbbfbd76dd87951c64ec2157397','art must not rewrite game truth')
assert.equal(crypto.createHash('sha256').update(JSON.stringify(scriptGame('before-rain',3))).digest('hex'),'5de8f36ea960acec65253a3620b4329990880cc026cd80314bc9405a8d1bd4de')

const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/script-art-test-')),store=createScriptRoomStore({root})
let seq=0
const next=()=>`art-test-${++seq}`,who='ielts:91001',peer='ielts:91002',outsider='ielts:91003'
let room=store.create(who,{scriptId:game.id,scriptVersion:2,requestId:next()})
assert.equal(room.phase,'lobby');assert.match(room.act.image,/scriptanime-rain-scene-0-/)
assert.equal(room.act.puzzle,null);assert.equal(room.act.objective,'');assert.equal(room.myRole.secret,undefined)
room=store.join(peer,{inviteCode:room.inviteCode,roleId:'repair',requestId:next()})
room=store.join(outsider,{inviteCode:room.inviteCode,roleId:'photo',requestId:next()})
const act=(owner,type,extra={})=>{room=store.act(owner,room.id,{type,revision:room.revision,requestId:next(),...extra});return room}
for(const owner of [who,peer,outsider])act(owner,'ready')
act(who,'start')
assert.equal(room.act.image,room.messages.find(m=>m.actor==='dm'&&m.kind==='narration').image)
const before=JSON.stringify([room.publicClues,room.myClues,room.myMissions,room.relationship])
act(who,'image',{target:'repair',text:'给我看看许知夏的立绘'})
assert.equal(room.jobs.length,0,'prepared art must not queue a provider call')
assert.match(room.messages.at(-1).image,/scriptanime-rain-role-letter-/)
assert.ok(store.get(peer,room.id).messages.some(m=>m.image?.includes('rain-role-letter')))
assert.ok(!store.get(outsider,room.id).messages.some(m=>m.image?.includes('rain-role-letter')))
assert.equal(JSON.stringify([room.publicClues,room.myClues,room.myMissions,room.relationship]),before)
act(who,'chat',{target:'dm',text:'我想看看白色纸袋的图片'})
assert.match(room.messages.at(-1).image,/scriptanime-rain-prop-paperbag-/)
assert.equal(room.jobs.length,0)
act(who,'image',{target:'dm',text:'重新画许知夏站在窗边，保持二次元风格'})
const lease=store.leaseJob(room.id,'image')
assert.equal(lease.imageInput.scriptScene.stage,0)
assert.equal(lease.imageInput.scriptScene.referenceIds.length,2)
assert.match(lease.imageInput.scriptScene.artDirection,/2D anime/)
assert.ok(!JSON.stringify(lease.imageInput).includes(game.truth))
room=store.get(who,room.id)
act(who,'image',{target:'public',text:'看看合影'})
assert.match(room.messages.at(-1).image,/scriptanime-rain-ensemble-/,'stock art still available during a live job')
assert.throws(()=>act(who,'image',{text:'画出密码',target:'public'}),e=>e.code==='script_image_spoiler')
store.close();fs.rmSync(root,{recursive:true,force:true})
console.log('PASS: 64 assets, fixed canon, privacy, stock reuse, scoped references, stage and safety gates')
