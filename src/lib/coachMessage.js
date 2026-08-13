const LATEX_REPLACEMENTS = [
  [/\\lambda\b/g, 'λ'],
  [/\\mu\b/g, 'μ'],
  [/\\pi\b/g, 'π'],
  [/\\theta\b/g, 'θ'],
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\gamma\b/g, 'γ'],
  [/\\Delta\b/g, 'Δ'],
  [/\\times\b/g, '×'],
  [/\\cdot\b/g, '·'],
  [/\\pm\b/g, '±'],
  [/\\neq\b/g, '≠'],
  [/\\leq?\b/g, '≤'],
  [/\\geq?\b/g, '≥'],
  [/\\rightarrow\b/g, '→'],
  [/\\degree\b/g, '°'],
]

const SUPERSCRIPT = Object.freeze({
  0: '⁰',
  1: '¹',
  2: '²',
  3: '³',
  4: '⁴',
  5: '⁵',
  6: '⁶',
  7: '⁷',
  8: '⁸',
  9: '⁹',
  '+': '⁺',
  '-': '⁻',
  '(': '⁽',
  ')': '⁾',
})

const SUBSCRIPT = Object.freeze({
  0: '₀',
  1: '₁',
  2: '₂',
  3: '₃',
  4: '₄',
  5: '₅',
  6: '₆',
  7: '₇',
  8: '₈',
  9: '₉',
  '+': '₊',
  '-': '₋',
  '(': '₍',
  ')': '₎',
})

function subscript(value) {
  return [...String(value || '')].map((character) => SUBSCRIPT[character] || character).join('')
}

function superscript(value) {
  return [...String(value || '')].map((character) => SUPERSCRIPT[character] || character).join('')
}

function normalizeMath(value) {
  let result = String(value || '').trim()
  result = result.replace(/\\xrightarrow\s*\{\s*\\text\s*\{([^{}]+)\}\s*\}/g, ' --$1→ ')
  result = result.replace(/\\text\s*\{([^{}]+)\}/g, '$1')
  result = result.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1/$2')
  result = result.replace(/\^\{([^{}]+)\}/g, '^$1')
  result = result.replace(/_\{([^{}]+)\}/g, '_$1')
  for (const [pattern, replacement] of LATEX_REPLACEMENTS) result = result.replace(pattern, replacement)
  result = result.replace(/([A-Za-z0-9)])\^([0-9+\-()]+)/g, (_, base, exponent) => (
    `${base}${superscript(exponent)}`
  ))
  result = result.replace(/([A-Za-z0-9)])_([0-9+\-()]+)/g, (_, base, value) => (
    `${base}${subscript(value)}`
  ))
  result = result.replace(/(\d+\/\d+)(?=[A-Za-z])/g, '$1 ')
  return result.replace(/\s+/g, ' ').trim()
}

function normalizeLegacyText(value) {
  let result = String(value || '')
  result = result.replace(/\\xrightarrow\s*\{\s*\\text\s*\{([^{}]+)\}\s*\}/g, ' --$1→ ')
  result = result.replace(/\\text\s*\{([^{}]+)\}/g, '$1')
  result = result.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '$1/$2')
  result = result.replace(/\^\{([^{}]+)\}/g, '^$1')
  result = result.replace(/_\{([^{}]+)\}/g, '_$1')
  for (const [pattern, replacement] of LATEX_REPLACEMENTS) result = result.replace(pattern, replacement)
  result = result.replace(/([A-Za-z0-9)])\^([0-9+\-()]+)/g, (_, base, exponent) => (
    `${base}${superscript(exponent)}`
  ))
  result = result.replace(/([A-Za-z0-9)])_([0-9+\-()]+)/g, (_, base, value) => (
    `${base}${subscript(value)}`
  ))
  return result.replace(/\$+/g, '').replace(/\*\*/g, '')
}

function pushText(tokens, type, value) {
  if (!value) return
  const normalized = type === 'text'
    ? normalizeLegacyText(value)
    : type === 'bold' || type === 'math'
      ? normalizeMath(value)
      : String(value)
  if (!normalized) return
  const previous = tokens.at(-1)
  if (previous?.type === type) previous.value += normalized
  else tokens.push({ type, value: normalized })
}

function parseInline(value, tokens) {
  let remaining = String(value || '')
  while (remaining) {
    const blockMathMatch = remaining.match(/\$\$([^$]+)\$\$/)
    const mathMatch = remaining.match(/\$([^$]+)\$/)
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/)
    const matches = [
      blockMathMatch && { match: blockMathMatch, type: 'math', value: normalizeMath(blockMathMatch[1]) },
      mathMatch && { match: mathMatch, type: 'math', value: normalizeMath(mathMatch[1]) },
      boldMatch && { match: boldMatch, type: 'bold', value: boldMatch[1] },
    ].filter(Boolean).sort((left, right) => left.match.index - right.match.index)
    const next = matches[0]
    if (!next) {
      pushText(tokens, 'text', remaining)
      break
    }
    pushText(tokens, 'text', remaining.slice(0, next.match.index))
    pushText(tokens, next.type, next.value)
    remaining = remaining.slice(next.match.index + next.match[0].length)
  }
}

export function parseCoachMessage(value) {
  const tokens = []
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
      pushText(tokens, 'bold', trimmed.slice(2, -2))
    } else {
      parseInline(line, tokens)
    }
    if (index < lines.length - 1) tokens.push({ type: 'break' })
  })
  return tokens
}
