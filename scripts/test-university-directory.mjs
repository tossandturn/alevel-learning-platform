import assert from 'node:assert/strict'
import {buildUniversityDirectory,validateUniversityDirectory,safeDirectoryUrl} from '../server/universityDirectory.js'

// Synthetic data and a fixed test clock only; these are not real rankings.
const time='2000-01-01T00:00:00Z'
function ranking(id,scope,count,host){return{id,label:id,editionYear:2001,verifiedAt:time,sourceUrl:`https://${host}/rankings`,methodologyUrl:`https://${host}/methodology`,scope,requestedRankLimit:100,complete:true,items:Array.from({length:count},(_,i)=>({id:`fixture-${id}-${i+1}`,rank:Math.min(i+1,100),rankLabel:i>=99&&count>100?'=100':String(i+1),nameEn:`Synthetic University ${i+1}`,nameZh:`测试院校 ${i+1}`,country:scope==='world'?'Test Region':'United States',website:`https://school-${i+1}.example.edu/`,sourceUrl:`https://${host}/rankings`,websiteSourceUrl:`https://school-${i+1}.example.edu/`}))}}
const qs=()=>ranking('qs-world','world',100,'www.topuniversities.com'),us=()=>ranking('usnews-national','us-national',108,'www.usnews.com')
const build=()=>buildUniversityDirectory({rankings:[qs(),us()],updatedAt:time})
const directory=build()
assert.equal(directory.schemaVersion,'stemist-university-directory-v1')
assert.equal(directory.rankings[1].items.length,108,'All ties at rank 100 survive')
assert.deepEqual(directory.examBoards.map(x=>x.id),['ap','ib','alevel'])
assert.equal(directory.rankings[1].items.at(-1).rankLabel,'=100')
assert(!('websiteSourceUrl' in directory.rankings[0].items[0]),'Research provenance stays separate from the compact student payload')
assert.equal(validateUniversityDirectory(directory),true)
const precise=qs();precise.verifiedAt='1999-12-31T23:59:59.1234567Z'
assert.equal(buildUniversityDirectory({rankings:[precise,us()],updatedAt:time}).rankings[0].verifiedAt,'1999-12-31T23:59:59.123Z','Public timestamps retain the observed time at portable millisecond precision')
for(const url of ['http://example.edu/','https://127.1/','https://localhost/','https://[::1]/','https://127.0.0.1/','https://me:pass@example.edu/','https://example.edu:444/','https://example.edu/?token=x','https://example.edu/#a','https://bad.example\\@example.edu/','javascript:alert(1)'])assert.equal(safeDirectoryUrl(url),false,url)
assert.equal(safeDirectoryUrl('https://www.cam.ac.uk/'),true)
assert.equal(safeDirectoryUrl('https://www.ibo.org/programmes/diploma-programme/'),true)
for(const mutate of [
 d=>{d.rankings[0].complete=false},
 d=>{d.rankings[0].items.pop()},
 d=>{d.rankings[0].items[0].rank=0},
 d=>{d.rankings[0].items[0].rank=101},
 d=>{d.rankings[0].items[1].id=d.rankings[0].items[0].id},
 d=>{d.rankings[1].scope='world'},
 d=>{d.rankings[0].editionYear=2100},
 d=>{d.rankings[0].items[0].website='https://localhost/'},
 d=>{d.rankings[1].sourceUrl='https://example.org/rankings'},
 d=>{d.examBoards[0].url='https://example.org/ap'},
 d=>{d.rankings[1].items.at(-1).rankLabel='100'},
 d=>{d.rankings[0].verifiedAt='2002-01-01T00:00:00Z'},
]){const value=structuredClone(directory);mutate(value);assert.throws(()=>validateUniversityDirectory(value))}
const missing=qs();delete missing.items[0].websiteSourceUrl
assert.throws(()=>buildUniversityDirectory({rankings:[missing,us()],updatedAt:time}),/provenance/)
console.log('University directory: complete top-100 sets including ties, publisher/campus identity, safe official URLs, timestamps and provenance passed.')
