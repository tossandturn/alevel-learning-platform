import { questionPartLabel } from '../src/data/questionParts.js'

const ROMAN_PART = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i
const PARENT_PART = /^([a-z])$/i
const CHILD_PART = /^([a-z])\((i|ii|iii|iv|v|vi|vii|viii|ix|x)\)$/i

function promptText(fragment) {
  return String(fragment?.promptFragment || fragment?.exactText || '').trim()
}

export function normaliseQuestionFragmentHierarchy(fragments) {
  let activeParent = ''
  const normalized = (fragments || []).map((fragment, index) => {
    let label = questionPartLabel(fragment, fragments.length === 1 ? 'a' : '')
    const questionLetter = String(fragment?.questionNumber || '').trim().match(/^[a-z]$/i)?.[0]?.toLowerCase() || ''
    const roman = label.match(ROMAN_PART)?.[1]?.toLowerCase() || ''
    const child = label.match(CHILD_PART)

    if (roman) {
      if (questionLetter) activeParent = questionLetter
      if (activeParent) label = `${activeParent}(${roman})`
    } else if (child) {
      activeParent = child[1].toLowerCase()
      label = `${activeParent}(${child[2].toLowerCase()})`
    } else if (PARENT_PART.test(label)) {
      activeParent = label.toLowerCase()
    }

    return { ...fragment, label, partId: label || fragment.partId, _sequence: index }
  })

  const childParents = new Set(normalized
    .map((fragment) => fragment.label.match(CHILD_PART)?.[1]?.toLowerCase())
    .filter(Boolean))
  const sharedPrompts = new Map()
  const firstChildSeen = new Set()

  return normalized
    .filter((fragment) => {
      const parent = fragment.label.match(PARENT_PART)?.[1]?.toLowerCase()
      if (!parent || !childParents.has(parent)) return true
      const prompt = promptText(fragment)
      if (prompt) sharedPrompts.set(parent, prompt)
      return false
    })
    .map((fragment) => {
      const parent = fragment.label.match(CHILD_PART)?.[1]?.toLowerCase()
      const sharedPrompt = parent && !firstChildSeen.has(parent) ? sharedPrompts.get(parent) : ''
      if (parent) firstChildSeen.add(parent)
      if (!sharedPrompt) return fragment
      const prompt = promptText(fragment)
      return {
        ...fragment,
        promptFragment: prompt ? `${sharedPrompt}\n${prompt}` : sharedPrompt,
      }
    })
    .map(({ _sequence, ...fragment }) => fragment)
}
