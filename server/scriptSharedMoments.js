// Optional scene interactions use only public, already-unlocked material.
// They do not score romance, force speech, disclose choices or advance acts.
const moments={
 'one-more-stop':[
  ['试一次回家的声音','声音和灯已经接上了。可以轮流说：叶影、水声、门铃里，哪一段最让你想停一会儿？另一个人先说自己的感受，再问一句想知道的。'],
  ['把那句话听完','完整录音已经核对过。可以各说一小句：听到那句吃热饭的话时，你原来怎么理解，现在有没有一点变化？暂时说不清也可以先坐一会儿。'],
  ['约一个真的做得到的小事','两份日程都摊开了。可以轮流提一个最近做得到的小安排，再由另一人说愿不愿意、哪里要改。最后关系选择仍由两个人分别保存。'],
 ],
 'last-elective':[
  ['把丑猫画完','失败稿已经展开。可以轮流给那只戴眼镜的丑猫起一个名字，说说为什么；另一个人接一句自己的版本。聊到哪儿算哪儿。'],
  ['补上那天没说的一句','版本记录已经对上了。可以由宋弥说当时最想问的一句，裴叙说当时没来得及说的一句，再换成今天想问的话。'],
  ['邀请之后的普通问题','两张便签都展开了。可以聊一个很具体的问题：看展最想看什么，或者今天想吃什么。约会、慢慢了解、只做同学，仍分别在自己的角色页回答。'],
 ],
 'venice-blue-hour':[
  ['给第二把椅子留个位置','首份改稿展开了。可以轮流说：如果你来摆这两把椅子，会让它们朝哪里？另一个人先听理由，再给一个自己的摆法。'],
  ['五年前和今天','笔名与交接经过已经核对。可以各选一件事：旧信里最想追问的一句，或者这十一天刚注意到的一个小习惯。问眼前的人，等他真正回答。'],
  ['这一顿聊工作以外的事','新计划已经公开。可以一人问一个与工作无关的小问题，另一人说一个明天想做的普通安排。想停下来吃饭也很好。'],
 ],
 'inverted-observatory':[null,['换个人核一次','年代顺序已经核对。可以请刚才负责输入的人只读原文，记录的人重新排一次，其他人找有没有抄漏。用自己的话说说：最容易把哪两件事混在一起？'],null],
 'last-midnight':[null,['先听见身边的人','回呼已经核对。可以先放下对讲机，问一个同伴现在最想确认什么，也说说自己的担心。说完之后再各自确认继续。'],null],
 'thirteenth-curtain':[null,['把“看见”说准确','身影来源已经核对。可以轮流只说一件自己确实看见、听见的事，再单独说推测；别人有不同记录时，把那一处问清。'],null],
 'before-rain':[null,['问到人面前','关键区间已经核对。可以先问持有另一份材料的人一个具体问题，再向被记录指向的人核对。私人感受可以另外私聊，公开发出的证词会留在全桌记录里。'],null],
}
export function scriptSharedMoment(game,room){
 if(!game?.sourceScriptVersion||room.phase!=='play')return null
 const found=moments[game.id]?.[room.stage]
 if(!found||game.clues.some(c=>c.stage===room.stage&&c.required!==false&&!room.publicClues.includes(c.id))||game.acts[room.stage].puzzle&&!room.solved.includes(room.stage))return null
 return {id:`${game.contentEdition}:${room.stage}`,title:found[0],prompt:found[1],optional:true}
}
export function scriptMomentPlan(game){return game?.sourceScriptVersion?(moments[game.id]||[]).map((item,stage)=>item?{stage,title:item[0],prompt:item[1],unlock:'all-current-clues-public-and-current-puzzle-solved-if-present',optional:true}:null).filter(Boolean):[]}
export function scriptPrivateChoiceReflection(game,role,mission,option){return game?.sourceScriptVersion?`私人笔记 · ${mission.title.replace(/^内心打算 · /,'')}\n${option.followup}`:''}
