import assert from 'node:assert/strict'
import { createAdmissionsSearchProvider } from '../server/admissionsSearchProvider.js'
import { createAdmissionsResearch } from '../server/admissionsResearch.js'

const url='https://www.ibo.org/programmes/diploma-programme/curriculum/'
const body='# DP curriculum\nThe International Baccalaureate Diploma Programme curriculum is made up of the DP core and six subject groups.\nStudents take a minimum of three or a maximum of four subjects at higher level. Other subjects are at standard level.'
let sent
const provider=createAdmissionsSearchProvider({env:{STEM_ADMISSIONS_DEEPSEEK_API_KEY:'synthetic-body-key'},fetchImpl:async(_url,options)=>{
 sent=JSON.parse(options.body)
 return new Response(JSON.stringify({results:[{url,title:'DP curriculum',content:body,summary:'A fake generated summary says all universities require IB 45.',snippet:'Unverified snippet.'}]}))
}})
const found=await provider.search({query:'IB DP curriculum site:ibo.org',includeContent:true})
assert.equal(sent.need_content,true)
assert.equal(found[0].pageContent,body)
assert.doesNotMatch(JSON.stringify(found),/IB 45|Unverified snippet/)
let reads=0
const research=createAdmissionsResearch({sourceCatalog:[],resolveAddresses:async()=>[{address:'8.8.8.8',family:4}],
 searchPublicSources:async()=>found,readPublicPage:async()=>{reads++;throw Object.assign(Error('blocked'),{code:'ADMISSIONS_SOURCE_HTTP_STATUS'})},fetchReadPublicPage:async()=>{throw Error('must not need this')},
})
const result=await research.prepareTurn({message:'IB课程结构是什么？'})
assert.ok(reads>0)
assert.equal(result.guardedAnswer,'')
assert.ok(result.publicFields.research.sources.some(source=>source.verification.transport==='deepseek-search-content'))
assert.doesNotMatch(result.systemMessage,/IB 45|Unverified snippet/)
assert.match(result.systemMessage,/six subject groups/)

const snippetOnly=createAdmissionsResearch({sourceCatalog:[],resolveAddresses:async()=>[{address:'8.8.8.8',family:4}],searchPublicSources:async()=>[{url,title:'DP curriculum',summary:body,snippet:body}],readPublicPage:async()=>{throw Error('blocked')},fetchReadPublicPage:async()=>{throw Error('blocked')}})
const failed=await snippetOnly.prepareTurn({message:'IB课程结构是什么？'})
assert.equal(failed.publicFields.research.sourceCount,0)
assert.ok(failed.guardedAnswer,'a summary may not be promoted into page evidence')

const searchDown=createAdmissionsResearch({sourceCatalog:[],resolveAddresses:async()=>[{address:'8.8.8.8',family:4}],searchPublicSources:async()=>{throw Object.assign(Error('search unavailable'),{code:'ADMISSIONS_SEARCH_HTTP_503'})},readPublicPage:async sourceUrl=>({url:sourceUrl,title:'DP curriculum',text:body})})
const direct=await searchDown.prepareTurn({message:'IB课程结构是什么？'})
assert.ok(direct.publicFields.research.sourceCount>0,'known reviewed curriculum pages remain readable when discovery is unavailable')
console.log('PASS official page-body fallback: content field only, exact safe URL, substantive validation, no snippet promotion, direct known-source recovery')
