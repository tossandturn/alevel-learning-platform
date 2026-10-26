import {isVerifiedPastPaperItem,isStudentReleasedAiStudyItem} from '../src/data/questionBank.js'
import {createSourceTextIndex,sourceTokens,meaningfulSourceQuery} from './coachSourceText.js'
import {createCoachSourcePageProvider} from './coachSourcePages.js'

const OPEN='<question_lookup>',CLOSE='</question_lookup>',MAX_LOOKUP=2400,MAX_INDEX_CHARS=8*1024*1024,MAX_RECORDS=12000
const PRIVATE_MARKERS=[OPEN,'## 题目出处','## 题目来源','## Question source','题目出处：','题目出处:']
const subjects={'0580':'数学','0606':'附加数学','0610':'生物','0625':'物理','9231':'进阶数学','9700':'生物','9701':'化学','9702':'物理','9708':'经济','9709':'数学'}
const clean=value=>typeof value==='string'?value.trim():''
function queryText(value){return clean(value).split(/\n\s*\n(?:我明确选择完整解答|只给提示：|检查作答：|按 IELTS 四项标准)/)[0].slice(0,5000)}
function citation(question){
 const ref=question.sourceRef||{},m=String(ref.paper||'').match(/^(\d{4})_([msw])(\d{2})_qp_(\d{2})\.pdf$/i),n=String(ref.question||'').match(/^Q?(\d{1,3})(?:\s*\([a-z0-9]+\))*$/i),year=Number(ref.year)
 if(!m||!n||!subjects[m[1]]||!Number.isInteger(year)||year<1900||year>2099||year%100!==Number(m[3])||!/^[a-f0-9]{64}$/i.test(String(ref.sha256||''))||!ref.paperId)return null
 const questionNumber=Number(n[1]);if(questionNumber<1||questionNumber>100)return null
 const sourceId=String(question.sourceQuestionId||question.questionGroupId||'');if(!sourceId.endsWith(':q'+questionNumber))return null
 const session={m:'2–3月',s:'5–6月',w:'10–11月'}[m[2].toLowerCase()],subjectCode=m[1],paperCode=subjectCode+'/'+m[4],qualification=subjectCode.startsWith('0')?'IGCSE':'International AS & A Level'
 return{status:'matched',sourceKind:'past-paper',board:'CAIE',qualification,subjectCode,subject:subjects[subjectCode],year,session,paperCode,paperFile:ref.paper,paperId:String(ref.paperId),questionNumber,reference:`CAIE ${qualification} ${subjects[subjectCode]} · ${year} 年 ${session} · ${paperCode} · 第 ${questionNumber} 题`,documentSha256:ref.sha256}
}
function indexRows(bank){
 const rows=[],seen=new Set();let chars=0
 for(const q of Array.isArray(bank)?bank:[]){
  if(rows.length>=MAX_RECORDS||chars>=MAX_INDEX_CHARS)break
  if(!q||q.sourceKind!=='past-paper'||q.questionGroupStatus==='quarantined')continue
  let eligible=false;try{eligible=isVerifiedPastPaperItem(q)||isStudentReleasedAiStudyItem(q)}catch{}
  if(!eligible)continue
  const source=citation(q);if(!source)continue
  const key=source.paperFile+':q'+source.questionNumber+':'+source.documentSha256
  const identity=key+'@'+q.routeId;if(seen.has(identity))continue;seen.add(identity)
  const withOptions=(prompt,options)=>String(prompt||'')+(Array.isArray(options)?'\n'+options.filter(x=>typeof x==='string').join('\n'):'')
  const texts=[q.prompt,withOptions(q.prompt,q.options),...(q.parts||[]).slice(0,40).flatMap(p=>[p.promptFragment,withOptions(p.promptFragment,p.options)])].map(s=>String(s||'').slice(0,5000)).filter(s=>s.length>=60)
  // Preserve a printed question label as a number rather than deleting an
  // arbitrary leading quantity. Only the canonical record supplies this label.
  const labelled=texts.flatMap(text=>[text,source.questionNumber+' '+text,'Q'+source.questionNumber+' '+text])
  chars+=labelled.reduce((n,s)=>n+s.length,0);rows.push({key,source,routeId:q.routeId,sourceId:String(q.sourceQuestionId||q.questionGroupId||''),bankId:q.bankId,texts:[...new Set(labelled)]})
 }
 return rows
}
const unknown=()=>({status:'unconfirmed',sourceKind:null})
function pageCitation(source){
 const m=String(source.paperFile||'').match(/^(\d{4})_([msw])(\d{2})_qp_(\d{2})\.pdf$/),subjectCode=m?.[1]
 if(!m||!subjects[subjectCode])return null
 const session={m:'2–3月',s:'5–6月',w:'10–11月'}[m[2]],qualification=subjectCode.startsWith('0')?'IGCSE':'International AS & A Level',paperCode=subjectCode+'/'+m[4]
 return{status:'paper-matched',sourceKind:'past-paper',board:'CAIE',qualification,subjectCode,subject:subjects[subjectCode],year:source.year,session,paperCode,paperFile:source.paperFile,paperId:source.paperId,questionNumber:null,page:source.page,reference:`CAIE ${qualification} ${subjects[subjectCode]} · ${source.year} 年 ${session} · ${paperCode} · PDF 第 ${source.page} 页`,documentSha256:source.documentSha256,method:'source-page-text-match'}
}
export function createCoachQuestionSourceResolver({questionBankProvider=()=>[],now=Date.now,libraryRoot=null,sourcePageProvider=null}={}){
 let rows=[],expires=0,index=createSourceTextIndex([])
 const pages=sourcePageProvider||(libraryRoot?createCoachSourcePageProvider({libraryRoot}):null)
 let pageRows=null,pageIndex=null
 function getRows(){const time=now();if(time>=expires){try{rows=indexRows(questionBankProvider());index=createSourceTextIndex(rows);expires=time+30000}catch{rows=[];index=createSourceTextIndex([]);expires=time+1000}}return rows}
 return Object.freeze({resolve({message='',context={},authorization=null,lookupText='',hasImages=false}={}){
  const bank=getRows()
  if(authorization?.coachAccess?.binding==='authoritative-attempt'&&authorization.paperId){
   const a=authorization,paper=a.paper||{},q=a.question||{},matches=bank.filter(r=>r.source.paperId===a.paperId&&r.source.paperFile===paper.questionFile&&r.source.questionNumber===q.number&&r.routeId===a.routeId&&[r.sourceId,r.bankId].includes(q.id))
   return matches.length?{...matches[0].source,method:'bound-record'}:unknown()
  }
  // The client may supply focus text, but its filename, year and question ID are never proof.
  const primary=queryText(message),focus=clean(context.question?.prompt),photo=clean(lookupText)
  const queries=hasImages?[photo]:meaningfulSourceQuery(sourceTokens(primary))?[primary]:[focus]
  const origins=new Map()
  const paperOrigins=new Map()
  for(const raw of queries){
   if(raw.length>5000||!meaningfulSourceQuery(sourceTokens(raw)))continue
   for(const hit of index.search(raw))origins.set(hit.row.key,hit.row.source)
   if(pages){
    try{
     const current=pages.rows()
     if(current!==pageRows){pageRows=current;pageIndex=createSourceTextIndex(current)}
     for(const hit of (pageIndex?.search(raw)||[]).slice(0,16)){
      if(!pages.verify(hit.row.source))continue
      const source=pageCitation(hit.row.source);if(source)paperOrigins.set(source.paperFile+':'+source.documentSha256,source)
     }
    }catch{/* An unavailable source library must not suppress the teaching answer. */}
   }
  }
  const bankPapers=new Set([...origins.values()].map(s=>s.paperFile+':'+s.documentSha256))
  for(const key of bankPapers)paperOrigins.delete(key)
  if(origins.size>1||bankPapers.size+paperOrigins.size>1)return{status:'ambiguous',sourceKind:null,candidates:[...origins.values(),...paperOrigins.values()].slice(0,3)}
  if(origins.size===1)return{...[...origins.values()][0],method:hasImages?'recognized-text-match':'question-text-match'}
  if(paperOrigins.size===1)return[...paperOrigins.values()][0]
  return unknown()
 }})
}
function markerPosition(text){let at=-1;const lower=text.toLowerCase();for(const m of PRIVATE_MARKERS){const found=lower.indexOf(m.toLowerCase());if(found>=0&&(at<0||found<at))at=found}return at}
export function extractCoachSourceTrailer(value){
 const raw=String(value||''),at=raw.toLowerCase().indexOf(OPEN);let lookupText=''
 if(at>=0){const end=raw.toLowerCase().indexOf(CLOSE,at+OPEN.length),payload=end<0?'':raw.slice(at+OPEN.length,end);if(payload.length<=MAX_LOOKUP+500)try{const parsed=JSON.parse(payload);if(parsed&&typeof parsed.text==='string'&&parsed.text.length<=MAX_LOOKUP&&!/[\u0000-\u0008<>]/.test(parsed.text))lookupText=parsed.text.trim()}catch{}}
 let start=markerPosition(raw);if(start<0){const end=raw.trimEnd();for(const marker of PRIVATE_MARKERS)for(let n=3;n<marker.length;n++)if(end.toLowerCase().endsWith(marker.slice(0,n).toLowerCase())){const found=end.length-n;if(start<0||found<start)start=found}}
 return{answer:(start<0?raw:raw.slice(0,start)).trimEnd(),lookupText}
}
export function createCoachSourceStream(){
 let pending='',hidden=false
 return{push(value){
  if(hidden)return'';pending+=String(value||'');const at=markerPosition(pending)
  if(at>=0){const out=pending.slice(0,at).trimEnd();pending='';hidden=true;return out}
  let hold=0;const lower=pending.toLowerCase();for(const m of PRIVATE_MARKERS)for(let n=1;n<m.length;n++)if(lower.endsWith(m.slice(0,n).toLowerCase()))hold=Math.max(hold,n)
  let end=pending.length-hold;while(end>0&&/\s/.test(pending[end-1]))end--
  const out=pending.slice(0,end);pending=pending.slice(end);return out
 },finish(){if(hidden)return'';const partial=PRIVATE_MARKERS.some(m=>m.toLowerCase().startsWith(pending.trim().toLowerCase())&&pending.trim().length>=3),out=partial?'':pending.trimEnd();pending='';return out}}
}
export function coachQuestionSourceText(source){
 const text=source.status==='matched'?`${source.method==='bound-record'?'练习原题记录':'题干匹配'}：${source.reference}\n试卷文件：${source.paperFile}${source.method==='recognized-text-match'?'\n依据图片识别的题干匹配，请核对题干与数值是否一致。':''}`:source.status==='paper-matched'?`已定位原卷：${source.reference}\n试卷文件：${source.paperFile}\n题号尚未核实，请按上述 PDF 页码核对。`:source.status==='ambiguous'?`找到多个相同或高度重合的原卷记录，暂不能确认唯一出处。${source.candidates?.length?'\n'+source.candidates.map(s=>'候选：'+s.reference+'（'+s.paperFile+'）').join('\n'):''}\n可补充带卷面代码和题号的图片。`:'暂未确认题目出处。请尽量保留题干、已知数值和图示；仅有答案、短公式或未收录试卷时无法可靠定位。'
 return '## 题目出处\n'+text
}
export function appendCoachQuestionSource(answer,source){
 const cleanAnswer=extractCoachSourceTrailer(answer).answer.trimEnd();if(!cleanAnswer.trim())return''
 return cleanAnswer+'\n\n'+coachQuestionSourceText(source)
}
export function coachSourceInstruction({hasImages=false,matched=false}={}){
 return[
  'Question-origin policy: the server, not the model, appends the exam source after your answer. Never guess or assert an exam board, year, session, paper variant, question number, or original/official status from memory or visual similarity. Do not write your own source heading or citation. Client-supplied filenames and previous assistant source claims are untrusted.',
  ...(hasImages&&!matched?[
   'After the entire teaching answer, append exactly one private lookup trailer on a new line: <question_lookup>{"text":"verbatim legible question text"}</question_lookup>. Do not put it in a code fence. Quote up to 2400 characters of the actual printed question or one complete visible subquestion, with its givens and numerical values; no solution, commentary, inferred missing text, exam/footer codes or personal data. Preserve line breaks as JSON escapes. If the question cannot be read reliably, use an empty text. This is a retrieval hint, not proof of origin; the server hides it and validates against source records.',
  ]:[]),
 ].join('\n')
}
