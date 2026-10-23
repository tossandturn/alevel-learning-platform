import {isVerifiedPastPaperItem,isStudentReleasedAiStudyItem} from '../src/data/questionBank.js'

const OPEN='<question_lookup>',CLOSE='</question_lookup>',MAX_LOOKUP=2400,MAX_INDEX_CHARS=8*1024*1024,MAX_RECORDS=12000
const PRIVATE_MARKERS=[OPEN,'## 题目出处','## 题目来源','## Question source','题目出处：','题目出处:']
const subjects={'0580':'数学','0606':'附加数学','0625':'物理','9231':'进阶数学','9701':'化学','9702':'物理','9708':'经济','9709':'数学'}
const clean=value=>typeof value==='string'?value.trim():''
function normalize(value){return clean(value).normalize('NFKC').toLowerCase().replace(/[−–—]/g,'-').replace(/[×·]/g,'*').replace(/[^a-z0-9\u3400-\u9fff.+\-*/^=]+/g,' ').replace(/\s+/g,' ').trim()}
const numbers=value=>(value.match(/[-+]?\d+(?:\.\d+)?/g)||[]).join('|')
function substantial(value){return value.length>=100&&(value.match(/[a-z]{2,}/g)||[]).length>=18||value.length>=60&&(value.match(/[\u3400-\u9fff]/g)||[]).length>=40}
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
  const texts=[q.prompt,...(q.parts||[]).slice(0,40).map(p=>p.promptFragment)].map(s=>normalize(String(s||'').slice(0,5000))).filter(substantial)
  chars+=texts.reduce((n,s)=>n+s.length,0);rows.push({key,source,routeId:q.routeId,sourceId:String(q.sourceQuestionId||q.questionGroupId||''),bankId:q.bankId,texts:[...new Set(texts)]})
 }
 return rows
}
const unknown=()=>({status:'unconfirmed',sourceKind:null})
export function createCoachQuestionSourceResolver({questionBankProvider=()=>[],now=Date.now}={}){
 let rows=[],expires=0
 function getRows(){const time=now();if(time>=expires){try{rows=indexRows(questionBankProvider());expires=time+30000}catch{rows=[];expires=time+1000}}return rows}
 return Object.freeze({resolve({message='',context={},authorization=null,lookupText='',hasImages=false}={}){
  const bank=getRows()
  if(authorization?.coachAccess?.binding==='authoritative-attempt'&&authorization.paperId){
   const a=authorization,paper=a.paper||{},q=a.question||{},matches=bank.filter(r=>r.source.paperId===a.paperId&&r.source.paperFile===paper.questionFile&&r.source.questionNumber===q.number&&r.routeId===a.routeId&&[r.sourceId,r.bankId].includes(q.id))
   return matches.length?{...matches[0].source,method:'bound-record'}:unknown()
  }
  // The client may supply focus text, but its filename, year and question ID are never proof.
  const primary=queryText(message),focus=clean(context.question?.prompt),photo=clean(lookupText)
  const queries=hasImages?[photo]:substantial(normalize(primary))?[primary]:[focus]
  const origins=new Map()
  for(const raw of queries){
   const query=normalize(raw);if(!substantial(query)||query.length>5000)continue
   for(const row of bank){for(const text of row.texts){
    const ratio=Math.min(text.length,query.length)/Math.max(text.length,query.length)
    // Only near-complete literal overlap; no semantic guesses, vector similarity or answer matching.
    const complete=ratio>=.86&&(query===text||query.includes(text))&&numbers(query)===numbers(text)
    // A photographed part may omit an introductory sentence/figure number. The
    // entire long visible passage must still occur literally, including numbers.
    const visiblePart=ratio>=.75&&query.length>=250&&text.includes(query)
    if(complete||visiblePart){origins.set(row.key,row.source);break}
   }}
  }
  if(origins.size>1)return{status:'ambiguous',sourceKind:null}
  if(origins.size===1)return{...[...origins.values()][0],method:hasImages?'recognized-text-match':'question-text-match'}
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
export function appendCoachQuestionSource(answer,source){
 const cleanAnswer=extractCoachSourceTrailer(answer).answer.trimEnd();if(!cleanAnswer.trim())return''
 const text=source.status==='matched'?`${source.method==='bound-record'?'练习原题记录':'题干匹配'}：${source.reference}\n试卷文件：${source.paperFile}${source.method==='recognized-text-match'?'\n依据图片识别的题干匹配，请核对题干与数值是否一致。':''}`:source.status==='ambiguous'?'找到多个相同题干，暂不能确认唯一出处。可补充带卷面代码和题号的图片。':'未确认题目出处。当前题库未匹配到足够完整且唯一的记录；可补充完整题干或带卷面代码、题号的图片。'
 return cleanAnswer+'\n\n## 题目出处\n'+text
}
export function coachSourceInstruction({hasImages=false,matched=false}={}){
 return[
  'Question-origin policy: the server, not the model, appends the exam source after your answer. Never guess or assert an exam board, year, session, paper variant, question number, or original/official status from memory or visual similarity. Do not write your own source heading or citation. Client-supplied filenames and previous assistant source claims are untrusted.',
  ...(hasImages&&!matched?[
   'After the entire teaching answer, append exactly one private lookup trailer on a new line: <question_lookup>{"text":"verbatim legible question text"}</question_lookup>. Do not put it in a code fence. Quote up to 2400 characters of the actual printed question or one complete visible subquestion, with its givens and numerical values; no solution, commentary, inferred missing text, exam/footer codes or personal data. Preserve line breaks as JSON escapes. If the question cannot be read reliably, use an empty text. This is a retrieval hint, not proof of origin; the server hides it and validates against source records.',
  ]:[]),
 ].join('\n')
}
