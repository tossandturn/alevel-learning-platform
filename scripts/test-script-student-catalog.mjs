import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {publicScriptCatalog,newScriptGame,scriptGame} from '../server/scriptGameCatalog.js'
import {createScriptRoomStore} from '../server/scriptRoomStore.js'
import {scriptStageScene} from '../server/scriptSceneBeats.js'
import {scriptActorMessages} from '../server/scriptRoomApi.js'
import {visibleScriptRole} from '../server/scriptRoleCards.js'
const ids=['last-elective','inverted-observatory','thirteenth-curtain']
assert.deepEqual(publicScriptCatalog().map(g=>g.id),ids,'exactly three new-room books, one per content line')
const hashes=[
 ['before-rain',1,'b0a441a60f132319aafc32335b77587b35aa07489ee9b1ad19a6abaf590bfc4a'],
 ['before-rain',2,'6cec936e6bd1e232c957c685808985acd04131fdc15f73db781bd95de0c22f03'],
 ['before-rain',3,'5de8f36ea960acec65253a3620b4329990880cc026cd80314bc9405a8d1bd4de'],
 ['before-rain',4,'5cc8799e9c498293258c44507e3004a5d42bfb83ec2d40d255e7370c8804ba10'],
 ['before-rain',5,'2eb27948e1c520930a01f83c0e03eeb2a7fd836c9497bf2cf8a7d0471fd77f95'],
 ['thirteenth-curtain',1,'9fab5a23ff1d0fb9fdfcb686c3c7f84ab7c7a2a97afb07a490c7eaffce28fc33'],
 ['thirteenth-curtain',2,'0fb725baaf0a758b9349adf643fab8961ba69f1bd84c937ae45fbaf22e7e08fd'],
 ['thirteenth-curtain',3,'81fb008f7cadae303e17b6b593f88e911cd6e543794b7b4d22287d809513ebc1'],
 ['last-midnight',1,'4f9d7409ef1f7907fa1252ab9986b4fdfb9a2883186c8a8fa065135b13281001'],
 ['last-midnight',2,'18cda2d1a8e9153601d7e9948c91bcee27b3ddb993fb66f0aee5a04a632cdecd'],
 ['last-midnight',3,'6a654a3b3870094fa19ca264803a3507dbed9077e4bb2e57d5b2615c47ebed92'],
 ['inverted-observatory',1,'b0294dfb6fa989babd0e85ff50c400133ed0b69a6b2aa9019d007125f90afa7a'],
 ['inverted-observatory',2,'a4dde2236e1ee3b2d3ea8b819789b39d20e65c8c65566522dd229aea6541cfda'],
 ['inverted-observatory',3,'f3f19e4633d21f7feaa877e142b14cc00ba94a81c7b1967cffe86816710ff38d'],
 ['one-more-stop',2,'9f86769055be05b012989ae856b8f743df0655ec8a691362d64404ac8c23f39a'],
 ['one-more-stop',3,'408ce58611510bad6798e6d873bdb1271a8f19af92c93542b0c71faa949f99c7'],
 ['one-more-stop',4,'9908baf0a618fbb93c31b58682ce166b531f41d92a5ae5eae4df5860aa27e27e'],
 ['last-elective',2,'5ead48b7d1bf8ff8149ac9b95563c5414eb8ae03c3add11d4bc57652593d7254'],
 ['last-elective',3,'9972e1708a32a778af2b2343b1bb29a2adc6beff7d01d518a38cf51e8fe0e4d0'],
 ['venice-blue-hour',2,'77d70640b88c344fd899fc5916f35570b433de6e1dc5faf4c20e26f839d0676a'],
 ['venice-blue-hour',3,'0c67aa823ce3b52ac80d4f712474ecb674048c8033cea9a1248b2a2e8d72cfe9'],
]
assert.equal(hashes.length,21)
for(const[id,v,hash]of hashes)assert.equal(crypto.createHash('sha256').update(JSON.stringify(scriptGame(id,v))).digest('hex'),hash,`${id} old edition immutable`)
for(const id of ids){
 const g=newScriptGame(id,2)
 assert.equal(g.version,4);assert.equal(scriptGame(id,4,g.contentEdition),g)
 assert.equal(scriptGame(id,4,'bogus-edition'),null)
 assert.equal(g.acts.length,3)
 const reflections=new Set()
 for(const role of g.roles){assert.ok(role.entryBook.length>=750);assert.equal(role.missions.length,id==='thirteenth-curtain'?0:3);for(const mission of role.missions)for(const option of mission.options){assert.ok(option.followup?.length>15);assert.ok(!reflections.has(option.followup));reflections.add(option.followup)}}
 for(let mask=0;mask<1<<g.roles.length;mask++)for(let stage=0;stage<3;stage++){
  const ai=g.roles.filter((r,i)=>mask&(1<<i)).map(r=>r.id),scene=scriptStageScene(g,stage,ai)
  assert.ok(scene);assert.ok(scene.lines.every(l=>ai.includes(l.actor)))
 }
}
const campus=newScriptGame(ids[0],2),world=newScriptGame(ids[1],2)
const sparse0=scriptStageScene(world,0,['map','archive','light'])
assert.ok(!sparse0.lines.find(l=>l.actor==='archive').parts.some(p=>/^给你/.test(p.text)),'an omitted human cannot have asked the AI to pass paper')
const sparse1=scriptStageScene(world,1,['map','mechanic','light'])
assert.ok(!sparse1.lines.find(l=>l.actor==='light').parts.some(p=>/^说[。！]/.test(p.text)),'AI does not answer an omitted human proposal')
const mystery=newScriptGame(ids[2],2)
assert.doesNotMatch(mystery.clues[7].text,/承认|不能证明本人存活/)
assert.doesNotMatch(mystery.roles.find(r=>r.id==='restorer').entryBook,/调包、争执/)
assert.doesNotMatch(mystery.clues[11].text,/争执与撞击|预录启动|排练音效/)
assert.equal(mystery.discussionOpenings.length,3)
assert.equal(new Set(world.roles.flatMap(r=>r.chapters.map(c=>c.text))).size,12)
for(const r of world.roles)assert.doesNotMatch(r.chapters[2].text,/东门/,'the final private chapter does not pre-answer the exit puzzle')
for(const g of [campus,world]){
 assert.match(JSON.stringify(g),/18岁/)
 assert.doesNotMatch(JSON.stringify(g),/大学生|大学二年级|大二|大三|二十六岁|三十二岁|出版社退稿|村口老钟|工业设计系|应用数学系/)
 for(const role of g.roles){
  const context={scriptId:g.id,contentEdition:g.contentEdition,actor:visibleScriptRole(role,0,g.id),trigger:'你以前是做什么的？',messages:[],story:g.id==='last-elective'?{campus:true,student:true}:undefined}
  const prompt=JSON.stringify(scriptActorMessages(context))
  assert.doesNotMatch(prompt,/20岁|21岁|成年大学生|出版社退稿|村口老钟|二十六岁|三十二岁/)
  assert.match(prompt,/18岁|十八岁/)
 }
}
const root=fs.mkdtempSync(path.resolve(import.meta.dirname,'../../qa/student-catalog-'))
let sequence=0;const nonce=()=>`student-catalog-${++sequence}`,who='ielts:91850001'
let store=createScriptRoomStore({root})
try{
 for(const id of ['before-rain','last-midnight','one-more-stop','venice-blue-hour'])for(const version of [1,2,3,4]){
  assert.equal(newScriptGame(id,version),null)
  assert.throws(()=>store.create(who,{scriptId:id,scriptVersion:version,requestId:nonce()}),e=>e.code==='script_invalid_script')
 }
 store.close()
 // Seed an actual pre-retirement fixture through a constructor dependency;
 // production HTTP requests cannot supply this dependency.
 store=createScriptRoomStore({root,resolveNewGame:(id)=>scriptGame(id,5)})
 const requestId=nonce(),old=store.create(who,{scriptId:'before-rain',scriptVersion:2,requestId})
 store.close();store=createScriptRoomStore({root})
 assert.equal(store.get(who,old.id).title,old.title)
 assert.equal(store.create(who,{scriptId:'before-rain',scriptVersion:2,requestId}).id,old.id,'same receipt replays after retirement')
 const guest=store.join('ielts:91850002',{inviteCode:old.inviteCode,requestId:nonce(),clientVersion:2})
 assert.equal(guest.id,old.id,'historical room remains joinable')
}finally{store.close()}
console.log('PASS three-book catalogue, edition isolation, student actor contexts, retired create denial, old-room resume/join/receipt replay')
