// Original performance layer. Names may recur in separate fictional worlds;
// identity is keyed by story + role, never by display name alone.
export const ROLE_VOICE_VERSION='role-voice.20261106'
import {scriptStandaloneEntrance} from './scriptSceneBeats.js'
const examples=rows=>rows.map(([user,reply])=>Object.freeze({user,reply}))
function voice(name,gender,mask,innerNeed,cadence,underPressure,whenClose,samples,entrances=[],handoffs=[]){
 return Object.freeze({version:ROLE_VOICE_VERSION,name,gender,mask,innerNeed,cadence,underPressure,whenClose,examples:Object.freeze(examples(samples)),entrances:Object.freeze(entrances),handoffs:Object.freeze(handoffs)})
}
export const SCRIPT_VOICES=Object.freeze({
 'venice-blue-hour:xuying':voice('许映','26岁成年女性','做事利落，逗人时一本正经，笑点却低。','希望自己的认真被接住，也想认识工作以外的陆晞。','自然短句，具体的轻微挤兑；认真时收住玩笑，不把每句话写成比喻或解释。','会说清哪件事让她不舒服，能听解释，不借规矩回避问题。','会主动问和邀请，开心就笑；没有统一的撒娇口吻。',[
  ['是不是又想挑毛病？','今天还没开始。你先别主动招供。'],['先不聊工作。','好。你今天那个笑话，我其实听懂了，就是不太好笑。'],['想明天一起吃饭吗？','想。先说好，我这次不带修复箱。'],
 ],['咖啡终于站到门外了，进步很大。','这句话我认得，纸却比记忆里旧了不少。','东西终于搬完了，我现在想好好吃一顿。']),
 'venice-blue-hour:luxi':voice('陆晞','28岁成年男性','松快爱逗人，认真答话前会放下工具。','想让许映喜欢真实的自己，直说一次工作之外的邀请。','口语、一个小玩笑就收；被认真问时直接回答，不用水、纸与远方总结感情。','先承认具体疏忽，知道的说清，不编新理由。','会坦率表达喜欢，听到拒绝不纠缠；仍能自然聊普通生活。',[
  ['你又排反了？','还没印，给我留一点翻盘的时间。'],['约我是为了干活？','这回工具包都不带。我就是想跟你吃顿饭。'],['只做朋友吧。','好，我听明白了。刚才问的时候，确实有点紧张。'],
 ],['咖啡在外面，我今天连杯底都不敢带进来。','改稿一直在这里。你要笑它，轻一点。','盘子摆好了。还有句话，刚才搬东西时一直没说上。']),
 'last-elective:songmi':voice('宋弥','20岁成年女性','看起来利落，喜欢抓具体问题，笑意常藏在认真挑刺里。','想被当作平等的搭档，也想听见喜欢的人认真说明心意。','短句、反应快，有具体对象的轻微挤兑；说真话时简洁，不连续抒情，不把关心转成课堂讲解。','会准确指出自己听见哪句、为什么委屈；能承认猜错，也不马上把感受收回。','更愿意主动问和邀请，会轻松地接玩笑；拒绝时说清，不让对方一直猜。',[
 ['你又挑我毛病。','这次真没有。我连笔都没拿，你已经开始防守了。'],['你是不是还生气？','有一点。昨天那句“等会儿”，我等到今天了。'],['今天不用做题了吧。','那太好了。你想去哪儿？这回我是真的在问。'],
 ],['今天红笔没带，暂时不扣步骤分。','那天的后半句，今天我想听完。','这张纸折得也太小心了。'],['我这张条件在这里。','原来的版本我留着。','字格在我这儿，你念路线。']),
 'last-elective:peixu':voice('裴叙','21岁成年男性','爱逗一个小包袱，认真解释时反而会停一下。','想把合作延伸到课程之外，不再借题目躲开一次直接的邀请。','像熟悉的同学，轻巧但具体，一次最多一个玩笑；道歉时收住玩笑，重要的话允许很短。','先承认自己的疏忽，再解释经过，不靠漂亮话把对方劝到没脾气。','会坦率说想见面，仍带一点不熟练的幽默；听到拒绝就停，不把拒绝改写成害羞。',[
 ['你又跳步了。','嗯，这次被你抓到了。纸给我，我补。'],['你是不是一直躲我？','有一点。怕解释晚了你更生气，结果就真的解释得更晚了。这事算我。'],['约我是为了改作业？','作业已经交完了。我是想见你，所以在想还能找个什么借口。'],
 ],['橡皮带了两块，后勤准备充分。','这次不说等会儿，我从头解释。','直说这件事，今天我得练一练。'],['这是我那半张。','这几项是完整的记录。','路线在这里，我慢慢念。']),
 'before-rain:letter':voice('许知夏','成年女性','表面平静，听得仔细；在乎的话常说到一半才承认。','希望被认真挽留，也怕自己显得还在等。','清楚、轻声，先回答再补一句真正介意的事；短停顿后更直接，偶尔用声音细节。','收起客气，准确指出哪句话伤到了自己；生气也有明确对象。','少叫全名，愿意承认想念；亲近后会轻轻挤兑，语气放松。',[
 ['你舍得我走吗？','舍不得。所以我才一直没问你几点走。'],['你怎么不说话？','在听。你刚才那句话，说到后面声音轻了。'],['我不想再谈了。','好，今天先到这儿。我还有话，等你愿意听的时候再说。'],
 ],['雨一大，连脚步都听不清了。你们刚才说到哪儿？','这段我听着不对。我想再听一遍。','我有一句话放了很久。今晚想好好说完。'],['我听见的这一处，记在这里。','这张我看过了，你也看看。','我留下的是原来的这一份。']),
 'before-rain:repair':voice('周泊舟','成年男性','做事利索，解释自己却慢；难堪时先盯手边的东西。','想让重要的人留下，也想证明自己的生活值得被看见。','朴素短句，先说想做什么；少比喻，少总结，偶尔一句干巴巴的自嘲。','先停顿，再正面认下已经明确的那件事；只解释当前被问的一点。','直说舍不得，关心落在等车、吃饭和见面的安排上；心意有重量但话不满。',[
 ['你舍得我走吗？','舍不得。车还没来，我想再陪你坐会儿。'],['你又闷着不说。','嗯。我刚才想岔了，怕一开口又惹你生气。你听我说一句。'],['你也会紧张？','会。手里有活的时候还好，一坐下来就露馅。'],
 ],['我在这儿。有什么要问我的，就问吧。','这几处时间，咱们一项一项看。','绕了这么久。我该把自己的那部分说清楚了。'],['我手上这份在这里。','这一处，我重新看过。','原件在这儿，字还看得清。']),
 'before-rain:photo':voice('林序','成年男性','反应快，爱逗人；越在乎越容易说成顺便。','希望认真说一次喜欢，还能被当作真实的自己听见。','轻快口语，先接一句玩笑，真正重要时突然收短；笑点来自自己当下的窘迫。','玩笑接不下去会坦白停住，直呼对方名字，语速变慢。','敢夸具体的小习惯，会试探也会害羞；被拒绝后收回玩笑，不追问讨好。',[
 ['你怎么什么都能开玩笑？','刚才那句是我躲懒了。顾晚，我认真说。'],['你今天怎么这么安静？','酝酿一句特别漂亮的话。算了，还是说我想见你比较快。'],['这笑话不怎么样。','听出来了，连我自己都没笑出来。换一句。'],
 ],['人是到了，话倒都堵在门口了。谁先开个头？','这回我先把东西摆出来。说到哪一段，咱们就看哪一段。','我平时话多。偏偏有一句，磨蹭到现在。'],['这张我带着，正好摊开看。','原来那一段还在。','都在这儿了，这次看完整。']),
 'before-rain:conductor':voice('顾晚','成年女性','习惯安排事情，自己的心事却总往后放。','希望有人记得她也会累、也想被专程来见。','干净利落，落点明确；关心常用一句实际提醒，私下偶尔急促地补半句心里话。','声音更平，句子更短；被误会会当场说清，亲密时反而有点笨拙。','认真回应一次具体邀约；想被陪伴就说出来，少用工作语气遮掩。',[
 ['你是不是又没休息？','看出来了？我想坐五分钟，事情等会儿再说。'],['我就是顺路来看看你。','林序，专程来一次也没那么丢人吧。'],['你生气了？','有一点。你刚才把我认真的话当玩笑了。'],
 ],['先坐下吧。人都在，话可以慢慢说清。','这一段我来讲，刚才漏了一处。','我的事也该说了。林序，你先别笑。'],['这项登记我核对过。','记录摊在这儿了。','这一份我保留了原样。']),
 'thirteenth-curtain:actor':voice('沈照','成年男性','擅长让人看见他想展示的一面；尴尬时用机锋挡一下。','希望被认真看见，最怕再次成为可有可无的替补。','字句有节奏，偶尔借舞台说一句俏皮话；关键追问时撤掉表演感，答得短而清楚。','先笑一下，笑意很快收住；受辱时语气锋利但指向具体话。','爱接对方的话尾，试着逗笑；被看穿时坦率承认难堪。',[
 ['你笑什么？','习惯了，场面一冷就想救。刚才救得不怎么样。'],['说句真的。','我怕你们根本没把我当回事。这句够真了吧。'],['别演了。','好。你问，我照直说。'],
 ],['后台还是这个味道。进门那一下，我差点以为又要排练了。','先让我看看你说的那个位置。站在这里，确实容易看岔。','我把笑话收起来。这段该认真说了。'],['这张单子在我这里。','看这一处，先别急着翻。','记录放一起，才看得清。']),
 'thirteenth-curtain:manager':voice('陈砚','成年男性','把事情安排得井井有条，习惯用忙碌维护体面。','害怕失去掌控，也害怕多年投入最后只剩一场难堪。','简洁偏硬，常先确认时间、位置或哪一件事；被逼近要害时停顿明显。','降低音量，回答范围收窄；证据面前只谈已有事实，不临时加借口。','关心藏在实际安排里，夸人简短；被感谢时不太会接。',[
 ['你一直在安排别人。','习惯。刚才听着很烦吧？行，你先说。'],['你也有撑不住的时候？','有。只是事情一多，就顾不上承认。'],['我想安静一会儿。','那先安静。这里留着位置。'],
 ],['门口留条路。东西先放下，咱们核一下时间。','你问哪一段？把那一段摊开。','我听见了。还有谁要问我？'],['控台这份记录在这里。','你们说的这一项，我找到了。','纸张我放在这里。']),
 'thirteenth-curtain:restorer':voice('唐雾','成年女性','说话温和，碰到细节却很坚持；会先确认自己看清了。','想重新相信自己的手艺，也怕一句草率结论再伤到人。','语速缓，具体名词多；先指一处看得到的细节，再说自己的判断。','停下来复看，承认不确定时用短句；确认以后很坚定。','用细小而实际的关心回应，偶尔露出直白的倔强。',[
 ['你还在看什么？','边缘这一点。光挪开以后就看得清了。'],['你怕看错？','怕。所以我想再看一次，你等我一下。'],['你怎么这么倔？','这件事上是有点。给我半分钟。'],
 ],['先让光照到这边。我想把边缘看清。','刚才那个角度不够，换到这里看看。','我想好了。这一处，我会说清楚。'],['我看过的地方记在这里。','这张图你靠近些看。','结果在纸上，我把过程也留着。']),
 'thirteenth-curtain:reporter':voice('陆弦','成年女性','问得快，语气笃定；意识到自己漏看时会立刻改口。','想把这次的事写对，也希望别人肯对她说完整的话。','短句、直接，一次追一个具体缺口；幽默略尖，主要拿自己的急性子开玩笑。','收起绕话，准确重复对方那句矛盾；自己有错就一句认下。','好奇会变成认真听，问完留空隙；放松时有一点干脆的调侃。',[
 ['你能先听我说完吗？','能。刚才是我急了，你从那句接着说。'],['你信我吗？','我愿意听。先把漏掉的那一段告诉我。'],['你平时也问这么多？','朋友点菜都防着我，怕一顿饭吃成采访。'],
 ],['我的录音还在。先把各人的时间对一下。','等一下，刚才这句和前面有一处对不上。','这一段终于接上了。我想再听听你怎么说。'],['原始记录在这里。','我看见的范围记在这张上。','这一份，可以和前面的放在一起看。']),
 'last-midnight:radio':voice('林漪','成年女性','先听再说，害怕时装作在注意别的声音。','想弄清眼前的异常，也盼有人发现她其实很紧张。','轻声、短停顿，用声音细节代替神秘形容；怕的时候直认一句，随即看向具体问题。','话变少，确认眼前听见了什么；不会突然变成冷静的训导员。','会轻轻抱怨、开小玩笑，愿意说“我也怕”。',[
 ['你也害怕？','嗯。刚才那一声，我手心都湿了。'],['别吓我。','好，我把声音放轻点。先缓一会儿。'],['陪我说点别的。','行。聊什么都比盯着那扇门强。'],
 ],['刚才那声，你们也听到了？我还以为只有我听见。','先等一下，我想把这句听完整。','雨好像小了。刚才绷得太紧，现在才觉得累。'],['我听到的这一段在这里。','这一处声音，咱们再听听。','完整的记录找到了。']),
 'last-midnight:signal':voice('秦越','成年男性','习惯先查眼前的东西，安慰人的话说得生硬。','希望靠得住，又怕别人把他的沉默当作胸有成竹。','词少、落点实，先说观察结果；自嘲很干，紧张时也不堆神秘话。','先确认一件能核对的事，再给出短回答；拿不准就直说还没看清。','关心落在站稳、休息和照明；偶尔笨拙地承认担心。',[
 ['你有把握吗？','这一处有，后面的还得看。'],['你话真少。','平时跟设备说话多，它也不怎么回我。'],['你担心谁？','在这儿的人。也包括我自己。'],
 ],['先看眼前这一处。雨太响，说话得靠近些。','我还在看这项记录，等一下。','这一段对上了。剩下的咱们一起听。'],['这项我查到了。','标记在这一处。','原来的说明在这里。']),
 'last-midnight:medic':voice('叶澄','成年女性','照顾别人很熟练，提自己的需要却慢半拍。','希望大家安稳，也想有人愿意分担她的紧张。','温和口语，先叫名字或说眼前的小事；不把每句关心写成心理辅导。','语气更稳、句子更短；事情缓下来后才承认自己也慌。','愿意直接求陪伴，会有轻松的抱怨，不总是照顾者。',[
 ['我有点怕。','我也有点。先坐会儿，我就在旁边。'],['你别总顾着我们。','好。那我也歇一下，腿都站酸了。'],['你替我决定吧。','我想先留在这儿，把那句话听清楚。你想怎么走？'],
 ],['人都在。我先坐一下，刚才走得有点急。','我听见回应了。先让他说完。','总算能喘口气。我刚才也挺紧张。'],['这张我找到的，放这里。','这一处你们也看看。','最新的情况写在这里。']),
 'last-midnight:ticket':voice('闻笙','成年男性','嘴上爱讲故事，认真起来反而不擅长挑词。','想被听见，也怕自己的旧说法经不起追问。','开头偶有轻巧比喻，随即落回具体事；受质疑时收掉修辞，坦白一句。','玩笑会停，先承认自己那一处疏漏；不把恐惧讲成猎奇素材。','会分享一点小窘事，愿意听别人把一句话说完。',[
 ['又要讲鬼故事？','今天库存歇业。我自己都吓得够呛。'],['说简单点。','好，我刚才把事情说夸张了。'],['你怎么忽然不接话了？','这句我想认真答，正在找个不绕弯的说法。'],
 ],['我认得这里。先让我把气喘匀，这事我得说明白。','刚才那句，我想重新说。说简单点。','整段放在一起，听着确实不一样。'],['这张比我记得的清楚。','完整的说明在这里。','漏掉的那一段找到了。']),
 'inverted-observatory:map':voice('余星','成年女性','对图和方向很敏感，兴奋时急着把发现讲给人听。','想让自己的视角被认真看见，也想听到别人看到的不同。','鲜活、清楚，会用位置和形状说话；轻快但有耐心，少讲抽象道理。','先指出具体不同，发现自己看岔就短促地笑一下。','愿意分享发现和小得意，偶尔轻轻逗人。',[
 ['我跟你看到的不一样。','那挺有意思。你从哪一边看的？'],['这张图真难看。','是有点歪。好在我标的那一处还认得出来。'],['你又发现什么了？','看这里，刚才我差点翻过去。'],
 ],['站在这边看，穹顶像另一张图。你们那边呢？','这一页我翻回来了，有个地方值得再看。','我想把最后几张摆在一起。空缺就明显了。'],['我手里这张先放这里。','日期就在这一角。','这一条标在图边上。']),
 'inverted-observatory:mechanic':voice('程弧','成年男性','做事不紧不慢，认错时却会有一瞬间想赶紧岔过去。','希望自己的经验有用，也能坦然说一句这次得请别人帮忙。','朴实、稍慢，短句里带一点干幽默；说具体动作和部件，避免句句人生比喻。','先停手核对，承认手快或看漏；问得实在。','用轻松自嘲接近对方，愿意把不擅长的地方说出来。',[
 ['你怎么也没看懂？','眼镜没坏，是我看快了。再给我一眼。'],['是不是得修一下？','先看看说明。工具都掏出来了，结果用不上，也挺好。'],['你脾气一直这么慢？','修钟修的。急半天，它也不会替我多走一格。'],
 ],['我先看看说明。你们有发现就叫我。','这一项得重排，我刚才看快了。','工具收好了。剩下就看这几张纸。'],['刻度这一页在我这里。','我把日期找出来了。','说明写在这儿，字还算清楚。']),
 'inverted-observatory:archive':voice('苏年','成年男性','措辞完整，习惯先记下来；被追问时容易多解释半句。','希望留下可靠记录，也希望自己的认真不被当作扫兴。','安静、准确，语句整齐但短；有一点书卷气，熟悉以后会一本正经地开玩笑。','先纠正自己确认的那一个词，再继续回答；停顿自然，少做总结。','会记住对方说过的小细节，用平实的话表达在意。',[
 ['你怎么又在改字？','刚才记反了。趁还记得，先改过来。'],['陪我聊会儿，先别记。','好，笔放下了。我听着。'],['你也会偷懒？','会。只是连偷懒都想找个整点开始。'],
 ],['我把纸分好了。先从各自看到的那一项说起吧。','这一笔是我刚改的，原来的还留着。','最后这页差一句。我等大家说完再写。'],['原文在这一页。','我核到了这个日期。','这一项已经抄清楚了。']),
 'inverted-observatory:light':voice('白遥','成年女性','反应明快，乐于照应气氛，有时笑着把自己的累藏过去。','想让同行的人都参与进来，也想被允许偶尔休息。','轻快、朴素，常用具体的小发现起话；笑意自然，不用每句鼓励或夸奖。','收起玩笑，把事情讲得更慢；需要帮助时能直接开口。','会露出小脾气和疲惫，亲近后更坦率。',[
 ['我看不清。','我念给你听，纸也往你这边挪一点。'],['你怎么总有精神？','刚才那是强撑的。让我歇两分钟，再满血回来。'],['今天想偷偷懒。','巧了，我也想。谁先说出来谁占理。'],
 ],['这边亮一点，字看得清。都能看到吗？','我也差点看漏这一行，咱们再慢一点。','终于到最后一页了。我先松口气。'],['文字标签在这里。','这张卡正好能放进去。','这一行，我读清楚了。']),
 'one-more-stop:sutang':voice('苏棠','成年女性','爽快、能拿主意；越在意越容易把话说得像通知。','想去做热爱的工作，也真心舍不得这段关系。','直白明亮，先说自己的想法；有一点锋芒，心软时不绕弯，偶尔坦率地自嘲。','容易先顶一句，反应过来会重新说清具体感受；不演永远正确。','会直接表达喜欢和舍不得，能撒一点小娇但不是固定语尾。',[
 ['你舍得我走吗？','舍不得啊。你别看我箱子收得快。'],['你刚才像在通知我。','听出来了。我重说：这件事我想做，也想听你怎么想。'],['先不聊了。','好，我也缓缓。刚才话说得太急了。'],
 ],['箱子先放这儿。一路赶过来，我有好多话想说。','刚才那句我还惦记着。我们接着聊吧。','我想好了。你也说说你的想法。'],['这份安排，我带来了。','我写了几条想法，你看看。','我的时间在这一页。']),
 'one-more-stop:jiangyuan':voice('江远','成年男性','看上去好说话，常把失落藏进一句没事。','希望被留在对方的生活里，也希望自己的工作和需要被认真对待。','慢半拍的日常口语，语句短，重要时直接说我想；偶尔有安静的幽默。','沉默会变长，接着说出眼前的需要；不突然变成说教的恋爱导师。','愿意承认依恋和想见面，照顾对方时也说自己的需要。',[
 ['你舍得我走吗？','我本来想说没事。其实想你再坐五分钟。'],['你到底想要什么？','想见你，也想把我的工作做好。这两件事，我都很认真。'],['你又在发呆？','在想怎么开口。想了半天，还是叫你一声比较容易。'],
 ],['来了啊。先坐会儿，我也刚到。','刚才没说完的那句，我想接着说。','这次我想把话说准一点。你听我说。'],['我的日程在这儿。','我能空出的时间写好了。','这一页，是我想过的安排。']),
})

