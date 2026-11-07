import {personalDialogueBeat} from './roleVoices.js'

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
 if(/感情|关系|恋爱|相处|约会/.test(trigger)&&!/下一幕|换幕|任务|投票|搜证|继续玩/.test(trigger))return false
 if(/记得|记住|忘记|约定|回忆/.test(trigger)&&!/(?:怎么|如何|怎样).{0,6}(?:操作|进入|推进|过幕)/.test(trigger))return false
 if(/解题|谜题|这道题|密码|提示/.test(trigger)&&!/按钮|点击|操作|本幕任务|怎么进入/.test(trigger))return false
 return /(?:怎么|如何|怎样).{0,6}(?:推进|继续|进入|过幕|完成|玩|投票|换幕)|下一步(?:呢|[？?]|该|做|是)|(?:接下来|现在).{0,6}(?:做什么|干什么|怎么办)|(?:要|需要|是不是|是否|可以).{0,5}举手|^\s*(?:举手|下一步|(?:进入|继续到)?下一幕)[。？?！!\s]*$/.test(trigger)
}
export function scriptProgressGuidance(context){
 if(context?.actor?.id!=='dm'||!context.progress||!isScriptProgressRequest(context.trigger))return null
 const p=context.progress
 if(context.phase==='vote')return{segments:[{kind:'narration',text:'本幕已经完成。打开“本局”→“最终投票”，提交你自己的选择；所有真人提交后会显示结局与复盘。个人关系选择与这次公投分别保存。'}]}
 const lines=[`本幕材料：${p.shared}/${p.total} 份已公开。`]
 if(context.objective)lines.push(`当前目标：${context.objective}`)
 if(!p.ownFound)lines.push('打开“本局”→“本幕任务”，请先搜证，查看自己的材料，再点击公开。')
 else if(!p.ownShared)lines.push('自己的材料已经找到。回到“本幕任务”把它公开，伙伴才能一起核对。')
 if(p.shared<p.total)lines.push('还有材料未公开：可以在“本幕任务”询问 AI 同伴，或请真人朋友查看并公开自己的材料。')
 if(p.puzzleRequired&&!p.solved)lines.push(p.shared<p.total?'材料齐全后，在“本幕任务”的“共同结论”输入结论并点击“核验答案”。':'材料已齐。在“本幕任务”的“共同结论”输入结论并点击“核验答案”。')
 else if(p.puzzleRequired)lines.push('共同结论已核验通过，不需要重复提交。')
 if(!p.ownDecisionSaved)lines.push('完成上面的共同目标后，到“我的身份”→“本幕决定”保存自己的回应。')
 if(p.ownConfirmed)lines.push(p.pendingHumanNames.length?`你已经确认继续，正在等 ${p.pendingHumanNames.join('、')} 确认。`:'你已经确认继续，刷新房间即可查看进展。')
 else lines.push('最后回到“本幕任务”，点击“完成本幕，确认继续”。所有真人确认后自动推进；不是在聊天里打“举手”。')
 return{segments:[{kind:'narration',text:lines.join('\n\n')}]}
}
