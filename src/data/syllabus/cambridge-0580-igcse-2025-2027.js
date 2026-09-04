/*
 * Cambridge IGCSE Mathematics 0580, 2025-2027.
 *
 * The nine topic names and section codes mirror the official subject-content
 * chapters. The official PDF remains the source of truth for full outcomes.
 */

const ROUTE_ID = 'cie-0580-igcse-mathematics'
const SYLLABUS_VERSION = '2025-2027'
const OFFICIAL_URL = 'https://www.cambridgeinternational.org/Images/662466-2025-2027-syllabus.pdf'

export const CAMBRIDGE_0580_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '0580',
  syllabusVersion: SYLLABUS_VERSION,
  officialUrl: OFFICIAL_URL,
  subjectContentPages: Object.freeze([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]),
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'IGCSE', track: 'core', label: 'Non-calculator (Core)' }),
    Object.freeze({ component: 2, stage: 'IGCSE', track: 'extended', label: 'Non-calculator (Extended)' }),
    Object.freeze({ component: 3, stage: 'IGCSE', track: 'core', label: 'Calculator (Core)' }),
    Object.freeze({ component: 4, stage: 'IGCSE', track: 'extended', label: 'Calculator (Extended)' }),
  ]),
})

function point(topicId, sectionCode, officialText) {
  return Object.freeze({
    id: `math-0580-point-${sectionCode.replace('.', '-')}`,
    topicId,
    sectionCode,
    outcomeNumber: 1,
    officialText,
  })
}

function topic(code, name, order, officialPage, sections) {
  const id = `0580-igcse-topic-${String(code).padStart(2, '0')}`
  const points = sections.map(([sectionCode, officialText]) => point(id, sectionCode, officialText))
  return Object.freeze({
    id,
    routeId: ROUTE_ID,
    syllabusVersion: SYLLABUS_VERSION,
    code: String(code),
    name,
    order,
    officialPage,
    points: Object.freeze(points),
  })
}

export const CAMBRIDGE_0580_IGCSE_TOPICS = Object.freeze([
  topic(1, 'Number', 1, 12, [
    ['C1.1', 'Types of number'],
    ['C1.2', 'Sets'],
    ['C1.3', 'Powers and roots'],
    ['C1.4', 'Fractions, decimals and percentages'],
    ['C1.5', 'Ordering'],
    ['C1.6', 'The four operations'],
    ['C1.7', 'Indices I'],
    ['C1.8', 'Standard form'],
    ['C1.9', 'Estimation'],
    ['C1.10', 'Limits of accuracy'],
    ['C1.11', 'Ratio and proportion'],
    ['C1.12', 'Rates'],
    ['C1.13', 'Percentages'],
    ['C1.14', 'Using a calculator'],
    ['C1.15', 'Time'],
    ['C1.16', 'Money'],
  ]),
  topic(2, 'Algebra and graphs', 2, 17, [
    ['C2.1', 'Introduction to algebra'],
    ['C2.2', 'Algebraic manipulation'],
    ['C2.4', 'Indices II'],
    ['C2.5', 'Equations'],
    ['C2.6', 'Inequalities'],
    ['C2.7', 'Sequences'],
    ['C2.9', 'Graphs in practical situations'],
    ['C2.10', 'Graphs of functions'],
    ['C2.11', 'Sketching curves'],
  ]),
  topic(3, 'Coordinate geometry', 3, 20, [
    ['C3.1', 'Coordinates'],
    ['C3.2', 'Drawing linear graphs'],
    ['C3.3', 'Gradient of linear graphs'],
    ['C3.5', 'Equations of linear graphs'],
    ['C3.6', 'Parallel lines'],
  ]),
  topic(4, 'Geometry', 4, 21, [
    ['C4.1', 'Geometrical terms'],
    ['C4.2', 'Geometrical constructions'],
    ['C4.3', 'Scale drawings'],
    ['C4.4', 'Similarity'],
    ['C4.5', 'Symmetry'],
    ['C4.6', 'Angles'],
    ['C4.7', 'Circle theorems'],
  ]),
  topic(5, 'Mensuration', 5, 25, [
    ['C5.1', 'Units of measure'],
    ['C5.2', 'Area and perimeter'],
    ['C5.3', 'Circles, arcs and sectors'],
    ['C5.4', 'Surface area and volume'],
    ['C5.5', 'Compound shapes and parts of shapes'],
  ]),
  topic(6, 'Trigonometry', 6, 27, [
    ['C6.1', 'Pythagoras\' theorem'],
    ['C6.2', 'Right-angled triangles'],
  ]),
  topic(7, 'Transformations and vectors', 7, 28, [
    ['C7.1', 'Transformations'],
  ]),
  topic(8, 'Probability', 8, 29, [
    ['C8.1', 'Introduction to probability'],
    ['C8.2', 'Relative and expected frequencies'],
    ['C8.3', 'Probability of combined events'],
  ]),
  topic(9, 'Statistics', 9, 30, [
    ['C9.1', 'Classifying statistical data'],
    ['C9.2', 'Interpreting statistical data'],
    ['C9.3', 'Averages and range'],
    ['C9.4', 'Statistical charts and diagrams'],
    ['C9.5', 'Scatter diagrams'],
  ]),
])

export const CAMBRIDGE_0580_IGCSE_SYLLABUS = Object.freeze({
  ...CAMBRIDGE_0580_SYLLABUS_SOURCE,
  routeId: ROUTE_ID,
  topics: CAMBRIDGE_0580_IGCSE_TOPICS,
  points: Object.freeze(CAMBRIDGE_0580_IGCSE_TOPICS.flatMap(topicItem => topicItem.points)),
})
