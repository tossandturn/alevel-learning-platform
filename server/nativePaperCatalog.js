import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {courseRoutes} from '../src/data/routeRegistry.js'

const SUBJECTS=new Set(courseRoutes.map(route=>route.subjectCode))
const STAGES=new Set(['all','igcse','as','a2','competition','admissions'])
const text=(value,max=260)=>typeof value==='string'?value.slice(0,max):''
const fail=(statusCode,code,message)=>{throw Object.assign(new Error(message),{statusCode,code})}
const stageOf=route=>String(route.stage).toLowerCase()
function localUrl(value,subject){
 const url=text(value,500)
 if(!url.startsWith('/local-pdf/'+subject+'/')||/[\\?#]|\.\.|%2e|%2f|%5c/i.test(url)||!url.endsWith('.pdf'))return ''
 return url
}
function projectItem(item,subject){
 const profile=item.examProfile||{},declared=Array.isArray(profile.courseRouteIds)?profile.courseRouteIds:Array.isArray(profile.routeIds)?profile.routeIds:[]
 const raw=(Array.isArray(profile.stages)?profile.stages:[]).map(s=>String(s).toLowerCase())
 const known=courseRoutes.filter(route=>route.subjectCode===subject)
 const stages=[...new Set(raw.filter(stage=>STAGES.has(stage)&&stage!=='all'))]
 if(known.every(route=>route.stage==='IGCSE')&&raw.some(s=>['core','extended','igcse'].includes(s)))stages.push('igcse')
 if(['bpho','amc12'].includes(subject)&&raw.length)stages.push('competition')
 if(['esat','tmua'].includes(subject)&&raw.length)stages.push('admissions')
 // Competition source profiles use round/module routes, whereas the product
 // exposes one canonical route per exam. That explicit one-to-one mapping is
 // safe; academic combinations must still match declared courseRouteIds.
 const singleExam=['bpho','amc12','esat','tmua'].includes(subject)&&known.length===1
 const routeIds=known.filter(route=>stages.includes(stageOf(route))&&(declared.includes(route.routeId)||singleExam)).map(route=>route.routeId)
 return {id:text(item.id,200),subject,year:Number.isInteger(Number(item.year))&&Number(item.year)>1800?Number(item.year):null,season:text(item.season,40),kind:text(item.kind,10),file:text(item.file),pairKey:text(item.pairKey,200),markSchemeId:text(item.markSchemeId,200),
  paperNumber:text(profile.code,40),title:text(profile.title,160),mode:text(profile.mode,40),durationMinutes:Number(profile.durationMinutes)>0?Number(profile.durationMinutes):null,maxMarks:Number(profile.maxMarks)>0?Number(profile.maxMarks):null,questionCount:null,
  stages:[...new Set(stages)],routeIds,localUrl:localUrl(item.localUrl,subject)}
}
function scope(input){
 const subject=String(input.subject||'').toLowerCase(),stage=String(input.stage||'all').toLowerCase(),routeId=String(input.routeId||'')
 if(!SUBJECTS.has(subject)||!STAGES.has(stage))fail(400,'invalid_paper_scope','试卷范围无效。')
 if(routeId){const route=courseRoutes.find(r=>r.routeId===routeId);if(!route||route.subjectCode!==subject||stage!=='all'&&stageOf(route)!==stage)fail(409,'paper_route_mismatch','课程与阶段不匹配。')}
 return {subject,stage,routeId}
}

// A read-only projection of the existing catalog, not another bank. Large
// provenance/source records never enter the response or the retained cache.
export function createNativePaperCatalog({directory=fileURLToPath(new URL('../public/data/papers/',import.meta.url))}={}){
 const cache=new Map(),pending=new Map()
 async function read(subject){
  const file=path.join(directory,subject+'.json')
  let stat
  try{stat=await fs.stat(file)}catch{fail(404,'paper_catalog_unavailable','真题目录暂未提供。')}
  if(!stat.isFile()||stat.size>12*1024*1024)fail(503,'paper_catalog_invalid','真题目录暂时不可用。')
  const signature=stat.mtimeMs+':'+stat.size,cached=cache.get(subject)
  if(cached?.signature===signature){cache.delete(subject);cache.set(subject,cached);return cached}
  const key=subject+':'+signature
  if(pending.has(key))return pending.get(key)
  const work=fs.readFile(file,'utf8').then(source=>{
   let payload
   try{payload=JSON.parse(source)}catch{fail(503,'paper_catalog_invalid','真题目录暂时不可用。')}
   if(payload?.schemaVersion!==2||!Array.isArray(payload.items)||payload.items.length>20000)fail(503,'paper_catalog_invalid','真题目录暂时不可用。')
   const records=payload.items.filter(item=>item.subject===subject&&item.governance?.state==='active'&&item.id&&item.file).map(item=>projectItem(item,subject))
   const byId=new Map(records.map(item=>[item.id,item]))
   const items=records.filter(item=>item.kind==='qp').map(item=>{
    const ms=byId.get(item.markSchemeId)
    return {...item,markScheme:ms?.kind==='ms'&&item.pairKey&&ms.pairKey===item.pairKey?{id:ms.id,kind:'ms',file:ms.file,localUrl:ms.localUrl}:null}
   }).sort((a,b)=>(b.year||0)-(a.year||0)||b.file.localeCompare(a.file)||a.id.localeCompare(b.id))
   const result={signature,version:crypto.createHash('sha256').update(source).digest('hex').slice(0,24),items,byId:new Map(items.map(item=>[item.id,item]))}
   cache.delete(subject);cache.set(subject,result);while(cache.size>3)cache.delete(cache.keys().next().value)
   return result
  }).finally(()=>pending.delete(key))
  pending.set(key,work);return work
 }
 return {
  async list(input={}){
   const selected=scope(input),pageSize=Number(input.pageSize??30),requestedPage=Number(input.page??1),query=String(input.query||'').trim().toLowerCase()
   if(!Number.isInteger(pageSize)||pageSize<1||pageSize>30||!Number.isInteger(requestedPage)||requestedPage<1||requestedPage>10000||query.length>120)fail(400,'invalid_paper_page','分页或搜索条件无效。')
   const catalog=await read(selected.subject)
   const matched=catalog.items.filter(item=>(selected.stage==='all'||item.stages.includes(selected.stage))&&(!selected.routeId||item.routeIds.includes(selected.routeId))&&(!query||(item.file+' '+item.title+' '+item.year+' '+item.season).toLowerCase().includes(query)))
   const total=matched.length,pageCount=Math.ceil(total/pageSize),page=Math.min(requestedPage,Math.max(1,pageCount))
   return {schemaVersion:'native-paper-catalog-v1',...selected,query,page,pageSize,total,pageCount,subjectTotal:catalog.items.length,pairedTotal:matched.filter(item=>item.markScheme).length,version:catalog.version,items:matched.slice((page-1)*pageSize,page*pageSize)}
  },
  async detail(input={}){
   const selected=scope(input),id=String(input.id||'')
   if(!/^[A-Za-z0-9_-]{1,200}$/.test(id))fail(400,'invalid_paper_id','试卷标识无效。')
   const catalog=await read(selected.subject),paper=catalog.byId.get(id)
   if(!paper)fail(404,'paper_not_found','没有找到这份试卷。')
   return {schemaVersion:'native-paper-detail-v1',subject:selected.subject,version:catalog.version,paper}
  },
 }
}
