import assert from 'node:assert/strict'
import {safeDirectoryUrl} from './universityDirectory.js'

export const UNIVERSITY_PROFILE_PREFIX='/data/university-profiles/v1/'
const kinds=new Set(['verified-overview','preparation-guide'])
const id=v=>typeof v==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)&&v.length<=110
const text=(v,max)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\u0000-\u001f<>]/.test(v)
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
const ANALYSIS_IDS=['alevel','ib','ap','language','competition','research'],ANALYSIS_LABELS=['A-Level','IB','AP','语言','竞赛','科研／项目']
const ANALYSIS_STATUSES=new Set(['official','course-specific','holistic','not-required','unverified'])
function validateAdmissionAnalysis(v,sources){
 assert.equal(v?.schemaVersion,'undergraduate-six-dimensions-v1');assert(date(v.updatedOn)&&text(v.summary,300));assert(Array.isArray(v.modules)&&v.modules.length===6)
 for(const [i,m]of v.modules.entries()){assert.equal(m.id,ANALYSIS_IDS[i]);assert.equal(m.label,ANALYSIS_LABELS[i]);assert(ANALYSIS_STATUSES.has(m.status));assert(text(m.headline,160)&&text(m.detail,500)&&text(m.advice,500));assert(Array.isArray(m.sourceIds)&&m.sourceIds.length<=6&&new Set(m.sourceIds).size===m.sourceIds.length&&m.sourceIds.every(id=>sources.has(id)));if(m.status!=='unverified')assert(m.sourceIds.length>0,'Official analysis facts require source references')}
}
export function validateUniversityProfile(v){
 assert.equal(v?.schemaVersion,'stemist-university-profile-v1');assert(id(v.id));assert(kinds.has(v.kind));assert(date(v.updatedOn));assert(text(v.scope,160));assert(text(v.summary,160));assert(text(v.notice,240))
 assert(Array.isArray(v.sources)&&v.sources.length>=1&&v.sources.length<=10);const sources=new Set()
 for(const s of v.sources){assert(id(s.id)&&!sources.has(s.id));sources.add(s.id);assert(text(s.title,160)&&safeDirectoryUrl(s.url))}
 assert(Array.isArray(v.sections)&&v.sections.length>=1&&v.sections.length<=6)
 for(const s of v.sections){assert(text(s.label,40)&&text(s.text,800));assert(Array.isArray(s.sourceIds)&&s.sourceIds.length<=10);assert(new Set(s.sourceIds).size===s.sourceIds.length);assert(s.sourceIds.every(x=>sources.has(x)));if(v.kind==='verified-overview')assert(s.sourceIds.length>0,'School claims require supporting source IDs')}
 if(v.analysis!==undefined)validateAdmissionAnalysis(v.analysis,sources)
 assert(Buffer.byteLength(JSON.stringify(v))<=16*1024);return true
}
export function validateUniversityProfileIndex(v){
 assert.equal(v?.schemaVersion,'stemist-university-profile-index-v1');assert(text(v.updatedAt,40)&&/^\d{4}-\d{2}-\d{2}T/.test(v.updatedAt)&&Number.isFinite(Date.parse(v.updatedAt)));assert(text(v.revision,80));assert(Array.isArray(v.items)&&v.items.length>=1&&v.items.length<=250)
 const ids=new Set(),aliases=new Set()
 for(const item of v.items){
  assert(id(item.id)&&!ids.has(item.id));ids.add(item.id);assert(kinds.has(item.kind));assert(text(item.summary,160));assert(digest(item.profileSha256));assert.equal(item.profilePath,UNIVERSITY_PROFILE_PREFIX+'profiles/'+item.id+'-'+item.profileSha256.slice(0,16)+'.json')
  assert(Array.isArray(item.aliases)&&item.aliases.length>=1&&item.aliases.length<=6&&item.aliases.includes(item.id));for(const alias of item.aliases){assert(id(alias)&&!aliases.has(alias));aliases.add(alias)}
  if(item.logo!==null){const logo=item.logo;assert(logo&&digest(logo.sha256)&&Number.isInteger(logo.bytes)&&logo.bytes>=64&&logo.bytes<=524288);assert(!logo.tone||['light','dark'].includes(logo.tone));assert(['png','jpg','svg'].some(ext=>logo.path===UNIVERSITY_PROFILE_PREFIX+'logos/'+item.id+'-'+logo.sha256.slice(0,16)+'.'+ext))}
 }
 assert(Buffer.byteLength(JSON.stringify(v))<=192*1024);return true
}
export function validateUniversityLogo(bytes,type){
 assert(Buffer.isBuffer(bytes)&&bytes.length>=64&&bytes.length<=524288)
 if(type==='png')assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
 else if(type==='jpg')assert(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)
 else if(type==='svg'){
  const xml=bytes.toString('utf8'),root=xml.replace(/^\s*<\?xml[^?]*\?>/i,'').replace(/^(?:\s*<!--[\s\S]*?-->)*\s*/,'');assert(/^<svg\b/i.test(root));assert(!/<(?:script|foreignObject|iframe)\b|\bon\w+\s*=|<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|@import/i.test(xml));
  for(const match of xml.matchAll(/(?:href|src)\s*=\s*(["'])(.*?)\1/gi))assert(match[2].startsWith('#'),'External SVG resources are not allowed')
  for(const match of xml.matchAll(/url\(\s*["']?([^)'"\s]+)/gi))assert(match[1].startsWith('#'),'External SVG CSS resources are not allowed')
 }else assert.fail('Unsupported logo image type')
 return true
}
