import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createTavernConversationStore} from '../server/tavernConversationStore.js'
import {createTavernDivinationStore} from '../server/tavernDivination.js'
const scratch=path.resolve('.tmp-test');fs.mkdirSync(scratch,{recursive:true});const root=fs.mkdtempSync(path.join(scratch,'draw-history-'))
let store
try{
 let now=Date.parse('2026-10-31T04:00:00Z'),counter=0
 const options={root,now:()=>now,randomUUID:()=>`20000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`,quotaBytes:8*1024*1024,completePairsOnly:true}
 store=createTavernConversationStore(options)
 const draws=createTavernDivinationStore({now:()=>now,randomInt:()=>0})
 for(const persona of ['tarot-reader','eastern-oracle']){
  const ownerId='ielts:97001',draw=draws.createDraw({ownerId,persona,spread:persona==='tarot-reader'?'three':'single',nonce:'nonce-'+persona}),conversation=store.resumeConversation({ownerId,persona})
  const input={ownerId,persona,conversationId:conversation.id,clientTurnId:'history-draw-'+persona,expectedRevision:conversation.revision,message:'合成抽取请求',requestHash:'request-hash-'+persona,draw:{...draw,privateOwner:'must-not-escape'}}
  const begun=store.beginTurn(input);store.completeTurn({...input,leaseId:begun.leaseId,assistantContent:'合成解读'})
  now+=3600000
  const page=store.getMessages({ownerId,persona,conversationId:conversation.id,limit:1})
  assert.equal(page.messages.length,1);assert.equal(page.messages[0].role,'assistant')
  assert.equal(page.messages[0].draw?.id,draw.id,'history assistant must carry its own expired-but-displayable original draw, even when the paired user is outside the page')
  assert.equal(page.messages[0].draw.cards.length,draw.cards.length);assert.equal(page.messages[0].draw.privateOwner,undefined)
  const all=store.getMessages({ownerId,persona,conversationId:conversation.id});assert.equal(all.messages[0].draw,undefined)
  assert.throws(()=>store.getMessages({ownerId:'ielts:97002',persona,conversationId:conversation.id}))
  const context=store.contextForProvider({ownerId,persona,conversationId:conversation.id,model:'deepseek-chat',currentMessage:'继续聊天',systemPrompt:'fixture'})
  assert.ok(context.messages.every(x=>x.draw===undefined),'render metadata must not alter provider envelopes')
  store.close();store=createTavernConversationStore(options)
  assert.equal(store.getMessages({ownerId,persona,conversationId:conversation.id,limit:1}).messages[0].draw.id,draw.id,'restart restores per-turn artwork')
 }
 console.log('Authenticated per-reply draw history, page boundaries, restart, expiry display and provider isolation PASS')
}finally{store?.close();const relative=path.relative(fs.realpathSync(scratch),fs.realpathSync(root));assert.match(relative,/^draw-history-[^/\\]+$/);fs.rmSync(root,{recursive:true,force:true})}