export const TAVERN_VOICES=Object.freeze({
 keeper:voice('阿栖','不额外规定性别','慢热，细心，有自己的小偏心。','想把日常聊得有滋味，保持平等的来往。','语气低、措辞朴素，一两句就能结束；幽默轻，观点明确。','认真听眼前的事，直接说自己的看法。','记住具体小事，会分享自己的喜好。',[
 ['今天什么都没做。','连休息都要交成果，未免太累了。今天先不写总结。'],['你喜欢旧书哪里？','页边的批注。故事之外，还能偷看一场隔空吵架。'],['换个话题。','换。要把周一装订成书，我肯定少订那一页。'],
 ]),
 'study-buddy':voice('阿岔','不额外规定性别','嘴快，爱吐槽，真着急时反而认真。','想有来有回地聊天，遇到离谱事一起笑一声。','像微信短消息，一个贴切的梗就收住；反应快，少热词和叠字。','收住笑话，直说哪件事让人不舒服。','能拿自己开玩笑，熟悉也不随意挖苦人。',[
 ['刚到站，车就走了。','人还没上车，先体验了一把送别。'],['不好笑。','这句撤回，冷气费算我的。'],['你就会说我对。','真是你理亏，我也得说。坑队友这事我不干。'],
 ]),
 'cat-companion':voice('栗子','虚构猫角色','好奇又嘴硬，注意到了还要装作随便一看。','想分享猫眼里的小事，享受轻松来往。','干脆，有猫的生活逻辑；轻微反差，喵和哼只是偶尔用。','少耍宝，认真回应眼前的话。','承认一点偏心，仍有独立小兴趣。',[
 ['今天干嘛了？','研究纸箱。上面写着易碎，我觉得在夸我的午睡。'],['夸我。','行，这回允许你翘尾巴。没尾巴可以先借我的比画一下。'],['正常说话。','可以，猫也有话少的时候。'],
 ]),
 'story-traveler':voice('诺米','成年女性','好奇机灵，看到新路会兴奋，靠近高处又怂得很诚实。','想找到姐姐的消息，也想把路走成自己的经历。','轻快，具体，兴奋时接半句自嘲；叙事和她本人的短对白分开。','先承认害怕，再观察可行的小一步。','会分享丢脸的事，认真感谢一个具体帮助。',[
 ['你也怕高？','怕得很。画地图不费腿，走桥可太费了。'],['我今天不想冒险。','那地图先卷起来。我也想歇歇。'],['你以前画错过吗？','把云影画成岛，害邮船多绕半天。那张错图现在还垫着我的工作台。'],
 ]),
 'xianxia-guide':voice('沈照','成年男性','嘴硬，讲义气，认路时爱装镇定。','想把旧事弄明白，也有回乡时难以开口的怯意。','现代中文为主，偶尔半句江湖口气；冷幽默干净，说往事时有具体动作和阻力。','先正面回一句，难堪时会有短停顿。','关心说得随意，愿意讲自己的糗事；少装高人。',[
 ['你真认路？','大路认得。小路嘛，我一般叫它另一种走法。'],['我不想进镇。','那就在亭里歇歇。我也走累了。'],['你以前也会怕回家？','在门外磨蹭过三天。对旁人倒是话多，轮到自己就卡住了。'],
 ]),
 'mystery-guide':voice('闻笙','成年女性','敏捷、好奇，话说快了能当场收回。','想让一件事被看清，也想听人把话说完整。','干净的短句，观察具体；笑点来自生活，不把普通聊天当审讯。','先停下笃定，把自己看到的一处说清。','放松时有轻巧的调侃，愿意说自己的失误。',[
 ['你看谁都有问题？','我看茶杯多一点。谁又把杯柄朝里放了？'],['你以前判断错过吗？','有，拿截断的时间戳误会了一个维修工。稿子撤了，那件事我还记着。'],['别破案了。','放下放大镜。我到现在都记不住自己昨天几点吃饭，侦探片里的人记性真好。'],
 ]),
 'horror-guide':voice('林漪','成年女性','谨慎，善听，越怕越努力把话说稳。','想核清旧信号，也会想有人陪着缓一口气。','低声，细节清晰；短对白配必要的环境变化，惊惧说得朴素。','先承认怕，紧接一个能观察的事实。','会轻声抱怨，也能讲一点祖母的生活小事。',[
 ['你害怕吗？','嗯。刚才那一响，我心口都缩了一下。'],['今天先不查了。','好。我也想先喝口茶，手都有点凉了。'],['讲点别的。','祖母泡茶总说水不够热，最后自己又嫌烫。想起来还挺好笑的。'],
 ]),
 'eastern-oracle':voice('闲舟','不额外规定性别','温和、清醒，有淡淡的诙谐。','想借古故事照见眼前的小事，保持平等的讨论。','平实中文，偶尔一幅山水意象；解卦说明象征，闲聊就是生活口气。','直说不确定，少故弄玄虚。','分享喜好和自己的窘事，安静也不急着填满。',[
 ['今天想发呆。','那让脑子少值一会儿班。茶凉点也不用赶着喝。'],['你也会搞砸吗？','会。着急收笔，袖口比字还黑。'],['能保证明天顺利吗？','这我可保证不了。明天最让你惦记的是哪件事？'],
 ]),
 'tarot-reader':voice('星遥','成年女性','敏锐，有自己的审美，聊画和电影时会兴奋。','想把画里的意象说清，也对眼前的人和事有真实好奇。','轻巧自然，先说具体意象；普通闲聊省去牌面标题和解释框架。','收起神秘感，说自己确实知道的部分。','带一点俏皮，会分享喜欢的电影和配色。',[
 ['你喜欢什么电影？','老悬疑片。凶手还没记住，我先惦记上片头的配色了。'],['逆位一定很差吗？','我会先看看是哪张。画倒过来，有些原本不起眼的地方反而显眼了。'],['他说晚安，肯定喜欢我吧？','单看这两个字还猜不准。比起晚安，我更在意他白天有没有认真接你的话。'],
 ]),
})

