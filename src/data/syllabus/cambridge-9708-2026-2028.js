/* Cambridge International AS & A Level Economics 9708, 2026-2028. */

export const CAMBRIDGE_9708_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '9708',
  syllabusVersion: '2026-2028',
  officialUrl: 'https://www.cambridgeinternational.org/Images/697423-2026-2028-syllabus.pdf',
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'AS', track: 'theory', label: 'Paper 1 AS Level Multiple Choice' }),
    Object.freeze({ component: 2, stage: 'AS', track: 'theory', label: 'Paper 2 AS Level Data Response and Essays' }),
    Object.freeze({ component: 3, stage: 'A2', track: 'theory', label: 'Paper 3 A Level Multiple Choice' }),
    Object.freeze({ component: 4, stage: 'A2', track: 'theory', label: 'Paper 4 A Level Data Response and Essays' }),
  ]),
})

const AS_ROWS = Object.freeze([
  ['9708-as-topic-1-1', '1.1', 'Scarcity, choice and opportunity cost'],
  ['9708-as-topic-1-2', '1.2', 'Economic methodology'],
  ['9708-as-topic-1-3', '1.3', 'Factors of production'],
  ['9708-as-topic-1-4', '1.4', 'Resource allocation in different economic systems'],
  ['9708-as-topic-1-5', '1.5', 'Production possibility curves'],
  ['9708-as-topic-1-6', '1.6', 'Classification of goods and services'],
  ['9708-as-topic-2-1', '2.1', 'Demand and supply curves'],
  ['9708-as-topic-2-2', '2.2', 'Price elasticity, income elasticity and cross elasticity of demand'],
  ['9708-as-topic-2-3', '2.3', 'Price elasticity of supply'],
  ['9708-as-topic-2-4', '2.4', 'The interaction of demand and supply'],
  ['9708-as-topic-2-5', '2.5', 'Consumer and producer surplus'],
  ['9708-as-topic-3-1', '3.1', 'Reasons for government intervention in markets'],
  ['9708-as-topic-3-2', '3.2', 'Methods and effects of government intervention in markets'],
  ['9708-as-topic-3-3', '3.3', 'Addressing income and wealth inequality'],
  ['9708-as-topic-4-1', '4.1', 'National income statistics'],
  ['9708-as-topic-4-2', '4.2', 'Introduction to the circular flow of income'],
  ['9708-as-topic-4-3', '4.3', 'Aggregate Demand and Aggregate Supply analysis'],
  ['9708-as-topic-4-4', '4.4', 'Economic growth'],
  ['9708-as-topic-4-5', '4.5', 'Unemployment'],
  ['9708-as-topic-4-6', '4.6', 'Price stability'],
  ['9708-as-topic-5-1', '5.1', 'Government macroeconomic policy objectives'],
  ['9708-as-topic-5-2', '5.2', 'Fiscal policy'],
  ['9708-as-topic-5-3', '5.3', 'Monetary policy'],
  ['9708-as-topic-5-4', '5.4', 'Supply-side policy'],
  ['9708-as-topic-6-1', '6.1', 'The reasons for international trade'],
  ['9708-as-topic-6-2', '6.2', 'Protectionism'],
  ['9708-as-topic-6-3', '6.3', 'Current account of the balance of payments'],
  ['9708-as-topic-6-4', '6.4', 'Exchange rates'],
  ['9708-as-topic-6-5', '6.5', 'Policies to correct imbalances in the current account of the balance of payments'],
])

const A2_ROWS = Object.freeze([
  ['9708-a2-topic-7-1', '7.1', 'Utility'],
  ['9708-a2-topic-7-2', '7.2', 'Indifference curves and budget lines'],
  ['9708-a2-topic-7-3', '7.3', 'Efficiency and market failure'],
  ['9708-a2-topic-7-4', '7.4', 'Private costs and benefits, externalities and social costs and benefits'],
  ['9708-a2-topic-7-5', '7.5', 'Types of cost, revenue and profit, short-run and long-run production'],
  ['9708-a2-topic-7-6', '7.6', 'Different market structures'],
  ['9708-a2-topic-7-7', '7.7', 'Growth and survival of firms'],
  ['9708-a2-topic-7-8', '7.8', 'Differing objectives and policies of firms'],
  ['9708-a2-topic-8-1', '8.1', 'Government policies to achieve efficient resource allocation and correct market failure'],
  ['9708-a2-topic-8-2', '8.2', 'Equity and redistribution of income and wealth'],
  ['9708-a2-topic-8-3', '8.3', 'Labour market forces and government intervention'],
  ['9708-a2-topic-9-1', '9.1', 'The circular flow of income'],
  ['9708-a2-topic-9-2', '9.2', 'Economic growth and sustainability'],
  ['9708-a2-topic-9-3', '9.3', 'Employment and unemployment'],
  ['9708-a2-topic-9-4', '9.4', 'Money and banking'],
  ['9708-a2-topic-10-1', '10.1', 'Government macroeconomic policy objectives'],
  ['9708-a2-topic-10-2', '10.2', 'Links between macroeconomic problems and their interrelatedness'],
  ['9708-a2-topic-10-3', '10.3', 'Effectiveness of policy options to meet all macroeconomic objectives'],
  ['9708-a2-topic-11-1', '11.1', 'Policies to correct disequilibrium in the balance of payments'],
  ['9708-a2-topic-11-2', '11.2', 'Exchange rates'],
  ['9708-a2-topic-11-3', '11.3', 'Economic development'],
  ['9708-a2-topic-11-4', '11.4', 'Characteristics of countries at different levels of development'],
  ['9708-a2-topic-11-5', '11.5', 'Relationship between countries at different levels of development'],
  ['9708-a2-topic-11-6', '11.6', 'Globalisation'],
])

function topics(rows, stage, components) {
  return Object.freeze(rows.map(([id, code, name], index) => Object.freeze({
    id,
    code,
    name,
    order: index + 1,
    syllabusVersion: CAMBRIDGE_9708_SYLLABUS_SOURCE.syllabusVersion,
    officialUrl: CAMBRIDGE_9708_SYLLABUS_SOURCE.officialUrl,
    componentScope: Object.freeze({ components: Object.freeze([...components]), stage, track: 'theory' }),
    points: Object.freeze([]),
  })))
}

export const CAMBRIDGE_9708_AS_TOPICS = topics(AS_ROWS, 'AS', [1, 2])
export const CAMBRIDGE_9708_A2_TOPICS = topics(A2_ROWS, 'A2', [3, 4])

function syllabus(stage, stageTopics) {
  return Object.freeze({
    ...CAMBRIDGE_9708_SYLLABUS_SOURCE,
    stage,
    topics: stageTopics,
    assessmentComponents: Object.freeze(CAMBRIDGE_9708_SYLLABUS_SOURCE.assessmentComponents.filter((item) => item.stage === stage)),
    componentScope: Object.freeze(CAMBRIDGE_9708_SYLLABUS_SOURCE.assessmentComponents
      .filter((item) => item.stage === stage)
      .map((item) => Object.freeze({ ...item, notes: Object.freeze([]) }))),
  })
}

export const CAMBRIDGE_9708_AS_SYLLABUS = syllabus('AS', CAMBRIDGE_9708_AS_TOPICS)
export const CAMBRIDGE_9708_A2_SYLLABUS = syllabus('A2', CAMBRIDGE_9708_A2_TOPICS)
