/*
 * Cambridge IGCSE Additional Mathematics 0606, 2025-2027.
 * Topic ids deliberately reuse the established curriculum ids so the
 * syllabus mapping and the legacy curriculum do not create duplicate cards.
 */

const officialUrl = 'https://www.cambridgeinternational.org/Images/662470-2025-2027-syllabus.pdf'

const topicDefinitions = [
  ['math-0606-functions', '1', 'Functions'],
  ['math-0606-quadratics', '2', 'Quadratics and polynomials'],
  ['math-0606-equations', '3', 'Equations, inequalities and graphs'],
  ['math-0606-indices', '4', 'Indices, surds and logarithms'],
  ['math-0606-factors', '5', 'Factors of polynomials'],
  ['math-0606-simultaneous', '6', 'Simultaneous equations'],
  ['math-0606-logarithmic', '7', 'Logarithmic and exponential functions'],
  ['math-0606-straight-line', '8', 'Straight-line graphs'],
  ['math-0606-circular-measure', '9', 'Circular measure'],
  ['math-0606-trigonometry', '10', 'Trigonometry'],
  ['math-0606-permutations', '11', 'Permutations and combinations'],
  ['math-0606-series', '12', 'Series'],
  ['math-0606-vectors', '13', 'Vectors'],
  ['math-0606-calculus', '14', 'Calculus'],
]

export const CAMBRIDGE_0606_IGCSE_SYLLABUS = Object.freeze({
  routeId: 'cie-0606-igcse-additional-mathematics',
  syllabusVersion: '2025-2027',
  officialUrl,
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'IGCSE', track: 'theory', label: 'Paper 1' }),
    Object.freeze({ component: 2, stage: 'IGCSE', track: 'theory', label: 'Paper 2' }),
  ]),
  topics: Object.freeze(topicDefinitions.map(([id, code, name], index) => Object.freeze({
    id,
    routeId: 'cie-0606-igcse-additional-mathematics',
    syllabusVersion: '2025-2027',
    code,
    name,
    order: index + 1,
    officialPage: null,
    points: Object.freeze([]),
  }))),
  points: Object.freeze([
    Object.freeze({
      id: 'math-0606-point-equations-01',
      topicId: 'math-0606-equations',
      sectionCode: '3',
      outcomeNumber: 1,
      officialText: 'Solve equations and inequalities and interpret their graphical representation.',
    }),
    Object.freeze({
      id: 'math-0606-point-trigonometry-01',
      topicId: 'math-0606-trigonometry',
      sectionCode: '10',
      outcomeNumber: 1,
      officialText: 'Use trigonometric ratios, identities and equations in exact form.',
    }),
    Object.freeze({
      id: 'math-0606-point-straight-line-01',
      topicId: 'math-0606-straight-line',
      sectionCode: '8',
      outcomeNumber: 1,
      officialText: 'Use coordinate geometry of straight lines and circles.',
    }),
    Object.freeze({
      id: 'math-0606-point-quadratics-01',
      topicId: 'math-0606-quadratics',
      sectionCode: '2',
      outcomeNumber: 1,
      officialText: 'Use factors, discriminants and polynomial reasoning.',
    }),
    Object.freeze({
      id: 'math-0606-point-functions-01',
      topicId: 'math-0606-functions',
      sectionCode: '1',
      outcomeNumber: 1,
      officialText: 'Use function notation, inverses, domains and ranges.',
    }),
    Object.freeze({
      id: 'math-0606-point-calculus-01',
      topicId: 'math-0606-calculus',
      sectionCode: '14',
      outcomeNumber: 1,
      officialText: 'Differentiate and integrate functions and apply calculus.',
    }),
    Object.freeze({
      id: 'math-0606-point-series-01',
      topicId: 'math-0606-series',
      sectionCode: '12',
      outcomeNumber: 1,
      officialText: 'Use sequences, series and their sums.',
    }),
    Object.freeze({
      id: 'math-0606-point-indices-01',
      topicId: 'math-0606-indices',
      sectionCode: '4',
      outcomeNumber: 1,
      officialText: 'Manipulate indices, surds, logarithms and exponentials.',
    }),
    Object.freeze({
      id: 'math-0606-point-vectors-01',
      topicId: 'math-0606-vectors',
      sectionCode: '13',
      outcomeNumber: 1,
      officialText: 'Use vectors to solve two-dimensional geometrical problems.',
    }),
  ]),
})
