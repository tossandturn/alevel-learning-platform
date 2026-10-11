import assert from 'node:assert/strict'

export const UNIVERSITY_DIRECTORY_SCHEMA='stemist-university-directory-v1'
const EXAM_BOARDS=Object.freeze([
 {id:'ap',label:'AP',organization:'College Board',url:'https://apstudents.collegeboard.org/'},
 {id:'ib',label:'IB',organization:'International Baccalaureate',url:'https://www.ibo.org/'},
 {id:'alevel',label:'A-Level',organization:'Cambridge International',url:'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-advanced/cambridge-international-as-and-a-levels/'},
])
const PUBLISHERS={
 'qs-world':{scope:'world',domains:['topuniversities.com','qs.com']},
 'usnews-national':{scope:'us-national',domains:['usnews.com']},
}
const clean=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value)
const id=value=>clean(value,100)&&/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(value)
const inDomain=(url,domains)=>domains.some(domain=>new URL(url).hostname===domain||new URL(url).hostname.endsWith('.'+domain))
const stamp=value=>clean(value,45)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value))
const portableStamp=value=>String(value).replace(/(\.\d{3})\d+(?=Z|[+-])/,'$1')
export function safeDirectoryUrl(value){
 if(!clean(value,2048)||/[\\\s]/.test(value))return false
 try{
  const url=new URL(value),host=url.hostname.toLowerCase()
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash
   &&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(host)
   &&!/(?:^|\.)(?:localhost|local|internal|invalid|test|onion)$/.test(host)&&!/^\d+(?:\.\d+)*$/.test(host)
 }catch{return false}
}
export function validateUniversityDirectory(value){
 assert.equal(value?.schemaVersion,UNIVERSITY_DIRECTORY_SCHEMA,'Directory schema mismatch')
 assert(stamp(value.updatedAt),'Invalid publication timestamp')
 assert.deepEqual(value.examBoards?.map(board=>board.id),EXAM_BOARDS.map(board=>board.id),'Exam board identities mismatch')
 for(const [index,board]of value.examBoards.entries()){
  assert(clean(board.label,100)&&clean(board.organization,160),'Invalid exam board label')
  assert(safeDirectoryUrl(board.url)&&board.url===EXAM_BOARDS[index].url,'Exam board official URL mismatch')
 }
 assert.deepEqual(value.rankings?.map(ranking=>ranking.id).sort(),Object.keys(PUBLISHERS).sort(),'Both ranking editions are required')
 const latestYear=new Date(value.updatedAt).getUTCFullYear()+1
 for(const ranking of value.rankings){
  const publisher=PUBLISHERS[ranking.id]
  assert.equal(ranking.scope,publisher.scope,'Ranking type mismatch')
  assert.equal(ranking.complete,true,'Incomplete ranking cannot be published')
  assert.equal(ranking.requestedRankLimit,100,'Top-100 scope required')
  assert(Number.isInteger(ranking.editionYear)&&ranking.editionYear>=2000&&ranking.editionYear<=latestYear,'Invalid ranking edition')
  assert(clean(ranking.label,100)&&stamp(ranking.verifiedAt)&&Date.parse(ranking.verifiedAt)<=Date.parse(value.updatedAt),'Invalid verification date or label')
  for(const key of ['sourceUrl','methodologyUrl'])assert(safeDirectoryUrl(ranking[key])&&inDomain(ranking[key],publisher.domains),'Publisher URL mismatch')
  assert(Array.isArray(ranking.items)&&ranking.items.length>=100&&ranking.items.length<=150,'Incomplete or unbounded top-100 set')
  const identities=new Set(),ranks=new Map()
  for(const item of ranking.items){assert(Number.isInteger(item.rank)&&item.rank>=1&&item.rank<=100,'Rank outside scope');ranks.set(item.rank,(ranks.get(item.rank)||0)+1)}
  assert.equal(ranking.items[0].rank,1,'Rank one is missing')
  assert(ranking.items.at(-1).rank>=95,'Last top-100 ranks are missing')
  let previous=0
  for(const item of ranking.items){
   assert(id(item.id)&&!identities.has(item.id),'Duplicate or invalid university identity');identities.add(item.id)
   assert(item.rank>=previous,'Ranking order mismatch');previous=item.rank
   assert.equal(item.rankLabel,(ranks.get(item.rank)>1?'=':'')+item.rank,'Tie label mismatch')
   assert(clean(item.nameEn,200)&&clean(item.nameZh,150)&&clean(item.country,100),'Incomplete university name or location')
   assert(safeDirectoryUrl(item.website),'Unsafe official university URL')
   if(ranking.scope==='us-national')assert.equal(item.country,'United States','Non-US university in national ranking')
  }
 }
 assert(Buffer.byteLength(JSON.stringify(value),'utf8')<=256*1024,'Public directory exceeds bounded payload budget')
 return true
}
export function buildUniversityDirectory({rankings,updatedAt}){
 assert(Array.isArray(rankings)&&rankings.length===2,'Both research inputs are required')
 for(const ranking of rankings){
  assert(ranking.complete===true,'Incomplete research cannot be published')
  for(const item of ranking.items||[])assert(safeDirectoryUrl(item.sourceUrl)&&safeDirectoryUrl(item.websiteSourceUrl),'Missing or unsafe research provenance')
 }
 const value={schemaVersion:UNIVERSITY_DIRECTORY_SCHEMA,updatedAt:portableStamp(updatedAt),examBoards:EXAM_BOARDS.map(board=>({...board})),rankings:rankings.map(ranking=>({
  id:ranking.id,label:ranking.label,editionYear:ranking.editionYear,verifiedAt:portableStamp(ranking.verifiedAt),sourceUrl:ranking.sourceUrl,methodologyUrl:ranking.methodologyUrl,scope:ranking.scope,requestedRankLimit:ranking.requestedRankLimit,complete:ranking.complete,
  items:ranking.items.map(({id,rank,rankLabel,nameEn,nameZh,country,website})=>({id,rank,rankLabel,nameEn,nameZh,country,website})),
 }))}
 validateUniversityDirectory(value)
 return value
}
