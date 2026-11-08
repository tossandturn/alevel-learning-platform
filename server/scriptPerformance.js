import {personalDialogueBeat} from './roleVoices.js'
import {directorNextStep,isIdentityGuide} from './scriptDirector.js'

// Presentation projection only. Do not edit the full player book, snapshots,
// facts, evidence visibility, or the case-specific cover-story projection.
const PLAYER_GUIDANCE=new Set(['你可以从这里开始','怎样成为苏棠','今晚怎样开口'])
export function scriptPerformanceContext(context){
 if(!context?.actor||context.actor.id==='dm')return context
 const biography=String(context.actor.biography||'').split(/(?=【[^】]+】\n)/u).filter(section=>!PLAYER_GUIDANCE.has(section.match(/^【([^】]+)】/u)?.[1])).join('')
 const {actorDecision,...rest}=context
 return {...rest,...(!personalDialogueBeat(context.trigger)&&actorDecision!==undefined?{actorDecision}:{}),actor:{...context.actor,biography}}
}

export function isScriptProgressRequest(value){
 const trigger=String(value||'')
 if(isIdentityGuide(trigger))return true
 if(/感情|关系|恋爱|相处|约会/.test(trigger)&&!/下一幕|换幕|任务|投票|搜证|继续玩/.test(trigger))return false
 if(/记得|记住|忘记|约定|回忆/.test(trigger)&&!/(?:怎么|如何|怎样).{0,6}(?:操作|进入|推进|过幕)/.test(trigger))return false
 if(/解题|谜题|这道题|密码|提示/.test(trigger)&&!/按钮|点击|操作|本幕任务|怎么进入/.test(trigger))return false
 return /(?:怎么|如何|怎样).{0,6}(?:推进|继续|进入|过幕|完成|玩|投票|换幕)|下一步(?:呢|[？?]|该|做|是)|(?:接下来|现在).{0,6}(?:做什么|干什么|怎么办)|(?:要|需要|是不是|是否|可以).{0,5}举手|^\s*(?:举手|下一步|(?:进入|继续到)?下一幕)[。？?！!\s]*$/.test(trigger)
}
export function scriptProgressGuidance(context){
 if(context?.actor?.id!=='dm'||!context.progress||!isScriptProgressRequest(context.trigger))return null
 const p=context.progress
 if(isIdentityGuide(context.trigger))return{segments:[{kind:'narration',text:'右上角“本局”→“我的身份”→“人物与目标”，可以读完整人物故事。\n“我的秘密”和“本幕决定”也在这里，只有你自己能看。'}]}
 return{segments:[{kind:'narration',text:(context.phase==='vote'?'':`本幕材料：${p.shared}/${p.total} 份已公开。\n`)+directorNextStep(p,context.phase).text}]}
}
