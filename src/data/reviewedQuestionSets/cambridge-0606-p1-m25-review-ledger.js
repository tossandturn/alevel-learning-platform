/* Explicit semantic review ledger for Cambridge 0606 M25 Paper 1. */

export const CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER_SCHEMA_VERSION = 'cambridge-0606-p1-m25-review-ledger.v1'

const reviewedAt = '2026-08-15T02:00:00+08:00'
const reviewedBy = 'Codex source-semantic-review / 0606-P1-M25'
const paperId = 'cie-0606-0606_m25_qp_12'

function row(questionNumber, topicId, pointId, questionPage, markSchemePage, parts) {
  return Object.freeze({
    questionNumber,
    topicId,
    pointId,
    questionPage,
    markSchemePage,
    parts: Object.freeze(parts.map((part) => Object.freeze({ ...part, questionPage: part.questionPage || questionPage }))),
    reviewedAt,
    reviewedBy,
  })
}

export const CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER = Object.freeze({
  schemaVersion: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER_SCHEMA_VERSION,
  paperId,
  questionPaperFile: '0606_m25_qp_12.pdf',
  markSchemeFile: '0606_m25_ms_12.pdf',
  questionCount: 12,
  totalMarks: 80,
  reviewedAt,
  reviewedBy,
  reviewMethod: 'paired-qp-ms-page-review',
  sourcePolicy: 'personal-study-restricted',
  rows: Object.freeze([
    row(1, 'math-0606-equations', 'math-0606-point-equations-01', 3, 6, [
      { label: 'a', marks: 3, promptFragment: 'On the axes, sketch the graphs of y = 4|x - 1| and y = |3x + 2|, stating the intercepts with the axes.', markSchemePoints: ['Fully correct ruled graphs with all intercepts indicated.'] },
      { label: 'b', marks: 4, promptFragment: 'Solve the inequality 4|x - 1| <= |3x + 2|.', markSchemePoints: ['Critical values 2/7 and 6; final interval 2/7 <= x <= 6.'] },
    ]),
    row(2, 'math-0606-trigonometry', 'math-0606-point-trigonometry-01', 4, 6, [
      { label: 'a', marks: 3, promptFragment: 'The diagram shows y = a cos(bx) + c for -180 degrees <= x <= 180 degrees. a, b and c are integers. Find a, b and c.', markSchemePoints: ['a = 5, b = 3, c = -2.'] },
    ]),
    row(3, 'math-0606-straight-line', 'math-0606-point-straight-line-01', 4, 7, [
      { label: 'a', marks: 4, promptFragment: 'A(-3, 6) and B(7, -8) are endpoints of a diameter of a circle. Find the equation of the circle.', markSchemePoints: ['Centre (2, -1), radius squared 74; equation (x - 2)^2 + (y + 1)^2 = 74.'] },
    ]),
    row(4, 'math-0606-quadratics', 'math-0606-point-quadratics-01', 5, 7, [
      { label: 'a', marks: 3, promptFragment: 'p(x) = a^2 x^3 + 2a x^2 + a x + 2, where a is a positive integer and 2x + 1 is a factor. Find a.', markSchemePoints: ['Use p(-1/2) = 0 and obtain a = 4.'] },
      { label: 'b', marks: 2, promptFragment: 'Hence factorise p(x).', markSchemePoints: ['p(x) = 2(2x + 1)(4x^2 + 1).'] },
      { label: 'c', marks: 1, promptFragment: 'Hence show that p(x) = 0 has only one real root.', markSchemePoints: ['4x^2 + 1 has no real roots, so the only real root is x = -1/2.'] },
    ]),
    row(5, 'math-0606-functions', 'math-0606-point-functions-01', 6, 8, [
      { label: 'a', marks: 3, promptFragment: 'Write 2x^2 - 2x + 3 in the form a(x + b)^2 + c.', markSchemePoints: ['2(x - 1/2)^2 + 5/2.'] },
      { label: 'b', marks: 1, promptFragment: 'For f(x) = 2x^2 - 2x + 3, x <= p, write down the greatest value of p for which f has an inverse.', markSchemePoints: ['p = 1/2.'] },
      { label: 'c', marks: 1, promptFragment: 'Using this value of p, write down the range of f.', markSchemePoints: ['f >= 5/2.'] },
      { label: 'd', marks: 3, promptFragment: 'Using this value of p, find an expression for f^-1.', markSchemePoints: ['f^-1(x) = 1/2 - sqrt((x - 5/2)/2), with the stated domain and range.'] },
    ]),
    row(6, 'math-0606-trigonometry', 'math-0606-point-trigonometry-01', 7, 8, [
      { label: 'a', marks: 2, promptFragment: 'tan(theta) = sqrt(5)/5 and 180 degrees < theta < 360 degrees. Find cos(theta).', markSchemePoints: ['cos(theta) = -sqrt(5/6).'] },
      { label: 'b', marks: 1, promptFragment: 'Find sin(theta).', markSchemePoints: ['sin(theta) = -sqrt(1/6).'] },
      { label: 'c', marks: 2, promptFragment: 'Find sec(theta) + cot(theta), giving the answer in the required exact form.', markSchemePoints: ['(5 - sqrt(6))/sqrt(5).'] },
    ]),
    row(7, 'math-0606-calculus', 'math-0606-point-calculus-01', 8, 9, [
      { label: 'a', marks: 4, promptFragment: 'The diagram shows y = 5/(x + 1) + 2 and y = 2x + 1 intersecting at A. Find the coordinates of A.', markSchemePoints: ['Solve the intersection equation and obtain A = (3/2, 4).'] },
      { label: 'b', questionPage: 9, marks: 6, promptFragment: 'Find the exact area of the shaded region.', markSchemePoints: ['Use the correct integral and trapezium area; exact area is 5 ln(5/2) - 3/4.'] },
    ]),
    row(8, 'math-0606-series', 'math-0606-point-series-01', 10, 10, [
      { label: 'a', marks: 6, promptFragment: 'A geometric progression and an arithmetic progression both have first term 10. The geometric ratio is positive and the arithmetic difference is negative. The second and third geometric terms equal the fourth and sixth arithmetic terms. Find r and d.', markSchemePoints: ['r = 2/3 and d = -10/9.'] },
      { label: 'b', marks: 1, promptFragment: 'Determine whether the geometric progression has a sum to infinity.', markSchemePoints: ['Yes, because |r| < 1.'] },
    ]),
    row(9, 'math-0606-indices', 'math-0606-point-indices-01', 11, 10, [
      { label: 'a', marks: 5, promptFragment: 'Solve log base 2 of (x + 1) - 4 log base (x + 1) of 2 = 3.', markSchemePoints: ['Let u = log base 2 of (x + 1), solve u^2 - 3u - 4 = 0, and obtain x = 15 or x = -1/2.'] },
    ]),
    row(10, 'math-0606-calculus', 'math-0606-point-calculus-01', 12, 11, [
      { label: 'a', marks: 9, promptFragment: 'P lies on y = (5x + 2)^(2/3) with x-coordinate 5. The normal at P meets x + y = 11 at Q. R is the reflection of Q in the tangent at P. Find the coordinates of R.', markSchemePoints: ['P = (5, 9), normal gradient -9/10, Q = (-25, 36), and R = (35, -18).'] },
    ]),
    row(11, 'math-0606-vectors', 'math-0606-point-vectors-01', 14, 11, [
      { label: 'a', marks: 3, promptFragment: 'In the diagram, OA = a and OB = b. M is the midpoint of OB, N satisfies ON = 3NA, and BN and AM meet at X. BX = lambda BN. Find OX in terms of a, b and lambda.', markSchemePoints: ['OX = b + lambda(3a/4 - b).'] },
      { label: 'b', questionPage: 15, marks: 2, promptFragment: 'Find OX in terms of a, b and mu.', markSchemePoints: ['OX = a + (1 - mu)(b/2 - a), equivalently b/2 + mu(a - b/2).'] },
      { label: 'c', questionPage: 15, marks: 4, promptFragment: 'Hence find the values of lambda and mu.', markSchemePoints: ['Equate coefficients and obtain lambda = 4/5 and mu = 3/5.'] },
    ]),
    row(12, 'math-0606-calculus', 'math-0606-point-calculus-01', 16, 12, [
      { label: 'a', marks: 3, promptFragment: 'It is given that y = x e^(3x + 2). Find dy/dx.', markSchemePoints: ['dy/dx = e^(3x + 2)(3x + 1).'] },
      { label: 'b', marks: 4, promptFragment: 'Hence find the integral of x e^(3x + 2) dx.', markSchemePoints: ['Integral = x e^(3x + 2)/3 - e^(3x + 2)/9 + c.'] },
    ]),
  ]),
})
