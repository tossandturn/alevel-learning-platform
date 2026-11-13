/*
 * Cambridge International AS & A Level Chemistry 9701, 2025-2027.
 *
 * Topic codes and names follow the official subject-content headings. The
 * practical papers remain in the assessment metadata, but Chapter Study uses
 * the theory topics assessed by Papers 1/2 at AS and Paper 4 at A2.
 */

export const CAMBRIDGE_9701_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '9701',
  syllabusVersion: '2025-2027',
  officialUrl: 'https://www.cambridgeinternational.org/Images/664563-2025-2027-syllabus.pdf',
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'AS', track: 'theory', label: 'Paper 1 Multiple Choice' }),
    Object.freeze({ component: 2, stage: 'AS', track: 'theory', label: 'Paper 2 AS Level Structured Questions' }),
    Object.freeze({ component: 3, stage: 'AS', track: 'practical', label: 'Paper 3 Advanced Practical Skills' }),
    Object.freeze({ component: 4, stage: 'A2', track: 'theory', label: 'Paper 4 A Level Structured Questions' }),
    Object.freeze({ component: 5, stage: 'A2', track: 'practical', label: 'Paper 5 Planning, Analysis and Evaluation' }),
  ]),
})

const AS_ROWS = Object.freeze([
  ['9701-as-topic-01-atomic-structure', '1', 'Atomic structure'],
  ['9701-as-topic-02-stoichiometry', '2', 'Atoms, molecules and stoichiometry'],
  ['9701-as-topic-03-bonding', '3', 'Chemical bonding'],
  ['9701-as-topic-04-states-of-matter', '4', 'States of matter'],
  ['9701-as-topic-05-energetics', '5', 'Chemical energetics'],
  ['9701-as-topic-06-electrochemistry', '6', 'Electrochemistry'],
  ['9701-as-topic-07-equilibria', '7', 'Equilibria'],
  ['9701-as-topic-08-kinetics', '8', 'Reaction kinetics'],
  ['9701-as-topic-09-periodicity', '9', 'The Periodic Table: chemical periodicity'],
  ['9701-as-topic-10-group-2', '10', 'Group 2'],
  ['9701-as-topic-11-group-17', '11', 'Group 17'],
  ['9701-as-topic-12-nitrogen-sulfur', '12', 'Nitrogen and sulfur'],
  ['9701-as-topic-13-organic-introduction', '13', 'An introduction to AS Level organic chemistry'],
  ['9701-as-topic-14-hydrocarbons', '14', 'Hydrocarbons'],
  ['9701-as-topic-15-halogen-compounds', '15', 'Halogen compounds'],
  ['9701-as-topic-16-hydroxy-compounds', '16', 'Hydroxy compounds'],
  ['9701-as-topic-17-carbonyl-compounds', '17', 'Carbonyl compounds'],
  ['9701-as-topic-18-carboxylic-acids', '18', 'Carboxylic acids and derivatives'],
  ['9701-as-topic-19-nitrogen-compounds', '19', 'Nitrogen compounds'],
  ['9701-as-topic-20-polymerisation', '20', 'Polymerisation'],
  ['9701-as-topic-21-organic-synthesis', '21', 'Organic synthesis'],
  ['9701-as-topic-22-analytical-techniques', '22', 'Analytical techniques'],
])

const A2_ROWS = Object.freeze([
  ['9701-a2-topic-23-energetics', '23', 'Chemical energetics'],
  ['9701-a2-topic-24-electrochemistry', '24', 'Electrochemistry'],
  ['9701-a2-topic-25-equilibria', '25', 'Equilibria'],
  ['9701-a2-topic-26-kinetics', '26', 'Reaction kinetics'],
  ['9701-a2-topic-27-group-2', '27', 'Group 2'],
  ['9701-a2-topic-28-transition-elements', '28', 'Chemistry of transition elements'],
  ['9701-a2-topic-29-organic-introduction', '29', 'An introduction to A Level organic chemistry'],
  ['9701-a2-topic-30-hydrocarbons', '30', 'Hydrocarbons'],
  ['9701-a2-topic-31-halogen-compounds', '31', 'Halogen compounds'],
  ['9701-a2-topic-32-hydroxy-compounds', '32', 'Hydroxy compounds'],
  ['9701-a2-topic-33-carboxylic-acids', '33', 'Carboxylic acids and derivatives'],
  ['9701-a2-topic-34-nitrogen-compounds', '34', 'Nitrogen compounds'],
  ['9701-a2-topic-35-polymerisation', '35', 'Polymerisation'],
  ['9701-a2-topic-36-organic-synthesis', '36', 'Organic synthesis'],
  ['9701-a2-topic-37-analytical-techniques', '37', 'Analytical techniques'],
])

function topics(rows, stage, components) {
  return Object.freeze(rows.map(([id, code, name], index) => Object.freeze({
    id,
    code,
    name,
    order: index + 1,
    syllabusVersion: CAMBRIDGE_9701_SYLLABUS_SOURCE.syllabusVersion,
    officialUrl: CAMBRIDGE_9701_SYLLABUS_SOURCE.officialUrl,
    componentScope: Object.freeze({ components: Object.freeze([...components]), stage, track: 'theory' }),
    points: Object.freeze([]),
  })))
}

export const CAMBRIDGE_9701_AS_TOPICS = topics(AS_ROWS, 'AS', [1, 2])
export const CAMBRIDGE_9701_A2_TOPICS = topics(A2_ROWS, 'A2', [4])

function syllabus(stage, stageTopics) {
  return Object.freeze({
    ...CAMBRIDGE_9701_SYLLABUS_SOURCE,
    stage,
    topics: stageTopics,
    assessmentComponents: Object.freeze(CAMBRIDGE_9701_SYLLABUS_SOURCE.assessmentComponents.filter((item) => item.stage === stage)),
    componentScope: Object.freeze(CAMBRIDGE_9701_SYLLABUS_SOURCE.assessmentComponents
      .filter((item) => item.stage === stage && item.track === 'theory')
      .map((item) => Object.freeze({ ...item, notes: Object.freeze([]) }))),
  })
}

export const CAMBRIDGE_9701_AS_SYLLABUS = syllabus('AS', CAMBRIDGE_9701_AS_TOPICS)
export const CAMBRIDGE_9701_A2_SYLLABUS = syllabus('A2', CAMBRIDGE_9701_A2_TOPICS)
