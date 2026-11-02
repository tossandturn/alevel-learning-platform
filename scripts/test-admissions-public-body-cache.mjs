import assert from 'node:assert/strict'
import { createAdmissionsResearch } from '../server/admissionsResearch.js'

let at=Date.now(),reads=0,offline=false
const url='https://www.ibo.org/programmes/diploma-programme/curriculum/'
const page={url,title:'DP curriculum',text:'# DP curriculum\nThe IB Diploma Programme curriculum consists of six subject groups and the DP core. Students take at least three subjects at higher level and the rest at standard level.'}
const research=createAdmissionsResearch({sourceCatalog:[],cacheNow:()=>at,now:()=>new Date(at),searchPublicSources:async()=>[],resolveAddresses:async()=>[{address:'8.8.8.8',family:4}],readPublicPage:async target=>{reads++;if(offline||target!==url)throw Error('unavailable');return page}})
const first=await research.prepareTurn({message:'IB课程结构是什么？'})
assert.equal(first.publicFields.research.sourceCount,1)
const initial=first.publicFields.research.sources[0]
offline=true;at+=60_000
const second=await research.prepareTurn({message:'IB科目选择规则是什么？'})
assert.equal(second.guardedAnswer,'')
assert.equal(second.publicFields.research.sourceCount,1)
assert.equal(second.publicFields.research.sources[0].retrievedAt,initial.retrievedAt,'cached body must not invent a fresh origin retrieval date')
assert.notEqual(second.publicFields.research.sources[0].id,initial.id,'each turn still has its own citation nonce')
assert.equal(second.publicFields.research.sources[0].verification.reusedVerifiedBody,true)
at+=11*60_000
const expired=await research.prepareTurn({message:'IB课程结构是什么？'})
assert.equal(expired.publicFields.research.sourceCount,0)
assert.ok(expired.guardedAnswer,'expired cached content is not silently treated as current')

let badReads=0
const bad=createAdmissionsResearch({sourceCatalog:[],searchPublicSources:async()=>[],resolveAddresses:async()=>[{address:'8.8.8.8',family:4}],readPublicPage:async target=>{badReads++;return{url:target,title:'DP curriculum',text:'# DP curriculum\nCookie settings only.'}}})
assert.equal((await bad.prepareTurn({message:'IB课程结构？'})).publicFields.research.sourceCount,0)
const count=badReads
assert.equal((await bad.prepareTurn({message:'IB课程结构？'})).publicFields.research.sourceCount,0)
assert.ok(badReads>count,'rejected and empty pages must not enter the verified-body cache')
console.log('PASS bounded public body cache: origin timestamp, new citation nonce, expiry, no failed-page cache and no student data')
