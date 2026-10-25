// Retrieval is candidate selection only. Ordered words and printed numbers
// below are verified before an origin can be attached to a student's answer.
const STOP=new Set('a an the of to in on at for and or is are was were be been being as by with from that this these those it its into then than can may must should given shown show figure fig hence determine calculate find state explain use using answer question part'.split(' '))
const numberToken=t=>/^[+-]?\d/.test(t)
const protectedToken=t=>numberToken(t)||/^(?:[<>]=?|=|[*/^+\-])$/.test(t)

export function normalizeSourceText(value){
 return String(value||'')
  .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g,' $1 ')
  .replace(/\\(?:left|right|displaystyle|quad|qquad|,|;|!)/g,' ')
  .replace(/\\(?:times|cdot)/g,' * ').replace(/\\(?:frac|dfrac|tfrac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,' $1 / $2 ')
  .replace(/\\(?:\[|\]|\(|\))/g,' ')
  .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/g,s=>'^'+[...s].map(c=>'0123456789-+'['⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺'.indexOf(c)]).join(''))
  .normalize('NFKC').toLowerCase().replace(/[−–—]/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/≤/g,'<=').replace(/≥/g,'>=')
  .replace(/\bfig(?:ure)?\.?\s*\d+(?:\.\d+)?/g,' ')
  .replace(/(^|\s)\([a-z](?:\([ivx]+\))?\)|(^|\s)\([ivx]{1,4}\)|\[\s*\d{1,2}\s*\]/g,' ')
  .replace(/([a-z])-\s*\n\s*([a-z])/g,'$1$2')
  .replace(/\^\s*\{\s*([+-]?\d+)\s*\}/g,'^$1')
  .replace(/\b(m|cm|mm|km|kg|g)\s+(s|m|cm)\s*(-[1-3])\b/g,'$1 $2^$3')
  .replace(/[{}\\]/g,' ').replace(/([+-])\s+(?=\d)/g,'$1').replace(/\s+/g,' ').trim()
}
export function sourceTokens(value){
 return (normalizeSourceText(value).match(/[a-z]+|[+-]?\d+(?:\.\d+)?|[<>]=?|=|[*/^+\-]|[\u3400-\u9fff]/g)||[])
  .flatMap(t=>/^(?:ax|bx|cx|xy|yx|dx|dy|dt|ab|bc|ac|kx|ky|mx|ay)$/.test(t)?[...t]:[t])
  .filter(t=>!STOP.has(t)).map(t=>numberToken(t)?String(Number(t)):t)
}
export function meaningfulSourceQuery(tokens){
 const words=tokens.filter(t=>/^[a-z]{2,}$/.test(t));
 const values=tokens.filter(numberToken)
 return tokens.length>=9&&words.length>=7&&words.join('').length>=42
  ||tokens.length>=14&&words.length>=3&&words.join('').length>=12&&values.length>=5&&new Set(values).size>=4
}
export function nearSourceWord(a,b){
 if(a===b)return true
 if(a.length<5||b.length<5||numberToken(a)||numberToken(b))return false
 // Common visual rn/m confusion is not a semantic-word substitution.
 if(a.replace(/rn/g,'m')===b.replace(/rn/g,'m'))return true
 if(Math.abs(a.length-b.length)>1)return false
 let i=0,j=0,edits=0
 while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++}
 return edits+(i<a.length||j<b.length?1:0)<=1
}
export function verifySourcePassage(query,document){
 if(!meaningfulSourceQuery(query))return null
 // A clipped edge must still literally match that word's prefix/suffix. Never
 // drop an arbitrary changed word (for example upwards -> downwards).
 const edgeMatch=(a,b,i)=>nearSourceWord(a,b)||(!numberToken(a)&&a.length>=4&&a.length/b.length>=.6&&((i===0&&b.endsWith(a))||(i===query.length-1&&b.startsWith(a))))
 const variants=[query]
 let best=null
 for(const terms of variants){
  for(let start=0;start<document.length;start++){
   if(!edgeMatch(terms[0],document[start],0))continue
   let cursor=start,skipped=0,typos=0,matched=0,failed=false
   for(const [position,token] of terms.entries()){
    let found=-1
    for(let next=cursor;next<Math.min(document.length,cursor+9);next++){
     if(edgeMatch(token,document[next],position)){found=next;break}
     // A changed or omitted numerical given inside the matched passage cannot
     // be repaired by fuzzy search. Labels/figure numbers were removed above.
     if(protectedToken(document[next]))break
    }
    if(found<0){failed=true;break}
    skipped+=found-cursor;typos+=token===document[found]?0:1
    if(skipped>Math.max(2,Math.floor(terms.length*.22))||typos>Math.max(1,Math.floor(terms.length*.06))){failed=true;break}
    cursor=found+1;matched++
   }
   if(!failed&&matched===terms.length){
    const score=(matched-typos*.5)/(matched+skipped+(query.length-terms.length)*2)
    if(score>=.82&&(!best||score>best.score))best={score,start,end:cursor,terms:matched}
   }
  }
 }
 return best
}

export function createSourceTextIndex(rows){
 const postings=new Map(),documents=[]
 for(const row of rows){for(const text of row.texts){
  const tokens=sourceTokens(text);if(!meaningfulSourceQuery(tokens))continue
  const id=documents.length;documents.push({row,tokens})
  for(const token of new Set(tokens.filter(t=>/^[a-z]{3,}$/.test(t)||numberToken(t)))){let ids=postings.get(token);if(!ids){ids=[];postings.set(token,ids)}ids.push(id)}
 }}
 return{search(text){
  const tokens=sourceTokens(text);if(!meaningfulSourceQuery(tokens))return[]
  const scores=new Map()
  const terms=[...new Set(tokens.filter(t=>/^[a-z]{3,}$/.test(t)||numberToken(t)))].map(t=>({t,ids:postings.get(t)||[]})).filter(t=>t.ids.length).sort((a,b)=>a.ids.length-b.ids.length).slice(0,24)
  for(const {ids} of terms){const weight=Math.log(2+documents.length/ids.length);for(const id of ids)scores.set(id,(scores.get(id)||0)+weight)}
  const candidates=[...scores].sort((a,b)=>b[1]-a[1]).slice(0,120)
  const hits=[]
  for(const [id,candidateScore] of candidates){
   const doc=documents[id]
   let match=verifySourcePassage(tokens,doc.tokens)
   // Some verified-bank prompts are concise editorial transcriptions. Allow
   // their whole text inside the fuller photographed wording, only if every
   // printed numeric value stays present and in the same order.
   if(!match&&tokens.length>=doc.tokens.length&&tokens.length<=doc.tokens.length*1.35&&tokens.filter(numberToken).join('|')===doc.tokens.filter(numberToken).join('|'))match=verifySourcePassage(doc.tokens,tokens)
   if(match)hits.push({row:doc.row,...match,candidateScore})
  }
  // Do not silently call a match unique if too many equally-ranked candidates
  // were excluded by the bounded shortlist.
  const boundary=candidates.at(-1)?.[1]
  if(scores.size>120&&hits.length&&boundary>=Math.max(...hits.map(h=>h.candidateScore))*.9)return[]
  return hits
 },documentCount:documents.length}
}