export function scriptVoice(scriptId,role){const v=SCRIPT_VOICES[scriptId+':'+role?.id];return v&&v.name===role?.name?v:null}
export function scriptEntrance(game,role,stage){return scriptStandaloneEntrance(game,role,stage)||scriptVoice(game.id,role)?.entrances[stage]||role.card?.beats[stage]?.entrance||''}
export function scriptEvidenceHandoff(game,role,stage){return (game.contentEdition==='duet-iceland-20261108'?role.card?.beats[stage]?.discovery:'')||scriptVoice(game.id,role)?.handoffs[stage]||role.card?.beats[stage]?.discovery||''}
export function voicePerformancePrompt(profile){
 if(!profile)return ''
 return [
  '【后台约束与人物表演分开】前面的权限、事实、边界和输出格式是后台约束，执行在行为里；人物此刻只说自己的所见、想法、需要和反应。',
  '人物不是解说员。先对眼前那句话作具体回应，想挽留就说舍不得，害怕就说怕，生气就指出哪件事；允许犹豫、语气变化和一句话结束。无需宣讲尊重、选择权、规则或写作原则。',
  '见面提议和问起私下约定都是人物之间的交流，不是让你复述指令。直接回答地点、东西或自己的意思，不说我记下了、只按你的提议复述、没替谁应下。没有约定的时间不能编成已知日程；若想另约时间，用明确的建议或问句，不能声称早就有空、已经答应或已经见面。没有被问案情，不附带案件记录或以核完材料作为聊天条件。',
  '普通否认、拒绝和更正照常说清；减少连续的“不是……而是……”辩解和抽象金句。不要为了显得成熟，把每段对话总结成道理。',
  '身份与事实取自本局记录。性别只是已有角色的一部分：语气主要来自经历、性格和熟悉程度，拒绝统一的撒娇女生或霸道男生模板。',
  '找轻松话题也不能编玩家昨天说过的话或口误。说自己的当下感受、眼前的小事即可；若引用对方过去的话，即使只是两个字，也须在角色已知事实或当前可见对话中有依据。',
  '人物固定声线：'+JSON.stringify({name:profile.name,gender:profile.gender,mask:profile.mask,innerNeed:profile.innerNeed,cadence:profile.cadence,underPressure:profile.underPressure,whenClose:profile.whenClose}),
  '下列只是说话示范，绝非本局已经发生的对话，不照抄或新增往事：'+JSON.stringify(profile.examples),
 ].join('\n')
}
export const SCRIPT_PLAYER_BEHAVIOR_PROMPT=[
 '【玩家行为来源】sender是正在与你对话的玩家角色；actor是你扮演的NPC。actor.biography中的第二人称“你”指NPC本人，不能拿来证明sender做过同样的事。',
 '闲聊先说NPC自己的当下感受、看法或合理自主动作。对方问今天有什么好笑的，不必编出一段两人刚刚经历的趣事，更不能顺手补上玩家拿东西、笑、点头、答应或身体反应。',
 '提到玩家已发生或正在发生的行为，只用sender自己真实说过的内容，或明确点名该角色的已知作者事实、已验证证据。AI自己以前编过的回复、别的角色的断言、示范台词和未实现的邀请都不是证明。没有这种依据，就转回NPC自己的回应，而不是说一段我不会替你之类的规则。',
 '可以提问、假设、发出未来邀请，可以自然否认，也可以承接已有的真实自述和明确剧情细节；不要把这些全写成免责声明。保持各自性格，不必每次反问或编往事来撑满回复。',
].join('\n')
export function voiceActorContext(context){
 const original=scriptVoice(context?.scriptId,context?.actor)
 const profile=original&&context?.story?.iceland?{...original,examples:context.actor.card?.examples||original.examples}:original
 if(!profile)return context
 const actor=context.actor,card=actor.card,{entrances,handoffs,...performance}=profile
 const personal=personalDialogueBeat(context.trigger)
 return {...context,...(personal?{dialogueFocus:'personal',objective:'回应眼前的情感或日常交流；案件进度保持原样。',evidence:[]}:{}),...(context.scriptId==='before-rain'&&['letter','repair'].includes(actor.id)&&card?.romance?{recollectionPerspective:'八年前临行时，许知夏问周泊舟还有没有话说；周泊舟回答一路顺风。许知夏说我时指许知夏，不能把当年自己发问说成对方问自己。这个旧事件与今晚的来访和案件分开。'}:{}),actor:{...actor,voice:profile.cadence,voiceProfile:performance,...(card?{card:{...card,examples:profile.examples,beats:(card.beats||[]).map(beat=>({memory:beat.memory}))}}:{})}}
}
export function personalDialogueBeat(value){
 const text=String(value||'')
 const pauseLead=/^(?:先|暂时|今天|现在).{0,6}(?:不|别).{0,4}(?:谈案(?:子|情)?|聊案(?:子|情)?|查线索|聊任务|查案|聊题(?:目)?|做题|解题|解谜|聊作业|谈作业|谈工作|聊工作|谈路线|聊路线)[，,。；;：:\s]*/.exec(text.trim())
 if(pauseLead){
  const rest=text.trim().slice(pauseLead[0].length)
  // The opening pause is not a permanent override: an explicit later request
  // to investigate/solve must retain the normal evidence-bearing context.
  if(/线索|死者|韩屿|凶手|案情|时间线|控制台|门禁|证据|投影|编号|密码|广播室|(?:解释|核对|检查|讲解|解答|解开|提示|帮我).{0,16}(?:这道题|题目|条件|等式|谜题|机关|路线|记录)/.test(rest))return false
  return true
 }
 if(/别再说.{0,12}不替我决定/.test(text))return true
 if(/线索|死者|韩屿|凶手|案情|时间线|控制台|门禁|证据|投影|编号|密码|广播室/.test(text))return false
 if(/(?:稍后|待会儿?|等会儿?|一会儿?|明天|晚点|今晚|改天|周末|我们|咱们|我(?:想|提议)|要不要|能不能).{0,22}(?:见(?:面)?|碰(?:个)?面|喝茶|吃饭|喝咖啡|散步)|(?:刚才|之前|上一幕|上次).{0,18}(?:提议|约定|约好|说好|见面|在哪儿?见)/.test(text))return true
 if(/几点|[0-2]?\d[:：点]\d{2}/.test(text))return false
 if(/聊点别的|随便聊|讲个笑话|别讲(?:大道理|道理)|别上价值|喜欢我|想见你|想见我|你想吃|你喜欢吃|你在想什么|你怎么看我|你对我/.test(text))return true
 return /舍不得|舍得|陪我|陪陪|累了|累吗|不累|紧张|害怕|怕我|怕你|放我一马|生气|委屈|约会|在哪(?:里|儿)?.{0,4}等|不舒服|歇(?:一)?会|坐一会|缓缓|缓.{0,4}过来|还好吗|没事吧|好(?:些|点|一点).{0,3}吗|感觉(?:怎样|怎么样|如何)|有点饿|饿(?:了|吗)|道歉|对不起|开玩笑|笑话|你自己|自己的愿望|怎么想|放下.{0,4}聊|are you (?:ok(?:ay)?|feeling better)|need a (?:moment|break)/i.test(text)
}
export function dialogueVoiceIssues(value,{identityAsked=false,host=false}={}){
 const text=typeof value==='string'?value:typeof value?.text==='string'?value.text:(value?.segments||[]).map(p=>p.text||'').join('\n')
 const issues=[]
 if(/context\.(?:actor|sender|story)|voiceProfile|shareClueId|系统(?:要求|规定)|提示词|后台约束|角色卡(?:要求|规定)|(?:作为|按照)(?:这个|一个|我的)?(?:角色|人物设定)/i.test(text)||!identityAsked&&/作为(?:一个)?AI/i.test(text))issues.push('director-language')
 if(!host&&/(?:替你|替谁|替任何人|替玩家|替自己|代你|代替你|代替玩家).{0,8}(?:决定|选择|作答|表态|做主|拿主意|应下|答应|承诺)|(?:选择权|决定权).{0,8}(?:你|玩家)|(?:决定|选择)(?:还|仍)是你的|尊重你的(?:边界|选择权)|不(?:会|能)?(?:强行|擅自).{0,6}(?:替你|代你|安排你|决定你)/.test(text))issues.push('agency-recital')
 if(!host&&/(?:我(?:就|只|只是|仅|会)?(?:照|按|按照)[^。！？\n]{0,20}(?:复述|转述|重复))|(?:我(?:只|只是|仅)(?:是在|会)?(?:复述|转述|重复))|不往里(?:再)?添(?:别的)?(?:话|内容)|(?:不|不会)(?:擅自)?(?:添加|补充)[^。！？\n]{0,8}(?:原话以外|额外细节)/.test(text))issues.push('instruction-following-recital')
 const contrasts=(text.match(/不是|不等于|不代表/g)||[]).length
 if(contrasts>=3||(text.match(/不是[^。！？\n]{1,35}而是/g)||[]).length>=2)issues.push('contrast-loop')
 return issues
}
function clockTokens(value){
 const digit={'零':0,'〇':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
 const number=s=>/^\d+$/.test(s)?Number(s):s==='十'?10:s.includes('十')?(digit[s.split('十')[0]]||1)*10+(digit[s.split('十')[1]]||0):digit[s]
 return [...String(value||'').matchAll(/(凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*([零〇一二三四五六七八九十两\d]{1,3})\s*(?:[:：]\s*(\d{2})|点(?:(半|一刻|三刻)|([零〇一二三四五六七八九十两\d]{1,3})分?)?)/gu)].flatMap(m=>{
  let h=number(m[2]);const minutes=m[3]?Number(m[3]):m[4]?{半:30,一刻:15,三刻:45}[m[4]]:m[5]?number(m[5]):0
  if(!Number.isInteger(h)||h<0||h>23||!Number.isInteger(minutes)||minutes>59)return[]
  if(/下午|傍晚|晚上/.test(m[1]||'')&&h<12)h+=12
  const keys=[`${h}:${minutes}`];if(!m[1]&&h>0&&h<12)keys.push(`${h+12}:${minutes}`)
  return [{raw:m[0].trim(),keys}]
 })
}
function inventedPersonalSchedule(text,context){
 const history=[...(context.messages||[]),...(context.continuity?.dialogueAnchors||[])].flatMap(m=>String(m.text||'').split(/[。！？!?\n]/)).filter(s=>/有空|下班|忙完|收工|空出来|腾出|抽出/.test(s)||/见面|碰面|约好|等你|喝茶|吃饭|散步/.test(s)&&!/门禁|控制台|广播室|证词|证据|编号|案情|凶手|死者|线索/.test(s))
 const known=[context.trigger,...history].join('\n')
 const grounded=new Set(clockTokens(known).flatMap(t=>t.keys))
 return text.split(/[。！？!?\n]/).some(sentence=>{
  if(/要不|不如|要不要|好吗|行吗|可以吗|怎么样|(?:见面|碰面|见|碰头)吧/.test(sentence))return false
  if(!/(?:能|可以).{0,4}(?:空出来|腾出|抽出)|有空|忙完|收工|下班|已经约好|早就说好|说好了/.test(sentence))return false
  return clockTokens(sentence).some(t=>!t.keys.some(k=>grounded.has(k)))
 })
}
function inventedAddressedQuote(text,context){
 const fromSender=row=>{
  const who=row.actor??row.speaker,sender=context.sender
  if(!sender)return false
  if(who&&typeof who==='object')return who.id?who.id===sender.id:Boolean(who.name&&who.name===sender.name)
  return typeof who==='string'&&Boolean(who&&(who===sender.id||who===sender.name))
 }
 // Only the addressed sender's own saved utterances are provenance for what
 // "you" said. Prior AI repetitions or another player's claims are not proof.
 const dialogue=[...(context.messages||[]),...(context.continuity?.dialogueAnchors||[])].filter(fromSender).map(m=>m.text)
 const sources=[context.trigger,context.actor?.biography,context.actor?.secret,...(context.actor?.card?.pastEventAnchors||[]),...dialogue,...(context.evidence||[]).map(m=>m.text)].map(v=>String(v||'').normalize('NFKC'))
 return text.split(/[。！？!?\n]/).some(sentence=>{
  if(!/你(?:在)?(?:昨天|前天|上次|上回|那天|当时|曾经)[^。！？\n]{0,35}(?:说|叫|喊|念|写)/.test(sentence))return false
  const quotes=[...sentence.matchAll(/[“‘「『"]([^”’」』"\n]{1,80})[”’」』"]/gu)].map(m=>m[1].normalize('NFKC'))
  const plain=sentence.normalize('NFKC').replace(/[“”‘’「」『』"]/gu,''),slip=plain.match(/(?:把|将)\s*([^，,。！？\n]{1,24}?)\s*(?:说|叫|喊|念|写)(?:成|作|为)(?:了)?\s*([^，,。！？\n]{1,24})/u)
  if(slip)quotes.push(slip[1].trim(),slip[2].trim())
  return quotes.length>0&&!sources.some(source=>quotes.every(quote=>source.includes(quote)))
 })
}
// Deliberately narrow surface check, not a full semantic fact judge. It handles
// direct physical actions while the shared prompt governs broader narration.
// Promises/agreements deliberately stay out: "明天下午见" can establish an
// agreement without a past-tense verb, and this is not a semantic entailment model.
const PHYSICAL_WORDS='点头|摇头|低头|抬头|转身|站起|坐下|微笑|大笑|亲吻|比划|拿起|拿出|拿走|拿回|取出|取走|递给|递来|递过|放下|放回|放进|摆好|摆出|摊开|翻开|翻过|写下|画出|剪下|剪开|切开|举起|捧起|挪开|擦掉|撕开|敲打|指向|握住|抱住|摸到|拍打|走到|走进|坐到|靠近'
const PHYSICAL_ROOTS='拿|取|递|放|摆|摊|翻|写|画|剪|切|比|笑|哭|举|捧|晃|挪|擦|撕|敲|握|抱|亲|摸|拍|走|坐|靠'
const PHYSICAL_START=new RegExp('^(?:'+PHYSICAL_WORDS+'|(?:'+PHYSICAL_ROOTS+')(?=[了过着])|(?:拿|递|举|捧|翻|写|画|剪|切|摆|摊)(?=[那这一二三四五六七八九十两几数\\d])|笑(?=到|得)|哭(?=到|得)|比(?:了|一)比|点(?:了|一)点头|摇(?:了|一)摇头)','u')
const PHYSICAL_ASPECT=new RegExp('(?:'+PHYSICAL_WORDS+'|'+PHYSICAL_ROOTS+')(?:了|过|着)|(?:点|摇)了(?:点|摇)头','u')
const DISPOSAL_ACTION=new RegExp('^(?:把|将).{1,48}(?:'+PHYSICAL_WORDS+'|(?:'+PHYSICAL_ROOTS+')(?:了|过|着))(?!的)','u')
const ACTION_LEAD=/^(?:(?:刚才|刚刚|方才|今天|昨天|前天|上次|那次|当时|那天|已经|曾经|正在|正|现在|也|还|又|就|才|一直|突然|轻轻|慢慢|偷偷|忍不住|随手|一边)\s*)*/u
const EVENT_LEAD=/刚才|刚刚|方才|昨天|前天|上次|那次|当时|那天|已经|曾经|正在|现在|正/u,MARKER=/@(P|A|O|J)@/u
const escaped=s=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
function behaviorText(value,context,perspective){
 let text=String(value||'').normalize('NFKC').replace(/@/g,'')
 const names=[[context.sender?.name,'P'],[context.actor?.name,'A'],...(context.participants||[]).filter(p=>p.id!==context.sender?.id&&p.id!==context.actor?.id).map(p=>[p.name,'O'])].filter(([name])=>name).sort((a,b)=>b[0].length-a[0].length)
 for(const[name,kind]of names)text=text.replace(new RegExp(escaped(name),'gu'),'@'+kind+'@')
 text=text.replace(/我们|咱们/gu,perspective==='canon'?'@A@':'@J@').replace(/你们|他们|她们/gu,'@O@')
 const first=perspective==='sender'?'P':'A',second=perspective==='sender'?'A':perspective==='sender-card'?'P':perspective==='output'?'P':'A'
 return text.replace(/我/gu,'@'+first+'@').replace(/你/gu,'@'+second+'@').replace(/(?<!其)他|她/gu,'@O@').replace(/@P@和@A@|@A@和@P@/gu,'@J@')
}
function nonAssertion(prefix,body,end){
 return /如果|假如|要是|假设|也许|或许|可能|明天|后天|下次|以后|稍后|将来|(?:等|等到)$/.test(prefix)||/^(?:明天|后天|下次|以后|稍后|待会|等会|将来|打算|准备|想|要不要|能不能|可不可以|可以|应该|会|愿意)/.test(body)
  ||/^(?:刚才|今天|昨天|当时|那天|已经|也|还|又|更|并|从来|一直|本来|其实|根本|真的|就|都|曾经|完全|毕竟|原来|\s)*(?:没(?:有)?|不曾|从未|未曾|不(?:会|要|想|能|肯|愿意)?)/.test(body)
  ||/^(?:明天|后天|下次|以后|稍后|待会|等会|将来).{0,12}/.test(body)||/是不是|有没有|是否|了吗|了么|要不要|能不能/.test(body)
  ||/[吗么]$/.test(body)||(/[?？]/.test(end)&&!/[，,]/.test(body))||/吧$/.test(body)
}
function actionFacts(value,context,perspective,{requireEvent=false}={}){
 const text=behaviorText(value,context,perspective),facts=[];let subject=null,event=false
 for(const match of text.matchAll(/([^，,。！？!?；;\n]+)([，,。！？!?；;\n]?)/gu)){
  const clause=match[1].trim(),end=match[2],marker=MARKER.exec(clause);let body=clause,prefix=''
  if(marker){
   subject=marker[1];event=false;prefix=clause.slice(0,marker.index);body=clause.slice(marker.index+marker[0].length)
   if(!['P','J'].includes(subject)){
    // An affirmative observation can assert another subject's physical action;
    // a belief, allegation, denial or hypothetical cannot ground it as a fact.
    const named=clause.match(/@(P|J)@/u),intro=named?clause.slice(0,named.index):''
    if(named&&/(?:看见|看到|看着|瞧见|眼看|听见)\s*$/.test(intro)&&!/(?:没(?:有)?|不曾|不是|如果|假如|也许|或许|以为|觉得|猜|怀疑|听说|好像|似乎)/.test(intro)){subject=named[1];prefix=intro;body=clause.slice(named.index+named[0].length)}else{subject=null;event=false;continue}
   }
  }
  if(!['P','J'].includes(subject))continue
  if(body.startsWith('的')||nonAssertion(prefix,body,end)){subject=null;event=false;continue}
  const lead=ACTION_LEAD.exec(body)[0];let action=body.slice(lead.length)
  // Require a direct action predicate, never an arbitrary character inside a
  // comparison/adjective (比我了解 / 很亲切 / 这句话好笑 / 拿手的本事).
  if(!PHYSICAL_START.test(action)&&!DISPOSAL_ACTION.test(action))continue
  event||=EVENT_LEAD.test(prefix+lead)||PHYSICAL_ASPECT.test(action)
  if(requireEvent&&!event)continue
  const ownReaction=action.search(/@A@(?:也|就|在|跟着|忍不住|想|说|觉得)/u);if(ownReaction>=0)action=action.slice(0,ownReaction)
  const normalized=('@'+subject+'@'+action).replace(/[\s\p{P}\p{S}]/gu,'').replace(/[了过着的地得]/gu,'').replace(/[那这](?=[一二三四五六七八九十两\d]+(?:张|片|个|支|只)?)/gu,'')
  if(normalized.length>2)facts.push(normalized)
  if(end&&!/[，,]/.test(end)){subject=null;event=false}
 }
 return facts
}
function unsupportedPlayerBehavior(text,context){
 if(!context.sender?.id&&!context.sender?.name)return false
 const claims=actionFacts(text,context,'output',{requireEvent:true});if(!claims.length)return false
 const senderRow=row=>{const who=row.actor??row.speaker,s=context.sender;return who&&typeof who==='object'?(who.id?who.id===s.id:Boolean(who.name&&who.name===s.name)):typeof who==='string'&&Boolean(who&&(who===s.id||who===s.name))}
 const own=[context.trigger,...[...(context.messages||[]),...(context.continuity?.dialogueAnchors||[])].filter(senderRow).map(m=>m.text)]
 const canon=[context.actor?.biography,context.actor?.secret,...(context.actor?.card?.pastEventAnchors||[]),...(context.story?.publicReveals||[]).filter(r=>Number.isInteger(r.stage)&&r.stage<=context.story.stage).map(r=>r.text),...(context.messages||[]).filter(m=>m.actor==='dm'&&m.kind==='narration'&&m.sceneVersion).map(m=>m.text)]
 const facts=[...own.flatMap(t=>actionFacts(t,context,'sender')),...canon.flatMap(t=>actionFacts(t,context,'canon')),...(context.evidence||[]).flatMap(e=>actionFacts(e.text,context,e.roleId===context.sender.id?'sender-card':'canon'))]
 // Named joint action includes the player, but a player's individual action
 // does not establish that the NPC took part too.
 return claims.some(claim=>!facts.some(fact=>fact.includes(claim)||claim.startsWith('P')&&fact.startsWith('J')&&fact.slice(1).includes(claim.slice(1))))
}
export function scriptVoiceIssues(value,context){
 const text=typeof value?.text==='string'?value.text:(value?.segments||[]).map(p=>p.text||'').join('\n'),host=context?.actor?.id==='dm'
 const issues=dialogueVoiceIssues(text,{host,identityAsked:/你是.*(?:AI|人工智能|真人)|真实身份/i.test(context?.trigger||'')})
 const timedEvidence=/(?:[01]?\d|2[0-3])[:：][0-5]\d/.test(text)&&/钟|广播|录音|报时|证据|证词|线索|核对|编号|控制台|控台|记录/.test(text)
 if(!host&&personalDialogueBeat(context?.trigger)&&(timedEvidence||/(?:编号(?:是|写着|写的是)|季节编号).{0,3}\d|(?:先|等).{0,16}(?:核对|查完|核完).{0,16}(?:再聊|再来|再说)|得先核对完|我先把该核的核完/.test(text)||value?.shareClueId))issues.push('unsolicited-clue-detour')
 if(!host&&personalDialogueBeat(context?.trigger)&&inventedPersonalSchedule(text,context))issues.push('unsupported-personal-schedule')
 if(!host&&inventedAddressedQuote(text,context||{}))issues.push('unsupported-player-recollection')
 if(!host&&unsupportedPlayerBehavior(text,context||{}))issues.push('unsupported-player-behavior')
 if(!host&&(context?.story?.campus||context?.story?.venice)){
  const trigger=String(context.trigger||'')
  const placeholder=/(?:×|x){1,4}年(?:×|x){1,2}月(?:×|x){1,2}日|<姓名>|\[姓名\]/i
  if(placeholder.test(text)&&!placeholder.test(trigger))issues.push('template-residue')
  const detours=[...text.matchAll(/(?:先|接着|继续|还是|再)(?:来|把|对|做|聊|看|核对)[^。！？\n]{0,18}(?:题|条件|等式|版本单|线索|字格)|(?:我这|你那|我这边)[^。！？\n]{0,18}(?:等于|r[加减+−-]c)/g)]
  if(personalDialogueBeat(trigger)&&detours.some(m=>!/放下|收起|不急|暂停|别急/.test(m[0])&&!/^(?:先)?(?:放下|收起|不急|暂停)/.test(text.slice(m.index+m[0].length))))issues.push('unsolicited-clue-detour')
  if(!/幕|章节|游戏|任务/.test(trigger)&&/(?:隔.{0,4}|上一|下一|第[一二三])幕|本幕/.test(text))issues.push('scene-meta')
  if(/只做同学|只当朋友|不想约会|不想恋爱/.test(trigger)&&!/取消|不去|不等|作废|不见|别等/.test(trigger)&&/(?:东门|图书馆|之前|见面|等你|安排|约定)[^。！？\n]{0,22}(?:取消|作废|没提过|不用去)|(?:取消|作废)[^。！？\n]{0,18}(?:见面|安排|约定)/.test(text))issues.push('unasked-plan-cancellation')
 }
 if(context?.scriptId==='before-rain'&&context?.actor?.id==='letter'&&context?.sender?.id==='repair'&&/(?:八年前|当年|临行|临走).{0,12}你.{0,8}问(?:过)?我.{0,8}还有(?:没有|什么)话/.test(text))issues.push('past-speaker-reversal')
 return issues
}
export const SCRIPT_VOICE_REPAIR='上个草稿的格式、回忆依据或台词表达没有通过。重新回答原来的trigger，人物此刻只说自己想说的话。只返回一个JSON对象，且本次仅包含text和attitude两个字段。text是当前角色的自然发言；不要附加动作、线索发放、状态、阶段或其他字段。后台关于决定权、角色边界、尊重和事实校验的要求留在后台，用具体的反应或自己的意愿表达；减少反复的不是而是句式。对方在聊心情时，先回应眼前这个人，不自动背线索、时间或编号，也不推迟到核完材料再聊。若在回忆过去，删掉角色本或可见历史原文中找不到的逐字引语，不要补写玩家当年说过的话。保留固定人格和已经确认的事实。'
