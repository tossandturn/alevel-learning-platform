// Versioned editorial remasters. Never patch the frozen source book or an
// existing room. Mechanics, hidden culprit and solution values are preserved.
import {roleBookBiography} from './scriptRoleBooks.js'
import {applyDecisionPrompts} from './scriptDecisionPrompts.js'
import {applyEditorialFinal} from './scriptEditorialFinal.js'
const revisions={
 'before-rain':{version:5,sourceVersion:4,sourceEdition:'romance-case-20261106'},
 'thirteenth-curtain':{version:3,sourceVersion:2},
 'last-midnight':{version:3,sourceVersion:2},
 'inverted-observatory':{version:3,sourceVersion:2},
 'one-more-stop':{version:4,sourceVersion:3,sourceEdition:'duet-iceland-20261108'},
 'last-elective':{version:3,sourceVersion:2,sourceEdition:'campus-elective-20261107'},
 'venice-blue-hour':{version:3,sourceVersion:2,sourceEdition:'venice-blue-hour-20261107'},
}
const cache=new WeakMap(),clone=value=>JSON.parse(JSON.stringify(value))
export const editorialEdition=id=>revisions[id]?{...revisions[id],edition:`${id}-editorial-20261112`}:null
export const sourceScriptEdition=game=>game?.sourceContentEdition||game?.contentEdition
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
function replace(value,old,next){if(!value.includes(old))throw Error('Editorial source text changed');return value.replace(old,next)}
export function editorialScriptGame(source){
 const spec=editorialEdition(source?.id)
 if(!spec||source.version!==spec.sourceVersion||(source.contentEdition||undefined)!==spec.sourceEdition)return null
 if(cache.has(source))return cache.get(source)
 const game=clone(source)
 Object.assign(game,{version:spec.version,clientVersion:2,contentEdition:spec.edition,sourceScriptVersion:source.version,sourceContentEdition:source.contentEdition||null})
 for(const role of game.roles)role.entryBook=role.entryBook||roleBookBiography(game.id,role)
 if(game.id==='before-rain'){
  game.clues[1].text='控制台队列打印条：韩屿19:40保存“告别试录”，预设21:12播放。队列保存的是计划与文件名，不记录21:12是否另开现场麦克风；需要核对当时的设备状态和交接登记。'
  game.clues[5].text='门口原始进出清单：21:04一人离开，21:05一人进入，21:09同一人离开，21:18顾晚进入并发现韩屿。其间没有其他进出；本页只记录人数与时间，需与签收影像、大厅连续画面及交接范围合并，才能确认21:05进入者。时间均已统一校对。'
  game.clues[9].title='值班记录器 · 21:07连续录音'
  game.clues[9].text='独立值班记录器的连续录音从20:50开始，保留韩屿与周泊舟在21:07的争执、一次撞击声，以及随后韩屿不再应答的过程。这不是19:40告别试录的尾段。顾晚报警后，记录器与原文件一同封存；导出副本保留连续时码，与门禁及大厅录像校对一致。声音本身不能说明每个动作，仍需独立影像核对。'
  game.clues.push({id:'case13',roleId:'photo',stage:2,required:false,title:'宣传档案 · 原片与发布稿对照',text:'独立封存的宣传档案保存六年前的原片与发布稿：原片边缘有“试录，正式安排未确认”，发布稿裁掉了这一行。交付回执由林序署名，保留原片编号与发布时间。档案只说明裁切和交付，不包含林序私下向谁解释过、为何这样做；这些仍可当面问他。'})
  game.roles[2].secret=game.roles[2].secret.replace('今晚你带来了原始素材，本想先让顾晚私下看，而不是当众承认自己参与了误导。','你带来的个人原片，原本想先让顾晚私下看。警方另外封存了宣传档案副本；你无法控制那份公共档案，但仍在犹豫怎样亲口解释当年的裁切。')
  game.truth=game.truth.replaceAll('原始声音尾段','值班记录器连续录音').replaceAll('声音尾段','值班记录器录音')
  game.case.truth=game.truth
  game.acts[2].opening=game.acts[2].opening.replace('声音尾段','值班记录器的连续录音')
  game.roles[1].chapters=[
   {stage:0,title:'第一幕私章 · 播报仍然响起',text:'21:12，那段熟悉的声音响起来时，你的手还搭在椅背上。你知道韩屿已经不能站到话筒前。控制台打印条就在手里，纸边被你捏出一道折痕。\n知夏在看那份旧节目档案。八年前你没叫住她，六年前你提前签了验收单，今夜又有一次四分钟的会面。这是三件不同的事，你却总想把它们挤进一句“当时没办法”。你可以先说打印条上的安排，也可以正面回答别人。那张纸始终在桌边。'},
   {stage:1,title:'第二幕私章 · 那四分钟',text:'21:05进去，21:09出来。看见时间被摆成两行，比心里默念它们更难受。你还可以不讲争执的细节，可门口记录和大厅录像没有为你留出另一次进门。\n顾晚负责交接，林序保留了连续画面。他们不是只坐在知夏身边的两个人，也各自有要问你的话。你想看知夏的脸，又怕在她开口之前就先求她相信。'},
   {stage:2,title:'第三幕私章 · 不能再叫作保护',text:'值班录音、玻璃里的画面、那张旧验收单，都已经被找到。你望着桌上的原文件，第一次觉得“再等一会儿解释”已经没有地方可放。\n你仍然在意知夏，也知道她没有替你承担今夜的理由。如果你想把话说完，能够说的是自己做过什么、现在后悔什么。她是否还愿意听，得等她真正开口。窗外天快亮了，你的手里没有能把这一晚倒回去的工具。'},
  ]
 }
 if(game.id==='thirteenth-curtain'){
  game.summary='停演剧院重开前，保管人死于道具间。陆弦说钟响时还看见他活着，另外三人的时间记录却对不上。四人要查清：他看见的究竟是谁？'
  game.clues[1].text='控台使用独立备用电源，联网校准时钟；舞台灯光闪断期间，控台记录未中断。第一段打印条记着21:01结束排练，随后日志另存。请与另外几份记录标出的时钟状态分别核对。'
  game.clues[5].text='续接第一段打印条的投影机日志：21:04加载上周排练片段，21:10播放最后一个画面，目标为侧窗反光板；操作账号属于舞台监督。备用电源供电连续，日志时钟与控台同源校准。'
  game.acts[0].opening=game.acts[0].opening.replace('停电恢复后','舞台灯光闪断后重新亮起')
  game.ballot.question+=' 每位真人各投一票，以真人票数最高者形成指认；平票则记录未形成一致指认。AI意见只供参考，不压过真人票。'
  const beat=game.roles[0].card.beats?.[2];if(beat)beat.entrance='手稿是我回来拿的。怕你们又让我滚出去，一直没敢说。现在纸就在这里，你们想看哪页？'
 }
 if(game.id==='last-midnight'){
  game.clues[0].text='旧磁带能听清：“请沿……至安全步道。安全步道在高处，别进旧站台。”颜色所在的音节被循环声盖住，不能只凭这段带子辨认线路。'
  game.clues[1].text='维修单只标连接位置：蓝线通往高处步道，红线通往低处旧站台；这页没有写今晚哪条开放。门外两条线的走向与纸上的箭头一致。'
  game.clues[2].text='疏散图显示集合点在高处步道北端，低处旧站台与集合点不相通。颜色图例折在缺页里，必须把实际路线与维修单核对。'
  game.clues[3].text='雨中照片还能读到告示：“高处步道今晚开放；旧站台施工封闭。”反光盖住了颜色，但位置标记没有变。今晚是否能通行，以这张现行告示核对。'
  game.acts[0].opening=game.acts[0].opening.replace('你们决定先弄清路线，不盲目跟随声音。','声音又从头响了一遍，门外的两条指示线仍伸向不同方向。')
  game.acts[2].opening='门从里面打开了。守望员扶着门框，先问“蓝线的灯还亮吗？外面还有谁？”他想知道那条路还能维持多久，也想缓一缓再试着走。屏幕仍一行行滚着姓名，广播又从头响起。记录就在门边；找到人之后，还有一段路要一起走完。'
  game.acts[2].objective='核对灯光能维持多久、守望员能否步行及集合点路线；公开本幕记录，分别想清楚自己愿意照应哪一件事，再一起选择撤离安排。'
  game.acts[1].puzzle.answers=['我们都在']
  game.roles[3].entryBook=game.roles[3].entryBook.replace('叶澄：她在等一个人。','叶澄：你注意到她总在数人、看门，像有牵挂；还没听她亲口说明在等谁。')
  game.roles[3].secret='你写过的鬼谈省掉了“全员获救”的结尾，当事人为此给你写过长信。你一直拖着没改，今晚来是想听他亲口讲完。你不知道循环广播为何会念出访客姓名。'
  game.roles[3].entryBook=replace(game.roles[3].entryBook,'有人把那篇文章带进过广播室，这件事不能证明有鬼，也不能证明某个在场者操纵了所有事情','你写过的文章让不少人把这里当作鬼谈发生的地方，可今晚的广播为什么念出姓名，你自己也说不清')
  game.roles[2].card.examples[1][1]='我先陪你把门后的字看清。你想现在走，还是坐一会儿再走？'
 }
 if(game.id==='inverted-observatory'){
  game.clues[0].text='春季起点标在2号格。纸图是站在天球外侧画的；人在穹顶内侧抬头看时，顺时针与纸图的顺时针相反。控制台要从春季开始，按馆内顺时针依次经过四季。'
  game.clues[1].title='外侧刻度 · 第一接缝';game.clues[1].text='纸图外侧顺时针读，2号格后接3号格。这只记录纸图方向，不能直接当作馆内顺时针。'
  game.clues[2].title='外侧刻度 · 第二接缝';game.clues[2].text='纸图外侧顺时针读，3号格后接1号格。四格组成一个闭环，没有跳格。'
  game.clues[3].title='外侧刻度 · 最后一段';game.clues[3].text='纸图外侧顺时针读，1号格后接4号格，4号格再回到2号格。把完整闭环核对好，再换到馆内观察方向。'
  game.acts[0].puzzle.question='站在穹顶内侧，从春季起点按馆内顺时针走完四季，对应的四位编号是什么？纸图按外侧顺时针记录，先核对观察位置，再输入数字。'
  game.acts[0].puzzle.hint='先拼出纸图外侧顺时针闭环。馆内顺时针与它相反；从春季2号格出发，反向走完四格。'
  game.clues[11].text='东门标签写着“公共通道”，旁边同时有大字与触摸指示。是否作为出口，要与另外三扇门的去向一同核对。'
  game.roles[3].secret='你知道馆方为这组标签准备了不依赖辨色的大字与触摸替代。它能帮助大家读清条件，但你还没有看全四扇门的去向。'
  game.roles[1].secret='你看过馆内展陈装置的独立断电旁路和紧急退出说明。答错只会让控制台要求重输，出口指示仍在；现在缺失的是一页展示顺序说明。'
  game.roles[1].card.examples[0][1]='控台会让咱们重输，旁边那盏出口灯不会灭。先把缺的那页找齐吧。'
  game.roles[1].entryBook=game.roles[1].entryBook.replaceAll('游戏安全旁路','展陈装置的断电旁路').replaceAll('游戏装置','展陈装置')
  game.roles[1].entryBook=replace(game.roles[1].entryBook,'游戏外的退出始终存在','旁边的紧急退出指示始终亮着')
  game.acts[1].objective='公开四份发现日期。可由一人读原文、一人排顺序，另外两人倒着复核；核对亮度与年代有没有被混为一谈，再输入从早到晚的字母。在“我的身份”保存想法，真人各自确认继续。'
 }
 if(game.id==='one-more-stop'){
  for(const role of game.roles)role.missions[2].options.push({id:'consider',label:'还想继续相爱，但需要时间商量异地',consequence:'你仍想继续关系，尚未确认六个月异地安排。'})
  game.clues[3].text=replace(game.clues[3].text,'R3：提示点已修正、已降噪、私人说话已从公共副本拿掉。','R3：提示点已修正、已降噪；它是另行拿掉私人说话的公共副本，不是未处理原件。')
  game.roles[0].entryBook=replace(game.roles[0].entryBook,'在看过材料以前，不要自己编一个删除原件的动作。','你还没看过导出记录，一想到原件有没有留下，心里就有点发紧。想来想去，还是得亲口问他。')
 }
 if(game.id==='last-elective'){
  game.roles[1].entryBook=replace(game.roles[1].entryBook,'留给最终那张折页活动揭开','没有告诉她，也没想好她若看见会怎样回答')
  game.roles[0].chapters[2].text=replace(game.roles[0].chapters[2].text,'最后一张矩阵','最后一张字格')
  for(const role of game.roles)role.missions[2].prompt=role.id==='songmi'?'折页里两张回顾便签已经一起展开。此刻的你，想怎样回应裴叙的邀请？':'折页里自己的邀请和宋弥的回顾便签已经一起展开。此刻的你，想怎样把邀请说清？'
 }
 if(game.id==='venice-blue-hour'){
  game.roles[0].biography=replace(game.roles[0].biography,'却不知道陆晞就是那位作者','却不知道“逆光”在现实中叫什么、过着怎样的生活')
  game.roles[1].biography=replace(game.roles[1].biography,'但起初不知道许映就是当年写信的读者“页边”','却不知道当年写信的读者“页边”在现实中是谁')
  game.roles[0].entryBook=replace(game.roles[0].entryBook,'你只需要把自己真正想问的那句问出来，听清对方的回答，然后说自己的。','你把检测页翻过去，又翻回来。刚才想好的那句话就在嘴边，门外的咖啡已经凉了，你倒希望陆晞再晚一点催你开工。')
 }
 if(['before-rain','thirteenth-curtain'].includes(game.id)){
  for(const clue of game.clues){clue.access='public-investigation';clue.title='公共调查材料 · '+clue.title}
  for(const act of game.acts)act.objective+=' 本幕材料是独立封存的公共调查副本，任何在场者都可从搜证位置主动查阅并公开；人物私章与私聊不在其中。'
 }
 // Move explicit interface/engine instructions out of in-character prose.
 const prose=value=>String(value||'').split(/(?<=[。！？\n])/).filter(sentence=>!/(?:这里的玩法|游戏外|服务器|AI也不会|让AI|系统线索|不需要玩家|本局的|本局已|本局实际|玩家|游戏状态|剧情规则)/.test(sentence)).join('').trim()
 for(const role of game.roles){role.entryBook=prose(role.entryBook);for(const chapter of role.chapters||[])chapter.text=prose(chapter.text)}
 game.roles.find(r=>r.id==='letter')?.chapters?.forEach(chapter=>{chapter.text=chapter.text.replace('不要为了维持旧爱，把别人明确给出的事实删去；也不要因为自己被误解过，就把所有人都放到对立面。','你的指尖碰到暂停键，又停住了。想听下去，也怕下一句话会让熟悉的人变得陌生。')})
 applyEditorialFinal(game)
 applyDecisionPrompts(game)
 cache.set(source,freeze(game));return cache.get(source)
}
