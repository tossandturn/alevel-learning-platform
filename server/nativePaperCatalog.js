import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {courseRoutes} from '../src/data/routeRegistry.js'
import {getExamPaperProfile} from '../src/data/examStructure.js'

const SUBJECTS=new Set(courseRoutes.map(route=>route.subjectCode))
const STAGES=new Set(['all','igcse','as','a2','competition','admissions'])
const text=(value,max=260)=>typeof value==='string'?value.slice(0,max):''
const fail=(statusCode,code,message)=>{throw Object.assign(new Error(message),{statusCode,code})}
const stageOf=route=>String(route.stage).toLowerCase()
const ACADEMIC_SUBJECTS=new Set(courseRoutes.filter(r=>['AS','A2','IGCSE'].includes(r.stage)).map(r=>r.subjectCode))
const SEASON_LABELS={spring:'春季（2–3月）',summer:'夏季（5–6月）',winter:'秋冬季（10–11月）',unspecified:'未注明场次'}
const COMPONENT_FILTER_VERSION='native-paper-components-v1'
const safeSeasonKey=value=>/^[a-z0-9][a-z0-9_-]{0,39}$/.test(value)?value:'round-'+crypto.createHash('sha256').update(value).digest('hex').slice(0,16)
function seasonOf(item,subject){
 const raw=text(item.season,40).trim(),value=raw.toLowerCase().replace(/[\s/_.-]+/g,'')
 if(ACADEMIC_SUBJECTS.has(subject)){
  const key=/^(?:m|mar|march|feb|february|febmar|februarymarch|spring)$/.test(value)?'spring':/^(?:s|may|jun|june|mayjun|mayjune|summer)$/.test(value)?'summer':/^(?:w|oct|october|nov|november|octnov|octobernovember|winter)$/.test(value)?'winter':!value?({m:'spring',s:'summer',w:'winter'}[String(item.file||'').match(/^\d{4}_([msw])\d{2}_/i)?.[1]?.toLowerCase()]||'unspecified'):safeSeasonKey(value)
  return {seasonKey:key,seasonLabel:SEASON_LABELS[key]||raw}
 }
 // Competition/admissions metadata describes rounds or forms, not seasons.
 return {seasonKey:value?safeSeasonKey(value):'unspecified',seasonLabel:raw||SEASON_LABELS.unspecified}
}
function filters(input){
 const rawYear=String(input.year??'all').trim(),year=['','all'].includes(rawYear)?null:Number(rawYear),season=String(input.season||'all').trim().toLowerCase()
 if(year!==null&&(!/^\d{4}$/.test(rawYear)||year<=1800)||!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(season))fail(400,'invalid_paper_filters','年份或考试季无效。')
 return {year,season}
}
function componentFilter(input){
 if(input.component===undefined||input.component===null)return'all'
 const component=String(input.component).trim().toLowerCase()
 if(component==='all')return component
 if(!/^[1-9]$/.test(component))fail(400,'invalid_paper_component','卷型筛选无效。')
 return component
}
function localUrl(value,subject){
 const url=text(value,500)
 if(!url.startsWith('/local-pdf/'+subject+'/')||/[\\?#]|\.\.|%2e|%2f|%5c/i.test(url)||!url.endsWith('.pdf'))return ''
 return url
}
function projectItem(item,subject){
 const variant=String(item.variant||String(item.file||'').match(/_(?:qp|ms)_([1-9]\d?)\.pdf$/i)?.[1]||'')
 const decoded=/^[1-9]\d?$/.test(variant)?getExamPaperProfile(subject,variant,item.year):null
 const profile=decoded||item.examProfile||{},declared=Array.isArray(profile.courseRouteIds)?profile.courseRouteIds:Array.isArray(profile.routeIds)?profile.routeIds:[]
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
 const codeComponent=String(profile.code||'').match(/^\d{4}\/([1-9])(?:\d)?$/)?.[1]
 const rawPaperComponent=profile.paperNumber===undefined||profile.paperNumber===null?Number(codeComponent):Number(profile.paperNumber)
 const physicalComponent=Number.isInteger(rawPaperComponent)&&rawPaperComponent>=1&&rawPaperComponent<=9?rawPaperComponent:null
 let component=physicalComponent
 if(decoded)component=decoded.courseComponent
 else if(subject==='9709'&&Number(item.year)<=2019){
  const title=String(profile.title||'').toLowerCase().replace(/&/g,'and').replace(/\s+/g,' ').trim()
  const pure=title.match(/^pure mathematics ([123])$/),statistics=title.match(/^probability and statistics ([12])$/)
  component=pure?Number(pure[1]):statistics?Number(statistics[1])+4:/^mechanics(?: 1)?$/.test(title)?4:null
 }
 const matched=known.filter(route=>singleExam||Boolean(component)&&route.paperComponents.includes(component)&&(declared.includes(route.routeId)||Boolean(decoded)))
 const routeIds=matched.map(route=>route.routeId),mappedStages=matched.length?[...new Set(matched.map(stageOf))]:[...new Set(stages)]
 return {id:text(item.id,200),subject,year:Number.isInteger(Number(item.year))&&Number(item.year)>1800?Number(item.year):null,season:text(item.season,40),...seasonOf(item,subject),kind:text(item.kind,10),file:text(item.file),pairKey:text(item.pairKey,200),markSchemeId:text(item.markSchemeId,200),
  paperNumber:text(profile.code,40),title:text(profile.title,160),mode:text(profile.mode,40),durationMinutes:Number(profile.durationMinutes)>0?Number(profile.durationMinutes):null,maxMarks:Number(profile.maxMarks)>0?Number(profile.maxMarks):null,questionCount:null,
  stages:mappedStages,routeIds,paperComponent:physicalComponent,courseComponent:component,localUrl:localUrl(item.localUrl,subject)}
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
   const result={signature,version:crypto.createHash('sha256').update('native-paper-projection-v4-components|').update(source).digest('hex').slice(0,24),items,byId:new Map(items.map(item=>[item.id,item]))}
   cache.delete(subject);cache.set(subject,result);while(cache.size>3)cache.delete(cache.keys().next().value)
   return result
  }).finally(()=>pending.delete(key))
  pending.set(key,work);return work
 }
 return {
  async list(input={}){
   const selected=scope(input),filter=filters(input),component=componentFilter(input),pageSize=Number(input.pageSize??30),requestedPage=Number(input.page??1),query=String(input.query||'').trim().toLowerCase()
   if(!Number.isInteger(pageSize)||pageSize<1||pageSize>30||!Number.isInteger(requestedPage)||requestedPage<1||requestedPage>10000||query.length>120)fail(400,'invalid_paper_page','分页或搜索条件无效。')
   const catalog=await read(selected.subject)
   const scoped=catalog.items.filter(item=>(selected.stage==='all'||item.stages.includes(selected.stage))&&(!selected.routeId||item.routeIds.includes(selected.routeId)))
   const order=['spring','summer','winter','unspecified'],seasons=[...new Map(scoped.map(item=>[item.seasonKey,{value:item.seasonKey,label:item.seasonLabel}])).values()].sort((a,b)=>{
    const left=order.includes(a.value)?order.indexOf(a.value):10,right=order.includes(b.value)?order.indexOf(b.value):10
    return left-right||a.label.localeCompare(b.label)
   })
   const componentScope=scoped.filter(item=>(filter.year===null||item.year===filter.year)&&(filter.season==='all'||item.seasonKey===filter.season)&&(!query||(item.file+' '+item.title+' '+item.year+' '+item.season+' '+item.seasonLabel).toLowerCase().includes(query)))
   const paperComponents=[...new Set(componentScope.map(item=>item.paperComponent).filter(value=>Number.isInteger(value)&&value>0))].sort((a,b)=>a-b).map(value=>({value:String(value),label:'P'+value}))
   const facets={years:[...new Set(scoped.map(item=>item.year).filter(Boolean))].sort((a,b)=>b-a),seasons,paperComponents}
   const matched=componentScope.filter(item=>component==='all'||String(item.paperComponent)===component)
   const total=matched.length,pageCount=Math.ceil(total/pageSize),page=Math.min(requestedPage,Math.max(1,pageCount))
   return {schemaVersion:'native-paper-catalog-v1',filterVersion:'native-paper-filters-v1',componentFilterVersion:COMPONENT_FILTER_VERSION,...selected,...filter,component,facets,query,page,pageSize,total,pageCount,subjectTotal:catalog.items.length,pairedTotal:matched.filter(item=>item.markScheme).length,version:catalog.version,items:matched.slice((page-1)*pageSize,page*pageSize)}
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
