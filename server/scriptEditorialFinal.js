// Final cross-field editorial pass for new, unpublished editions only.
const motives={
 letter:['核对播报与那份旧档案，也把最想问泊舟的话当面问清。','想知道自己究竟被怎样记住，又怕熟悉的人仍只肯说半句话。'],
 repair:['面对那次会面与六年前的签字，想清楚怎样回答眼前的人。','想保住知夏眼里的自己，却越来越难把沉默说成体贴。'],
 photo:['拿出完整记录，说明自己当年的裁切，也认真回应顾晚。','想被顾晚认真看见，而不是又把特意来见她说成顺路。'],
 conductor:['把交接与旧登记核对清楚，问林序一次不绕弯的答案。','习惯替大家收场，今晚也想有人听完自己的需要。'],
 actor:['说清自己回来取稿的行程，找出那次目击究竟看见了什么。','想重新站回这座剧院，又怕所有解释都被听成讨一个位置。'],
 manager:['保住自己经营多年的体面，面对控台记录逼近的追问。','希望别人先想起自己为剧院做过的事，又知道今夜无法被那些事抵消。'],
 restorer:['重新核对玻璃和道具的细节，把鉴定的依据拿到桌面上。','想再相信自己的眼睛，也想有人愿意耐心看完她的过程。'],
 reporter:['校准手里的录音，更正那次把影子说成本人的目击。','想把报道写对一次，哪怕第一句必须先承认自己说错。'],
 radio:['听清循环声缺掉的部分，也听见眼前同伴真正的回应。','想找到熟悉声音的来处，却不想又把所有注意力关进耳机。'],
 signal:['用现行标识核对路线，把熟悉的演练和今晚的新情况分开。','想让大家觉得可靠，也想坦然说出这次自己还不知道的地方。'],
 medic:['找到等待的人，核对能否同行，也说出自己的担心与疲惫。','习惯照顾所有人，今晚希望有人愿意和自己一起等。'],
 ticket:['听完当事人的经历，把旧文章省掉的结尾认真补回去。','想让自己的文字值得相信，不再靠悬着一个人的名字换好故事。'],
 map:['核对内外观察方向，让四份材料共同指向可读的图。','想证明忠实的留白也值得被喜欢，又怕自己的图没人愿意多看一眼。'],
 mechanic:['读清缺页说明，再决定手上的工具究竟需不需要用。','想帮上忙，也想学会不是每个难题都要自己先伸手。'],
 archive:['保留原文、来源与修正，和同伴一起核对日期与出口。','想让整理工作被看见，又怕一个漂亮结论盖掉普通人的名字。'],
 light:['让各人都读得清条件，也给自己留一点想一想的时间。','喜欢把复杂的事讲明白，但这晚也想安稳地做一次参与者。'],
 sutang:['和江远完成作品，问清那句被剪掉的话，再面对两人的下一段生活。','想去巡演，也舍不得眼前的人；希望变化后的需要能被认真听见。'],
 jiangyuan:['说清原件与公共副本的处理，也把自己的工作与需要讲完整。','仍想和苏棠相爱，却不想只靠一句没事把自己的日子藏起来。'],
 songmi:['把草稿和署名经过核对清楚，听见裴叙昨天没说完的解释。','在意自己被怎样对待，也仍然期待见到那个爱跳步骤的人。'],
 peixu:['补上拖延的解释，和宋弥一起把档案整理完，再认真提出自己的邀请。','想在课程之外继续见她，越认真却越容易借题目绕路。'],
 xuying:['修好画册，问清旧信的来往，也认识今天坐在面前的陆晞。','擅长指出纸上的问题，谈到自己喜欢什么人时反倒先开玩笑。'],
 luxi:['完成展陈，聊清留下改稿的缘由，认真邀请许映在工作之外见面。','想把顺便说成特意，又担心一句认真会让眼前的轻松消失。'],
}
const ties={
 'before-rain':'雨还打在旧广播室的窗上，几张不同的指认票留在桌面。这一次没有共同指认，谁也没有被改成赞成另一票。原始材料仍在，下面的完整还原会把今夜和旧事分别说清；各人的关系回答另行保留。',
 'thirteenth-curtain':'空舞台的工作灯还亮着，道具间的门没有再关上。你们的票没有形成同一项指认，记录保留各自的判断。桌上的材料已经核对到这里，完整案件还原仍会展示；这片灯光没有替任何一人改变最后的答案。',
 'last-midnight':'信号间的门边，备用灯仍沿着核对过的步道延伸。对怎样收场，你们没有投出同一个选择；不同的安排原样留下。人数、灯光时长与守望员状况都已有记录，广播里的谜团也会照实还原，不用一张平票再制造新的危险。',
 'inverted-observatory':'东门旁的大字和触摸指示仍清楚地留着。关于带走记录、留下说明还是怎样返程，你们还没有共同选定一项。四个人提供过的资料没有因此消失；穹顶的光慢慢暗下去，核对过的出口仍在那里。',
 'one-more-stop':'庭院的汤还冒着一点热气，玻璃温室里只剩收好的线。今晚怎样收场，你们没有投出同一个答案；明信片、椅子和汤碗仍各在原处。两人的感情回答会逐项保留，白夜不会替谁多写一个承诺。',
 'last-elective':'花园的路灯亮着，展板已经留在工作室。吃饭、拍照或再走一段，你们没有共同选定一个收尾。两张不同的票和两个人各自的关系回答都留下来；那张草稿上的猫仍戴着眼镜，这一晚不因平票变成没有发生。',
 'venice-blue-hour':'屋顶长桌上，盘子和速写纸还没有收走，运河留着细细的反光。今晚吃饭、交换画还是收好展架，你们没有投出同一项选择。票保留各自原样，关系回答也分别展示；晚风没有替任何人接下一句答应。',
}
export function applyEditorialFinal(game){
 for(const role of game.roles){
  const motivation=motives[role.id];if(!motivation)throw Error('Missing editorial role motivation')
  role.goal=motivation[0];role.card.desire=motivation[1]
  const clean=value=>String(value||'').split(/(?<=[。！？\n])/).filter(s=>!/(?:AI|服务器|系统物证|系统线索|本幕私人决定|最终私人选项|最终私人选择|最后一次私人决定|最终个人决定|私人选择只|故事不会|不得篡改|玩法不会|这里的玩法|不会替你|你(?:也)?不能(?:替|代替|先替|私自|凭一句|请她替)|不能把已发生的事改写|不能由你凭想象)/.test(s)).join('').trim()
  role.entryBook=clean(role.entryBook)
  for(const chapter of role.chapters||[])chapter.text=clean(chapter.text)
 }
 game.tieEnding=ties[game.id]
 if(game.id==='before-rain'){
  game.clues[6].text='固定机位的大厅画面从许知夏完成21:04签收、离开广播室并进入大厅后接续，连续保留至21:17:50。知夏进入大厅后，与林序、顾晚均在画面范围内；签收影像、出入口记录与这段画面使用同一校对时间，按先后衔接。背景玻璃的细节仍需后续原始画面核对。'
  game.roles[2].entryBook=game.roles[2].entryBook.replace('21:04到21:17:50，你、知夏、顾晚都在连续画面范围内；你没有同时躲进广播室。','知夏完成21:04签收并进入大厅后，你们三人的接续画面一直保留到21:17:50；你没有同时躲进广播室。')
  game.clues[1].text='控制台队列表列有文件F7，名称“告别试录”，保存时间19:40。自动播放计划填写时段代码B；本页没有时段对应的钟点，也不记录执行时是否另开现场麦克风。'
  game.clues[3].text='当晚交接登记：时段代码B对应21:12，前一时段已完成19:40试录。交接表只对应时段，不记录21:12实际启用了文件回放还是现场输入；要与控制台和照片核对。'
  game.roles[1].secret=game.roles[1].secret.replace('你可以隐瞒真相，不可编造新证据或改变这些事实。','想到大家会翻出会面记录，你越来越难把手放稳。')
 }
 if(game.id==='thirteenth-curtain'){
  game.roles[1].entryBook=game.roles[1].entryBook.replace('这不是替你决定认罪，只是给这个并不只有一种情绪的人，留一个能够开始说话的位置。','话到了嘴边，你先看了一眼谁把那张记录推过来，手指在桌沿停了停。')
  game.clues[3].text='未经剪辑的采访录音保留两段异常声响：先是一阵人声与短促闷响，稍后有一段有节奏的声音。设备时钟未独立校准，这一页不把它们标成现场钟点，也没有认定声音来自哪里。'
  game.clues[5].text='投影机续接日志显示：21:04加载上周排练片段，21:10播放最后一个画面，目标为侧窗反光板。日志沿用控台时钟；操作账号的实名登记另行封存，当前页没有写出操作者姓名。'
  game.clues[9].text='便笺约陈砚21:00说明真品去向，末行写着：“明天向董事会交账。”约见对象与时间均保留在原纸上。'
  game.clues[10].text='展柜中的复制件近期由舞台监督交付；真品包装签收单上的收件人记为同一名舞台监督。鉴定表记录展柜现物的材质与真品不符。'
  game.clues[11].text='将采访录音的连续标记与控台日志校准后，声响顺序为21:02争执与撞击、21:04预录启动、21:10影像及排练音效。三段之间的连续标记和停顿长度均保留在校准表上。'
  game.roles[1].secret=game.roles[1].secret.replace('你想隐瞒责任，但不能伪造或销毁系统线索。','你想隐瞒责任，一想到日志会被翻出来，心里就越来越不安。')
 }
 if(game.id==='inverted-observatory'){
  game.roles[1].entryBook=game.roles[1].entryBook.replace('你尚未知道每一关的排列与方向；带来的技术经验帮助你读懂说明，却不会使你提前拥有别人手中的信息。','说明正好缺在接缝那一页。你看了看同伴手里的纸，隔着桌子读不清，只能先把自己的那一段展平。')
  game.clues[4].text='记录A：1967年。展牌旁的亮度标记为四份记录中最高。'
  game.acts[2].puzzle.hint='把四张门牌分开核对：每条通向哪里、允许谁通行、有没有回到原处。先排除明确不供访客通行的方向，再检查剩下的去向是否接到公共通道。'
  game.acts[0].objective='公开四段外侧刻度，从春季2号格起，换到馆内顺时针经过四个编号位，再输入四位数字；核对的是观察方向，不按纸面顺时针照抄。各自留下想法，再确认继续。'
  game.acts[0].opening='穹顶亮起四个编号位。控制台写着“春季起点，馆内顺时针”，纸图却从天球外侧绘制。四人手里的材料分别记录方向和闭环的几段接缝，换一个观察位置，绕行的方向也会反过来。'
  game.roles[2].secret='你知道展柜按发现时间而非亮度排序。自己那份C记录写着1995年，其余三份日期还在同伴的材料里。'
  game.roles[2].entryBook=game.roles[2].entryBook.replace('具体日期仍得等材料齐全。','你自己的C记录是1995年，仍要等另外三份日期，才能排出完整顺序。')
  game.sceneOverrides={0:{narration:game.acts[0].opening}}
 }
 if(game.id==='last-midnight'){
  game.summary='雨夜，四名旅客在旧站听见广播喊出自己的名字。两条看不清的路线、反复的敲门声，以及一道迟迟没有打开的门，把熟悉的地方变得陌生。'
  game.roles[0].secret='你听过今晚广播的旧录音，它来自一次救援演练。旧带里没有当下旅客的名字；你还不知道播报程序怎样把这两段声音接到了一起。'
  game.clues[8].text='演练程序记录显示：固定旧录音之后，程序从当天访客登记表读取姓名，自动拼接回呼段。程序停留在演练循环，没有退出；这是脚本读取登记数据的记录。'
  game.clues[11].text='原始救援记录的末句是“所有人到齐”。闻笙已发表的旧文在此前一段结束，没有收进这句。两份有日期的版本并列保存，可以直接核对差异。'
  game.truth='守望员迟迟没有出来，是信号间旧门故障所致；循环广播与当下姓名来自未退出的演练程序，程序把访客登记姓名接在固定旧录音之后。闻笙旧文删去“所有人到齐”的结尾，造成了有人永远没回来的鬼谈误读，但文章不是门锁或广播姓名的来源。路线、开闭告示与灯光记录共同指向蓝线安全步道；守望员清醒、可以步行，众人有时间正常撤离。'
  game.endings.record='愿意留下声音的人，各自作了一小段回应；不愿被记录的人仍和大家一同撤离。录音最后收进雨声与踏上步道的脚步，没有要求谁必须对着话筒说话。'
  game.sceneOverrides={0:{cast:{ticket:{after:{medic:'叶澄，你一直看门，是在等谁吗？我也有个人想见，刚才没找着机会说。'}}}}}
 }
 if(game.id==='one-more-stop'){
  game.acts[1].opening='三段声音终于与叶影、水纹、门灯接上。隔壁录音工作间的窗没有关严，风掀起一角笔记。公共预览里少了一句很轻的说话，桌边放着处理记录与核对要求。文件名挤在几行字里，苏棠想听江远把处理经过从头讲清。'
  game.acts[1].puzzle.question='哪一份文件符合本次核对要求，是要找的完整原件？交换双方材料后，填写R1、R2或R3。'
  game.sceneOverrides={1:{narration:game.acts[1].opening,cast:{jiangyuan:{open:'把记录摊开吧。我想从头跟你核一遍，昨天有些话咱们都停得太早了。',after:{sutang:'好，记录就在手边。你先说最想核对哪一处，我陪你从那儿看。'}}}}}
  game.roles[1].card.beats[1].entrance=game.sceneOverrides[1].cast.jiangyuan.open
 }
 if(game.id==='last-elective'){
  game.roles[0].secret=game.roles[0].secret.replace('曾在课程回顾袋中留下希望以后继续见面的便签','曾在课程回顾袋中留下一张珍惜搭档合作、暗含好感的便签')
  for(const act of game.acts)act.objective=act.objective.replace(/在“我的身份”保存|在“我的身份”留下/g,'记下').replace(/各自在“我的身份”保存/g,'各自记下')
  game.acts[1].puzzle.question=game.acts[1].puzzle.question.replace('，例如“黄蓝白绿”','，将四个颜色文字连写')
  game.roles[0].chapters[2].text=game.roles[0].chapters[2].text.replace('最后一张字格只解锁一份旧邀请；你现在的答复写在自己的最终选择里。','字格还没读完，眼前那张纸让你有一点想笑，也有一点紧张。你更想听裴叙当面说今天的打算。')
  for(const role of game.roles)role.missions[2].prompt=role.id==='songmi'?'邀请和你在课程回顾旁附的小便签已经摊开。此刻你想怎样回应裴叙？':'自己的邀请和宋弥附的小便签已经摊开。此刻你想怎样把邀请说清？'
  game.publicRevealOverrides=[]
  game.publicRevealOverrides[2]='【返还页三 · 题目以外的两张便签】\n坐标连成的邀请是：“周六下午一起看展吗？”\n\n裴叙的原便签写着：“这次没有小组作业，也不用顺便帮我改稿。我想和你一起去。要是你问这是不是约会——我希望是。”\n\n另一张是宋弥在课程回顾之外放进袋里的小便签，原文是：“这学期最想保留的，不只是最后那张做对的展板，还有和搭档一起把错误改明白的下午。”\n\n邀请和小便签放在同一页了。纸上留下的是当时的心意，今晚坐在桌边的人还有自己的答案。'
  game.sceneOverrides={1:{cast:{peixu:{open:'这次不说等会儿了。你先看看记录，我把那天没说完的话补上。',after:{songmi:'好。这次不等会儿了。你先看记录，我就在这儿。'}}}},2:{cast:{songmi:{open:'这张路线纸折得也太小心了。裴叙，你平时交作业可没有这么讲究。'},peixu:{open:'你一坐到对面，我就又想检查一遍东西有没有带齐。笔在这儿，要哪支？',after:{songmi:'你一说我更紧张了。路线纸先摊平，我把笔递过来。'}}}}}
  game.roles[0].card.beats[2].entrance=game.sceneOverrides[2].cast.songmi.open
  for(const role of game.roles){if(role.id==='peixu'){role.card.beats[1].entrance=game.sceneOverrides[1].cast.peixu.open;role.card.beats[2].entrance=game.sceneOverrides[2].cast.peixu.open}role.entryBook=role.entryBook.replace('你们一起设计的是玩法：','你们为开放日商量过一个双人解题档案：')}
 }
 if(game.id==='venice-blue-hour'){
  game.acts[1].puzzle.question='四个交接袋的正确先后顺序是什么？每个标签只用一次，把四个标签连写即可。'
  game.roles[0].missions[0].options[1].label='先问他为何留着草稿，等档案齐了再聊笔名'
  game.roles[1].missions[0].options[1].label='先讲保留批评的缘由，等核对档案时再说笔名'
  game.sceneOverrides={1:{cast:{xuying:{open:'书店比画室凉一点。先把四个袋子的标签排开吧，我怕漏看收件那一栏。'},luxi:{open:'这里光有点暗，纸先往窗边挪一点。你那页的收件记录从哪一袋开始？',after:{xuying:'好，我把这一页放旁边。先看标签和日期，别让桌上的摆法把咱们带跑了。'}}}}}
  game.roles[0].card.beats[1].entrance=game.sceneOverrides[1].cast.xuying.open;game.roles[1].card.beats[1].entrance=game.sceneOverrides[1].cast.luxi.open
  game.roles[0].chapters[1].text='首份档案里那句关于椅子的批评，确实是你写过的话。四个袋子还没有按先后展开，你把自己的归档页放到桌边。陆晞就在对面，你一会儿想问改稿的事，一会儿又想先听他把收件经过讲完。'
  game.roles[1].chapters[1].text='改稿和读者批注已经摆出来，四封信的来回顺序还夹在交接记录里。你伸手摸了摸纸角，想起当年收到那句批评时的不服气。许映在读另一页，你很想知道她先注意到了哪一笔，也在犹豫什么时候把自己的旧名字说出来。'
  game.clues[5].title='陆晞的新课计划与未送出的邀请草稿'
  game.clues[5].text='陆晞准备下月的装帧课，也画过几张工作速写。旁边夹着一张早先写下、尚未送出的私人邀请草稿：明天下午吃饭，再去看公开版画展。这是他当时写过的想法，不是今天已经发出的邀约；是否正式提出、怎样回应，尚未说定。'
  game.publicRevealOverrides=[]
  game.publicRevealOverrides[2]='【蓝色档案三 · 计划旁的草稿】\n许映的新纸样与修复课计划、陆晞的装帧班安排都摊在桌上，留着可以商量的空白。\n\n几张最近的工作速写旁，夹着陆晞早先写下、尚未送出的邀请草稿：“明天下午，一起吃饭，再去看看版画展。”草稿记录的是当时的心意，不是一封今天已经发出的邀请；两人此刻是否愿意约会、慢慢了解或只做朋友，还没有由这张纸回答。\n\n楼下有人喊了一声可以吃饭了。风把桌布的一角吹起来，五年前的日期被遮住了一小半。'
  for(const role of game.roles){
   const unknown=text=>String(text||'').replace(/不知道陆晞就是逆光/g,'不知道逆光在现实中是谁').replace(/不知道许映就是页边/g,'不知道页边在现实中是谁').replace(/不知道许映是页边/g,'不知道页边在现实中是谁').replace(/你不知道她是页边；[^。]*。/g,'你不知道页边在现实中是谁，正好奇许映会怎样读这些旧信。')
   role.entryBook=unknown(role.entryBook);for(const chapter of role.chapters||[])chapter.text=unknown(chapter.text)
   role.card.pastEventAnchors=role.card.pastEventAnchors.map(unknown);role.card.beats=role.card.beats.map(beat=>({...beat,memory:unknown(beat.memory)}))
  }
 }
 for(const role of game.roles)for(const mission of role.missions.filter(m=>m.stage<2)){
  mission.title='内心打算 · '+mission.title
  if(/只保存|不代替你|私人决定|界面|按钮/.test(mission.prompt))mission.prompt='面对眼前的人和材料，你现在更靠近哪一种想法？'
 }
 return game
}
