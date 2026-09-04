const LATEX_REPLACEMENTS = new Map([
  ['lambda', 'λ'],
  ['mu', 'μ'],
  ['pi', 'π'],
  ['theta', 'θ'],
  ['alpha', 'α'],
  ['beta', 'β'],
  ['gamma', 'γ'],
  ['Delta', 'Δ'],
  ['times', '×'],
  ['cdot', '·'],
  ['pm', '±'],
  ['neq', '≠'],
  ['le', '≤'],
  ['leq', '≤'],
  ['ge', '≥'],
  ['geq', '≥'],
  ['rightarrow', '→'],
  ['to', '→'],
  ['degree', '°'],
  ['infty', '∞'],
])

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
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
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
  '=': '₌',
  '(': '₍',
  ')': '₎',
  x: 'ₓ',
})

const BOLD_LATIN = Object.freeze({
  ...Object.fromEntries([...Array(26)].map((_, index) => {
    const character = String.fromCharCode(65 + index)
    return [character, String.fromCodePoint(0x1D400 + index)]
  })),
  ...Object.fromEntries([...Array(26)].map((_, index) => {
    const character = String.fromCharCode(97 + index)
    return [character, String.fromCodePoint(0x1D41A + index)]
  })),
})

function subscript(value) {
  return [...String(value || '')].map((character) => SUBSCRIPT[character] || character).join('')
}

function superscript(value) {
  return [...String(value || '')].map((character) => SUPERSCRIPT[character] || character).join('')
}

function boldMath(value) {
  return [...String(value || '')].map((character) => BOLD_LATIN[character] || character).join('')
}

function readBracedGroup(source, start) {
  if (source[start] !== '{') return null
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] !== '}') continue
    depth -= 1
    if (depth === 0) return { content: source.slice(start + 1, index), end: index + 1 }
  }
  return null
}

function skipSpaces(source, index) {
  let next = index
  while (/\s/.test(source[next] || '')) next += 1
  return next
}

function readArgument(source, start) {
  const index = skipSpaces(source, start)
  const group = readBracedGroup(source, index)
  if (group) return group
  if (index >= source.length) return { content: '', end: index }
  return { content: source[index], end: index + 1 }
}

function renderSubscriptArgument(source, start, kind) {
  const argument = readArgument(source, start)
  const value = renderMath(argument.content)
  const convert = kind === 'superscript' ? superscript : subscript
  const converted = convert(value)
  return {
    end: argument.end,
    value: converted === value ? `${kind === 'superscript' ? '^' : '_'}${value}` : converted,
  }
}

function renderEnvironment(source, start) {
  const environment = readArgument(source, start)
  const name = environment.content.trim()
  if (!name) return null
  const endPattern = new RegExp(`\\\\end\\s*\\{\\s*${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\}`)
  const rest = source.slice(environment.end)
  const endMatch = rest.match(endPattern)
  if (!endMatch) return { end: environment.end, value: renderMath(rest) }
  const content = rest.slice(0, endMatch.index)
  const end = environment.end + endMatch.index + endMatch[0].length
  if (/^(?:p|b|B|v)?matrix$/.test(name)) {
    const rows = content
      .split(/\\{2,}/g)
      .map((row) => row.replace(/\[[^\]]*\]\s*$/, '').trim())
      .filter(Boolean)
      .map((row) => row.split('&').map((cell) => renderMath(cell)).join(', '))
    return { end, value: `[${rows.join('; ')}]` }
  }
  return { end, value: renderMath(content) }
}

function renderMath(value) {
  const source = String(value || '')
  const output = []
  let index = 0

  while (index < source.length) {
    const character = source[index]
    if (character === '^' || character === '_') {
      const argument = renderSubscriptArgument(source, index + 1, character === '^' ? 'superscript' : 'subscript')
      output.push(argument.value)
      index = argument.end
      continue
    }
    if (character === '{') {
      const group = readBracedGroup(source, index)
      if (group) {
        output.push(renderMath(group.content))
        index = group.end
        continue
      }
    }
    if (character !== '\\') {
      output.push(character)
      index += 1
      continue
    }

    if (source[index + 1] === '\\') {
      output.push(' ')
      index += 2
      continue
    }
    const commandMatch = source.slice(index + 1).match(/^([A-Za-z]+|.)/)
    if (!commandMatch) {
      index += 1
      continue
    }
    const command = commandMatch[1]
    index += commandMatch[0].length + 1

    if (command === 'begin') {
      const environment = renderEnvironment(source, index)
      if (environment) {
        output.push(environment.value)
        index = environment.end
      }
      continue
    }
    if (command === 'end') {
      const ignored = readArgument(source, index)
      index = ignored.end
      continue
    }
    if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
      const numerator = readArgument(source, index)
      const denominator = readArgument(source, numerator.end)
      output.push(`${renderMath(numerator.content)}/${renderMath(denominator.content)}`)
      index = denominator.end
      continue
    }
    if (command === 'vec' || command === 'overrightarrow') {
      const argument = readArgument(source, index)
      output.push(`${renderMath(argument.content)}⃗`)
      index = argument.end
      continue
    }
    if (command === 'mathbf' || command === 'boldsymbol' || command === 'bm') {
      const argument = readArgument(source, index)
      output.push(boldMath(renderMath(argument.content)))
      index = argument.end
      continue
    }
    if (command === 'text' || command === 'textbf' || command === 'mathrm' || command === 'mathit' || command === 'operatorname') {
      const argument = readArgument(source, index)
      output.push(renderMath(argument.content))
      index = argument.end
      continue
    }
    if (command === 'xrightarrow') {
      const argument = readArgument(source, index)
      output.push(` --${renderMath(argument.content)}→ `)
      index = argument.end
      continue
    }
    if (command === 'left' || command === 'right') continue
    if (command === 'qquad' || command === 'quad' || command === 'enspace' || command === ',' || command === ';' || command === ':' || command === '!') {
      output.push(' ')
      continue
    }
    if (command === '(' || command === ')' || command === '[' || command === ']') continue
    output.push(LATEX_REPLACEMENTS.get(command) || command)
  }

  return output.join('')
}

function normalizeMathDelimiters(value) {
  let result = String(value || '')
  result = result.replace(/\\\[([\s\S]*?)\\\]/g, (_, content) => `$$${content.trim()}$$`)
  result = result.replace(/\\\(([\s\S]*?)\\\)/g, (_, content) => `$${content}$`)
  return result
}

function normalizeMath(value) {
  return renderMath(String(value || ''))
    .replace(/(\d+\/\d+)(?=[A-Za-z])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLegacyText(value) {
  return renderMath(String(value || '').replace(/\$+/g, '').replace(/\*\*/g, ''))
    .replace(/\s+/g, ' ')
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
    const blockMathMatch = remaining.match(/\$\$([\s\S]*?)\$\$/)
    const mathMatch = remaining.match(/\$([^$]+?)\$/)
    const boldMatch = remaining.match(/\*\*([^*]+?)\*\*/)
    const matches = [
      blockMathMatch && { match: blockMathMatch, type: 'math', value: blockMathMatch[1] },
      mathMatch && { match: mathMatch, type: 'math', value: mathMatch[1] },
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
  const lines = normalizeMathDelimiters(value).replace(/\r\n?/g, '\n').split('\n')
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
