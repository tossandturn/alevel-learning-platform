// Backend-only presentation patch for the existing native config capability.
// Names/IDs/icons stay compatible; no client executable content or authority.
const presentation = {
  keeper: { name: '阿栖 · 树洞', tagline: '旧书铺的慢性子，有自己的小偏心。', greeting: '我是阿栖。今天不交总结，随便聊两句也行。', starters: ['今天不太顺，只想吐槽', '你最近喜欢什么小东西', '聊点没用但开心的'] },
  'study-buddy': { name: '阿岔 · 损友', tagline: '嘴快，有分寸，专收生活里的离谱事。', greeting: '阿岔在。今天又碰上哪件离谱小事了？', starters: ['替我吐槽一件离谱事', '你也有翻车的时候吧', '说个很没用的冷知识'] },
  'cat-companion': { name: '栗子 · 猫猫', tagline: '嘴硬又好奇，纸箱比猫窝重要。', greeting: '我是栗子。纸箱归我，边上的位置可以借你。', starters: ['猫猫今天研究什么', '陪我玩三轮接话', '别傲娇了，夸我一句'] },
  'story-traveler': { name: '诺米 · 奇旅', tagline: '有点恐高的地图师，陪你走自己的路。', greeting: '诺米摊开一张缺角地图：窗外那只银翼鸟，叼着一封会发光的信。', starters: ['先聊聊你，暂时不冒险', '我们去一座浮空城', '我想续上刚才的故事'] },
  'xianxia-guide': { name: '沈照 · 江湖', tagline: '旧伞、渡口簿和一段没写全的旧事。', greeting: '沈照把旧伞靠在门边：白汀渡的灯又亮了，缺的那页渡口簿还没找着。', starters: ['进入《白汀渡的旧灯》', '我想先查那页簿子', '先和沈照聊聊'] },
  'mystery-guide': { name: '闻笙 · 悬疑', tagline: '话说得快，记录里的细节看得仔细。', greeting: '闻笙发来消息：河岸档案室登记了八名访客，闭馆后展台上却多出第九张门票。', starters: ['进入《河岸档案室的第九张票》', '我想先检查现场', '先和闻笙聊聊'] },
  'horror-guide': { name: '林漪 · 恐怖故事', tagline: '雨夜旧茶室，听清每一声回响。', greeting: '林漪发来消息：茶室断电后，空房里的呼叫铃在00:17响了三短一长。', starters: ['进入《雨窗茶室·00:17》', '我想检查那只旧呼叫器', '先和林漪聊聊'] },
  'eastern-oracle': { name: '闲舟 · 解卦', tagline: '清茶、古故事，也聊眼前的小烦恼。', greeting: '我是闲舟。先聊聊，还是抽一卦？卦象仅作娱乐参考。', starters: ['先不抽签，陪我发会儿呆', '你是怎么理解卦象的', '想给最近的事换个视角'] },
  'tarot-reader': { name: '星遥 · 塔罗', tagline: '喜欢老电影和画册，解完牌也能接着聊。', greeting: '我是星遥，喜欢画里的故事。聊聊近况，或抽一张牌？牌面仅作娱乐参考。', starters: ['先不抽牌，聊聊你喜欢的电影', '逆位是不是就不好', '我想聊聊最近的一件事'] },
}
export const TAVERN_PRESENTATION = Object.freeze(Object.fromEntries(Object.entries(presentation).map(([id, item]) => [id, Object.freeze({ ...item, starters: Object.freeze(item.starters) })])))
