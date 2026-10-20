import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const modulePath=new URL('../server/tavernMedia.js',import.meta.url)
assert.ok(fs.existsSync(modulePath),'Tavern media protocol module must exist')
const {compileTavernMediaCatalog,selectTavernMediaCandidates,normalizeTavernMediaReply,normalizeTavernMediaItems,tavernMediaSystemPrompt,createTavernMediaCatalogReader}=await import(modulePath.href)
const digest='a'.repeat(64),file=`atlas-${digest.slice(0,16)}.jpg`
const entries=Array.from({length:108},(_,i)=>{const hash=crypto.createHash('sha256').update('fixture-'+(i<96?Math.floor(i/12):i)).digest('hex');return{id:`fixture-${i}`,kind:i<96?'sticker':'image',caption:i%2?'抱抱':'一起去海边',alt:'合成测试素材',tags:i%2?['安慰','难过','抱抱']:['海边','旅行'],file:`atlas-${hash.slice(0,16)}.jpg`,width:960,height:720,sha256:hash,...(i<96?{frame:{columns:4,rows:3,column:i%4,row:Math.floor(i/4)%3}}:{})}})
const catalog=compileTavernMediaCatalog({schemaVersion:'tavern-media.v1',revision:'fixture-v1',items:entries})
assert.equal(catalog.items.length,108)
const englishCatalog=compileTavernMediaCatalog({schemaVersion:'tavern-media.v1',items:[{...entries[0],id:'a-hi',tags:['hi']},{...entries[12],id:'z-support',tags:['hard day']}]})
assert.equal(selectTavernMediaCandidates(englishCatalog,{message:'this is a hard day'})[0].id,'z-support','English retrieval must match whole words, not hi inside this')
const candidates=selectTavernMediaCandidates(catalog,{message:'今天很难过，想要抱抱',persona:'keeper',recentIds:['fixture-1']})
assert.ok(candidates.length<=16)
assert.ok(candidates.some(item=>item.tags.includes('安慰')))
assert.ok(!candidates.some(item=>item.id==='fixture-1'))
const chosen=candidates.find(item=>item.kind==='sticker')
const reply=normalizeTavernMediaReply(JSON.stringify({text:'我在，慢慢说。',media:[chosen.id,'https://untrusted.invalid/x.png','does-not-exist']}),{catalog,candidates})
assert.equal(reply.text,'我在，慢慢说。')
assert.equal(reply.media.length,1)
assert.equal(reply.media[0].id,chosen.id)
assert.equal(normalizeTavernMediaItems([{...reply.media[0],id:42}]).length,0,'media IDs must be strings')
assert.match(reply.media[0].src,/^\/api\/ai\/tavern\/media\/v1\//)
assert.equal(normalizeTavernMediaReply('纯文字也要保留',{catalog,candidates}).text,'纯文字也要保留')
assert.equal(normalizeTavernMediaReply('{"text":',{catalog,candidates}).text,'','malformed structured output is not displayed as raw JSON')
assert.deepEqual(normalizeTavernMediaReply(JSON.stringify({text:'有效文字',media:['not-allowed']}),{catalog,candidates}),{text:'有效文字',media:[]})
assert.equal(normalizeTavernMediaItems([{...reply.media[0],src:'https://untrusted.invalid/a.jpg'}]).length,0)
assert.equal(normalizeTavernMediaItems([{...reply.media[0],frame:{columns:4,rows:3,column:99,row:0}}]).length,0)
assert.ok(tavernMediaSystemPrompt(candidates).includes(chosen.id))
assert.ok(tavernMediaSystemPrompt(candidates).length<7000)
assert.match(tavernMediaSystemPrompt(candidates),/draw receipt/i,'illustrations must never replace real server-owned Tarot or hexagram results')
assert.throws(()=>compileTavernMediaCatalog({schemaVersion:'tavern-media.v1',items:[entries[0],entries[0]]}),/duplicate/i)
assert.throws(()=>compileTavernMediaCatalog({schemaVersion:'tavern-media.v1',items:[{...entries[0],file:'../secret'}]}),/asset|file/i)

const {createTavernConversationStore}=await import('../server/tavernConversationStore.js')
const scratch=path.resolve('.tmp-test');fs.mkdirSync(scratch,{recursive:true})
const root=fs.mkdtempSync(path.join(scratch,'tavern-media-'))
assert.equal(typeof createTavernMediaCatalogReader,'function','catalog updates must be loadable without a client rebuild')
let clock=0
const catalogFile=path.join(root,'catalog.json');fs.writeFileSync(catalogFile,JSON.stringify({schemaVersion:'tavern-media.v1',revision:'first',items:entries.slice(0,1)}))
const readCatalog=createTavernMediaCatalogReader({root,now:()=>clock})
assert.equal(readCatalog().items.length,1)
fs.writeFileSync(catalogFile,JSON.stringify({schemaVersion:'tavern-media.v1',revision:'second',items:entries.slice(0,2)}));clock+=6000
assert.equal(readCatalog().items.length,2)
fs.writeFileSync(catalogFile,'invalid in-progress manifest');clock+=6000
assert.equal(readCatalog().items.length,2,'invalid updates retain the last valid catalog')
const store=createTavernConversationStore({root})
const ownerId='ielts:9981',persona='keeper'
try{
 const resumed=store.resumeConversation({ownerId,persona})
 const input={ownerId,persona,conversationId:resumed.id,clientTurnId:'media-turn-test-0001',expectedRevision:resumed.revision,message:'今天很难过',requestHash:crypto.createHash('sha256').update('fixture').digest('hex')}
 const pending=store.beginTurn(input)
 const complete=store.completeTurn({...input,leaseId:pending.leaseId,assistantContent:reply.text,media:reply.media,memory:{contextWindowTokens:32000}})
 assert.deepEqual(complete.turns[1].media,reply.media,'accepted media is canonical, not a transient UI decoration')
 assert.deepEqual(store.getMessages({ownerId,persona,conversationId:input.conversationId}).messages[1].media,reply.media)
 assert.deepEqual(store.replayCompletedTurn(input).turns[1].media,reply.media)
 assert.throws(()=>store.getMessages({ownerId:'ielts:9982',persona,conversationId:input.conversationId}),/available|bound|found|owner/i)
}finally{store.close()}
console.log('Tavern media catalog, bounded AI choice, invalid-media fallback, persistence, replay and owner isolation passed.')
