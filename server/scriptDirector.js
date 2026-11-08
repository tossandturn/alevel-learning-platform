// UI directions are server-owned presentation, never character memories or story facts.
export const isIdentityGuide=value=>/(?:人物故事|人物背景|角色故事|我的身份|人物本|角色本|背景故事|身份入口)/.test(String(value||''))&&/(?:在哪|哪里|怎么看|怎么读|怎么打开|点哪|入口|看不到|找不到)/.test(String(value||''))
export function directorNextStep(p={},phase='play'){
 if(phase==='vote')return {key:'vote',text:'右上角“本局”→“最终投票”，提交自己的选项。所有真人提交后揭晓结局。'}
 if(!p.ownFound)return {key:'inspect',text:'右上角“本局”→“本幕任务”→“我的搜证位置”。先点开自己的材料。'}
 if(!p.ownShared)return {key:'share',text:'材料看完了，可以点“公开给所有人”。伙伴才能一起核对。'}
 if(p.shared<p.total)return {key:'companions',text:'还有同伴的材料没公开。在“本幕任务”展开“同伴的发现”，点“请 TA 分享”；真人朋友自行公开。'}
 if(p.puzzleRequired&&!p.solved)return {key:'solve',text:'材料齐了。在“本幕任务”找到“共同结论”，填好后点“核验答案”。'}
 if(!p.ownDecisionSaved)return {key:'decision',text:'共同目标已完成。右上角“本局”→“我的身份”→“本幕决定”，保存自己的回应。'}
 if(p.ownConfirmed)return {key:'wait',text:p.pendingHumanNames?.length?'你已确认，等其他真人也确认后进入下一幕。':'你已确认，刷新房间即可查看进展。'}
 return {key:'advance',text:'可以继续了。到“本幕任务”点“完成本幕，确认继续”。所有真人确认后推进。'}
}
export function directorProgress(room,game,roleId){
 const clues=game.clues.filter(c=>c.stage===room.stage),own=clues.find(c=>c.roleId===roleId),mission=game.roles.find(r=>r.id===roleId)?.missions?.find(m=>m.stage===room.stage)
 return {shared:clues.filter(c=>room.publicClues.includes(c.id)).length,total:clues.length,puzzleRequired:Boolean(game.acts[room.stage]?.puzzle),solved:room.solved.includes(room.stage),ownFound:Boolean(own&&(room.known[roleId]||[]).includes(own.id)),ownShared:Boolean(own&&room.publicClues.includes(own.id)),ownDecisionSaved:!mission||Boolean(room.missionChoices?.[roleId]?.[mission.id]),ownConfirmed:room.advanced.includes(roleId),pendingHumanNames:room.seats.filter(s=>s.control==='human'&&!room.advanced.includes(s.roleId)).map(s=>game.roles.find(r=>r.id===s.roleId).name)}
}
export function directorOpening(stage){return stage===0?'开始前，点右上角“本局”→“我的身份”，读人物故事和秘密。\n看完回到“本局”→“本幕任务”，找自己的第一份材料。':'到了新一幕。右上角“本局”里可以查看本幕任务和自己的新内容。\n此前的对话、线索和决定都保留着，不用重开故事。'}
