import assert from 'node:assert/strict'
import {currentEditorialBooks,editorialPacket,editorialMessages,validateEditorialReview,EDITORIAL_DIMENSIONS} from './helpers/script-editorial-review.mjs'

const books=currentEditorialBooks()
assert.equal(books.length,7)
assert.equal(new Set(books.map(g=>g.id)).size,7)
const game=books.find(g=>g.id==='last-elective'),packet=editorialPacket(game)
assert.match(packet.contentHash,/^[a-f0-9]{64}$/)
assert.equal(packet.book.roles[0].entryBook,game.roles[0].entryBook)
assert.equal(packet.book.acts[2].puzzle.answers[0],game.acts[2].puzzle.answers[0])
assert.notEqual(editorialPacket({...game,title:game.title+'修订'}).contentHash,packet.contentHash)
assert.equal(editorialPacket({...game,privateToken:'DO_NOT_EXPORT',env:{secret:'DO_NOT_EXPORT'}}).contentHash,packet.contentHash)
assert.ok(!JSON.stringify(packet).includes('DO_NOT_EXPORT'))
assert.match(editorialMessages(packet)[0].content,/独立审稿/)
assert.match(editorialMessages(packet)[0].content,/不是角色扮演/)
const scores=Object.fromEntries(EDITORIAL_DIMENSIONS.map(key=>[key,{score:4,reason:'人物经历和当前任务相互衔接。',evidencePath:'book.summary',evidenceQuote:game.summary.slice(0,20)}]))
const review={schemaVersion:'script-editorial-review-v1',contentHash:packet.contentHash,verdict:'revise',scores,issues:[{id:'R1',severity:'major',path:'book.summary',quote:game.summary.slice(0,20),problem:'需要检查玩家互动是否足够具体。',repair:'增加一次有反馈但不代替选择的双人互动。'}],playtests:[{roleId:game.roles[0].id,stage:0,player:'先不做题，跟我坐会儿。',expected:'先回应邀请，不以任务为条件。'},{roleId:game.roles[1].id,stage:1,player:'我们上一幕改过的约定呢？',expected:'沿用实际对话，不重开关系。'}]}
assert.deepEqual(validateEditorialReview(review,packet),[])
assert.ok(validateEditorialReview({...review,contentHash:'0'.repeat(64)},packet).includes('content-hash-mismatch'))
assert.ok(validateEditorialReview({...review,verdict:'pass'},packet).includes('pass-with-major-issue'))
assert.ok(validateEditorialReview({...review,issues:[{...review.issues[0],quote:'THIS IS NOT IN THE BOOK'}]},packet).includes('unsupported-issue-evidence:R1'))
assert.ok(validateEditorialReview({...review,scores:{...scores,interaction:{...scores.interaction,score:0}}},packet).includes('invalid-score:interaction'))
assert.ok(validateEditorialReview({...review,playtests:[]},packet).includes('insufficient-playtests'))
console.log('PASS editorial export: seven complete fictional books, content pinning, independent rubric, evidence-backed issues and no false PASS')
