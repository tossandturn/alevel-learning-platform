// Rendering capability is not student consent. No provider calls or persistent state.
export const COACH_DIAGRAM_QUESTIONS=Object.freeze([
  '需要我补一张受力图说明吗？',
  'Would you like me to add a free-body diagram?',
])
const INTENTS=new Set(['ask','draw','decline'])
const refusal=/(?:不要|不需要|暂时不用|先不|别|无需).{0,10}(?:画|绘|图)|(?:只用|只讲|只要|只给).{0,6}(?:文字|文本)|\b(?:do not|don't|dont)\s+(?:draw|sketch|plot)(?:[.!?\s]|$)|\b(?:do not|don't|dont|without|no)\s+(?:(?:draw|sketch|show|add|generate)\s+)?(?:(?:me|a|the|any|force|free[- ]body)\s+)*(?:diagram|drawing|graph|illustration)\b/iu
const deliberation=/是否(?:需要|要)|要不要|有必要.{0,8}(?:画|图)|需要.{0,12}(?:画|图).{0,4}[吗么？?]|\b(?:should (?:we|i)|(?:do|does) (?:we|i|it) need to|whether to|what does|what is|why (?:do|should))\b/iu
const direct=/(?:画|绘制|补|展示).{0,14}(?:受力图|示意图|光路图|电路图|函数图|几何图)|^(?:画图|绘图|画吧)[。！!\s]*$|(?:请|帮我|给我|直接|现在).{0,8}(?:画图|绘图)|\b(?:draw|sketch|plot|illustrate|add|show)\b[^.!?\n]{0,50}\b(?:free[\s-]*body(?:\s+diagram)?|force\s+diagram|fbd|ray\s+diagram|circuit\s+diagram|graph|diagram)\b/iu
function studentText(value){
  if(typeof value!=='string')return ''
  return value.slice(0,3000)
    .replace(/```[\s\S]*?```|`[^`]*`/g,' ')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|(?<!\w)'[^'\n]+'(?!\w)/gu,' ')
    .replace(/^\s*>.*$/gm,' ')
    .replace(/(?:^|\n)\s*(?:题干|原题|题目|question|problem|source)\s*[:：][^\n]*/giu,' ')
    .trim()
}
function lastAssistant(history){
  if(!Array.isArray(history))return ''
  const last=history.at(-1)
  return last?.role==='assistant'&&typeof last.content==='string'?last.content:''
}
export function resolveCoachDiagramIntent(payload={},feature=null){
  const supplied=Object.hasOwn(payload,'diagramIntent'),intent=supplied?payload.diagramIntent:'ask'
  if(!INTENTS.has(intent)||supplied&&feature?.feature==='tavern')throw Object.assign(new Error('Unsupported academic diagram intent.'),{statusCode:400,code:'coach_diagram_intent_invalid'})
  const supported=payload.diagramFormat==='stem-diagram-v1'&&feature?.feature!=='tavern',message=studentText(payload.message),previous=lastAssistant(payload.history)
  const previousOffer=COACH_DIAGRAM_QUESTIONS.some(q=>previous.trim().endsWith(q))
  const confirmation=previousOffer&&/^(?:需要|要|好的|可以|画吧|好|yes|yes please|please do|draw it)[。！!\s]*$/iu.test(message)
  const requested=!deliberation.test(message)&&direct.test(message)||confirmation
  const mode=refusal.test(message)?'decline':requested?'draw':intent
  return Object.freeze({mode,academic:feature?.feature!=='tavern',draw:supported&&mode==='draw',mayOffer:supported&&mode==='ask',supplement:supported&&mode==='draw'&&Boolean(previous)})
}
export function coachDiagramOffer(answer,policy){
  if(!policy?.mayOffer||typeof answer!=='string')return undefined
  const last=answer.trim().split(/\r?\n/).at(-1)?.trim()
  return COACH_DIAGRAM_QUESTIONS.includes(last)?{type:'force',question:last}:undefined
}
export function coachDiagramConsentPrompt(policy={}){
  if(policy.draw)return [
    'The student explicitly requested a diagram. Draw only the requested relevant diagram, at the same permitted help depth as the text. Do not ask for drawing consent again.',
    policy.supplement?'This is a diagram supplement to an existing answer. Keep the earlier answer intact: add the diagram and only the short explanation needed to read it, not another complete solution or repeated derivation.':'Follow the original requested solution or hint depth; include the explicitly requested diagram where it helps.',
  ].join('\n')
  return [
    'Text first: answer the current question without generating any diagram, image, diagram recipe, coordinates or drawing code. Do not wait for or describe a background drawing job. A picture in the input is evidence to read, not consent to generate an output diagram.',
    policy.mayOffer?'During this SAME answer, judge whether a free-body diagram would materially clarify the permitted explanation. Only if useful, append one separate final plain-text paragraph: 需要我补一张受力图说明吗？ For an English answer use exactly: Would you like me to add a free-body diagram? Do not offer one for every question, bare arithmetic or unrelated subjects. The invitation is optional and must not replace the actual answer or reveal more than the permitted hint. Do not generate it before the student confirms.':'Do not invite the student to draw or ask whether to generate a diagram in this response. Respect the current refusal or the client without a diagram renderer; explain in words.',
  ].join('\n')
}
// Only suppress a standalone canonical invitation, not quotes or discussion of it.
// Ordinary text streams immediately; at most a possible invitation prefix is held.
export function createCoachDiagramOfferStream({allowOffer=true}={}){
  let pending='',lineStart=true
  return {
    push(value){
      const chunk=String(value||'');if(allowOffer)return chunk
      pending+=chunk;let out='',position=0
      while(position<pending.length){
        if(lineStart){
          const rest=pending.slice(position),spaces=rest.match(/^[ \t]{0,128}/u)[0],text=rest.slice(spaces.length)
          const complete=COACH_DIAGRAM_QUESTIONS.find(q=>text.startsWith(q))
          if(complete){
            const after=text.slice(complete.length)
            if(/^[ \t\r]*$/u.test(after))break
            if(/^[ \t]*\r?\n/u.test(after)){position+=spaces.length+complete.length;continue}
          }
          if((!text&&spaces.length<128)||COACH_DIAGRAM_QUESTIONS.some(q=>q.startsWith(text)))break
        }
        const char=pending[position++];out+=char;lineStart=char==='\n'
      }
      pending=pending.slice(position);return out
    },
    finish(){const text=COACH_DIAGRAM_QUESTIONS.includes(pending.trim())?'':pending;pending='';lineStart=true;return text},
  }
}
export function sanitizeCoachDiagramOffer(answer,policy){
  const stream=createCoachDiagramOfferStream({allowOffer:Boolean(policy?.mayOffer)||policy?.academic===false})
  return stream.push(answer)+stream.finish()
}
