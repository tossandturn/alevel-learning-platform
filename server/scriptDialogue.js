// Both the provider adapter and the authoritative store validate this contract.
export function normalizeScriptDialogue(input,{actor='dm',name='',target='public',evidence=[]}={}){
 if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!['text','segments','attitude','shareClueId'].includes(k)))return null
 if(input.attitude!==undefined&&!['谨慎','信任','怀疑','尚在了解'].includes(input.attitude))return null
 if(input.shareClueId&&(target!=='public'||!evidence.some(c=>c.id===input.shareClueId&&c.roleId===actor)))return null
 if(input.text!==undefined&&input.segments!==undefined)return null
 let parts
 if(input.segments!==undefined){
  if(!Array.isArray(input.segments)||!input.segments.length||input.segments.length>6)return null
  if(input.segments.some(p=>!p||Object.keys(p).some(k=>!['kind','text'].includes(k))||!['narration','speech'].includes(p.kind)||actor==='dm'&&p.kind!=='narration'))return null
  parts=input.segments.map(p=>({kind:p.kind,text:p.text}))
 }else if(typeof input.text==='string'){
  if(/【(?:我|用户|玩家|user|player)】/i.test(input.text))return null
  const matches=[...input.text.matchAll(/【([^】]{1,30})】/g)]
  if(matches.length){
   if(input.text.slice(0,matches[0].index).trim())return null
   parts=matches.map((m,i)=>({kind:['旁白','主持人'].includes(m[1])?'narration':m[1]===name&&actor!=='dm'?'speech':'invalid',text:input.text.slice(m.index+m[0].length,matches[i+1]?.index??input.text.length).trim()}))
   if(parts.some(p=>p.kind==='invalid'))return null
  }else parts=[{kind:actor==='dm'?'narration':'speech',text:input.text}]
 }else return null
 if(parts.some(p=>typeof p.text!=='string'||!p.text.trim()||p.text.length>2000||/【(?:我|用户|玩家|user|player)】/i.test(p.text)))return null
 parts=parts.map(p=>({...p,text:p.text.trim()}))
 const text=parts.map(p=>parts.length===1?p.text:`【${p.kind==='narration'?'旁白':name||'角色'}】\n${p.text}`).join('\n\n')
 if(text.length>2000)return null
 return {text,parts,...(input.attitude?{attitude:input.attitude}:{}),...(input.shareClueId?{shareClueId:input.shareClueId}:{})}
}
