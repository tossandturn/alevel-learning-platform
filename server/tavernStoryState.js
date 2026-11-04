import { TAVERN_STORIES, STORY_ACTIONS } from './tavernStoryBible.js'

export const STORY_STATE_VERSION = 'stem-tavern-story-state.v1'
const PREFIX = Object.freeze({ 'horror-guide': 'story-horror', 'mystery-guide': 'story-mystery', 'xianxia-guide': 'story-shenzhao', 'story-traveler': 'story-fantasy' })
const ACTION = /看|查|检查|观察|翻|读|听|询问|问问|核对|打开|inspect|examine|look|read|listen|check/i
const NEGATED = /不要|别(?:看|查|检查|翻|读|听|问|打开|揭秘|揭晓)|勿|不(?:看|查|检查|观察|翻|读|听|问|核对|打开|想|打算|去|揭晓|揭秘|结案)|以后|稍后|暂缓|假如|如果|假设|举例|不是要|don't|do not|not yet|if I|hypothetical/i
export function initialStoryState(persona) {
 if (!TAVERN_STORIES[persona]) return null
 return { schemaVersion: STORY_STATE_VERSION, persona, run: 1, stage: 'idle', clues: [], revealed: false, ending: '', paused: false, started: false }
}
export function normalizeStoryState(persona, value) {
 const initial = initialStoryState(persona)
 if (!initial || value?.schemaVersion !== STORY_STATE_VERSION || value.persona !== persona) return initial
 const story = TAVERN_STORIES[persona]
 const clues = [...new Set(Array.isArray(value.clues) ? value.clues : [])].filter(id => story.clues.some(clue => clue.id === id))
 const revealed = value.revealed === true && clues.length >= story.revealAfterClues
 const ending = revealed && story.endings.some(item => item.id === value.ending) ? value.ending : ''
 const state = { ...initial, run: Number.isSafeInteger(value.run) && value.run > 0 ? Math.min(value.run, 1000000) : 1, clues, revealed, ending, paused: value.paused === true, started: value.started === true || clues.length > 0 }
 state.stage = state.paused ? 'paused' : ending ? 'ending' : revealed ? 'reveal' : clues.length ? 'investigation' : state.started ? 'opening' : 'idle'
 return state
}
export function advanceStoryState(persona, previous, message) {
 let state = normalizeStoryState(persona, previous)
 if (!state) return null
 const text = String(message || '').normalize('NFKC').slice(0,12000)
 if (/重新开始(?:这个|这段|本次)?(?:故事|剧情|剧本)|重开(?:故事|剧情|剧本)/.test(text)) return { ...initialStoryState(persona), run: state.run + 1, started: true, stage: 'opening' }
 if (/暂停|先停|停一下|不玩了|不冒险了|聊点别的|换个话题/.test(text)) return normalizeStoryState(persona, { ...state, paused: true })
 if (/继续|接着|回到.*(?:故事|调查)|resume/i.test(text)) state.paused = false
 if (state.paused) return state
 if (/开始|进入|继续|剧情|剧本|冒险|查案|调查|讲.*(?:恐怖|悬疑)故事/.test(text)) state.started = true
 const clauses = text.split(/[，,。；;!?！？\n]+/).filter(Boolean)
 for (const action of STORY_ACTIONS[persona] || []) {
  if (clauses.some(clause => !NEGATED.test(clause) && (clause.trim() === action.label || ACTION.test(clause) && action.terms.some(term => clause.includes(term))))) {
   state.clues = [...new Set([...state.clues, action.id])]
   state.started = true
  }
 }
 if (state.clues.length >= TAVERN_STORIES[persona].revealAfterClues && /揭晓|揭秘|真相|结局|复盘|结案|到底怎么回事|reveal|solution/i.test(text) && !NEGATED.test(text)) state.revealed = true
 if (state.revealed) {
  const ending = TAVERN_STORIES[persona].endings.find(item => text.includes(item.title) && !NEGATED.test(text))
  if (ending) state.ending = ending.id
 }
 return normalizeStoryState(persona, state)
}
export function storySceneId(persona, state) {
 const value = normalizeStoryState(persona, state)
 if (!value?.started || value.paused) return ''
 const visualClues = { 'horror-guide': ['switch','logbook'], 'mystery-guide': ['reflection','dust'], 'xianxia-guide': ['log-edge','bell-mark'], 'story-traveler': ['bird-route'] }[persona]
 const investigation = visualClues.every(id => value.clues.includes(id))
 return PREFIX[persona] + (value.revealed ? '-resolution' : investigation ? '-investigation' : '-opening')
}
