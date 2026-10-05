import assert from 'node:assert/strict'

import { parseCoachMessage } from '../src/lib/coachMessage.js'

const evaluation = Object.freeze({
  syntheticOnly: true,
  results: [{
    id: 'worked-calculus',
    status: 'PASS',
    prompt: 'For f(x) = 16/x^3 + 3x + 5, find all stationary points and check the derivative.',
    answer: String.raw`**概念与纠错**：你的错误在于求导时漏了负号。将函数改写为 $f(x) = 16x^{-3} + 3x + 5$。应用幂法则，正确的导数为 $f'(x) = -48x^{-4} + 3 = -\frac{48}{x^4} + 3$。

**方法与代入**：令 $f'(x) = 0$ 以求驻点：
$-\frac{48}{x^4} + 3 = 0 \implies \frac{48}{x^4} = 3 \implies x^4 = 16$
解得 $x = 2$ 或 $x = -2$。

**结果**：将 $x$ 值代入原函数 $f(x)$ 求纵坐标：
当 $x = 2$ 时，$y = \frac{16}{8} + 3(2) + 5 = 13$
当 $x = -2$ 时，$y = \frac{16}{-8} + 3(-2) + 5 = -3$
完整的驻点坐标为 $(2, 13)$ 和 $(-2, -3)$。

**检验**：将 $x = \pm 2$ 代入导数，$f'(\pm 2) = -\frac{48}{16} + 3 = -3 + 3 = 0$，斜率为零，结果正确。`,
  }],
})

assert.equal(evaluation.syntheticOnly, true, 'the frozen Coach evaluation must contain synthetic data only')
const calculus = evaluation.results?.find((result) => result?.id === 'worked-calculus')
assert.equal(calculus?.status, 'PASS', 'the frozen worked-calculus response must be present and complete')
assert.match(calculus.prompt, /f\(x\)\s*=\s*16\/x\^3\s*\+\s*3x\s*\+\s*5/, 'the frozen synthetic question must retain the original calculus prompt')

const rendered = parseCoachMessage(calculus.answer)
  .map((token) => token.type === 'break' ? '\n' : token.value || '')
  .join('')

assert.equal(
  parseCoachMessage('$a \\implies b$').map((token) => token.value || '').join(''),
  'a ⇒ b',
  'the common LaTeX implication command must render as a mathematical implication symbol',
)
assert.match(rendered, /-48\/x⁴ \+ 3/, 'the corrected derivative must preserve its leading negative sign')
assert.match(rendered, /x\s*=\s*±\s*2/, 'the plus-or-minus solution x = ±2 must remain readable')
assert.match(rendered, /\(2, 13\)/, 'the positive stationary point must remain readable')
assert.match(rendered, /\(-2, -3\)/, 'the negative stationary point must remain readable')
assert.match(rendered, /⇒/, 'the worked solution must contain rendered implication symbols')
assert.doesNotMatch(rendered, /\\(?:d?frac|tfrac|implies)\b|\bimplies\b/i, 'no raw fraction or implication command may leak into rendered Coach text')

console.log(JSON.stringify({ status: 'passed', source: 'inline-frozen-worked-calculus', syntheticOnly: evaluation.syntheticOnly }))
