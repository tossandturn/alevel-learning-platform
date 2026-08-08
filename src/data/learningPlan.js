/*
 * Student-facing learning-plan metadata.
 *
 * This file describes curriculum themes and study workflows only. It does not
 * contain official question text, mark schemes, grade boundaries, or claims
 * about the contents of a particular paper session.
 */

import { additionalKnowledgeGroups, additionalSubjects, curriculumSources } from './curriculumContent.js'
import { courseRoutes, LEGACY_UNSCOPED_ROUTE_ID, resolveRouteId, routeById, routesForSubject } from './routeRegistry.js'

export const MASTERY_STAGES = Object.freeze([
  {
    id: 'foundation',
    label: 'Foundation',
    description: 'Build the vocabulary, definitions, formulas, and first examples.',
    suggestedModes: ['learn', 'guided-drill'],
    readiness: 'You can identify the main idea but still need prompts or a formula sheet.',
  },
  {
    id: 'developing',
    label: 'Developing',
    description: 'Solve familiar questions and explain the method with limited support.',
    suggestedModes: ['guided-drill', 'topic-set'],
    readiness: 'You can start independently, but common errors or slow steps remain.',
  },
  {
    id: 'secure',
    label: 'Secure',
    description: 'Apply the idea across mixed contexts with accurate working and units.',
    suggestedModes: ['topic-set', 'timed-set', 'mistake-review'],
    readiness: 'You are usually accurate without notes and can diagnose a small mistake.',
  },
  {
    id: 'exam-ready',
    label: 'Exam ready',
    description: 'Use the skill under time pressure and communicate marks clearly.',
    suggestedModes: ['timed-set', 'mixed-review', 'mock-exam'],
    readiness: 'You can finish representative work on time and justify the final answer.',
  },
])

export const PRACTICE_MODES = Object.freeze([
  {
    id: 'learn',
    label: 'Learn the idea',
    shortLabel: 'Learn',
    description: 'Review a short concept outline, then try one low-pressure example.',
    timing: 'untimed',
    answerSurfaces: ['multiple-choice', 'numeric-with-working', 'written-response'],
    bestFor: ['foundation'],
  },
  {
    id: 'guided-drill',
    label: 'Guided drill',
    shortLabel: 'Guided',
    description: 'Work through a small set with progressive hints before seeing a solution.',
    timing: 'untimed',
    answerSurfaces: ['multiple-choice', 'numeric-with-working', 'written-response', 'graph-or-table'],
    bestFor: ['foundation', 'developing'],
  },
  {
    id: 'topic-set',
    label: 'Topic set',
    shortLabel: 'Topic set',
    description: 'Complete a coherent set of questions from one knowledge group.',
    timing: 'optional',
    answerSurfaces: ['multiple-choice', 'numeric-with-working', 'written-response', 'graph-or-table'],
    bestFor: ['developing', 'secure'],
  },
  {
    id: 'timed-set',
    label: 'Timed set',
    shortLabel: 'Timed',
    description: 'Practise pace and answer presentation on a short, focused set.',
    timing: 'timed',
    answerSurfaces: ['multiple-choice', 'numeric-with-working', 'written-response', 'graph-or-table'],
    bestFor: ['secure', 'exam-ready'],
  },
  {
    id: 'mixed-review',
    label: 'Mixed review',
    shortLabel: 'Mixed',
    description: 'Interleave related knowledge groups so you practise choosing the method.',
    timing: 'optional',
    answerSurfaces: ['multiple-choice', 'numeric-with-working', 'written-response', 'graph-or-table'],
    bestFor: ['secure', 'exam-ready'],
  },
  {
    id: 'mistake-review',
    label: 'Review mistakes',
    shortLabel: 'Mistakes',
    description: 'Revisit weak or low-confidence work, record the cause, and retest later.',
    timing: 'untimed',
    answerSurfaces: ['multiple-choice', 'numeric-with-working', 'written-response', 'graph-or-table'],
    bestFor: ['developing', 'secure'],
  },
  {
    id: 'mock-exam',
    label: 'Mock exam',
    shortLabel: 'Mock',
    description: 'Attempt a complete paper configuration with exam timing and review after submission.',
    timing: 'timed',
    answerSurfaces: ['multiple-choice', 'numeric-with-working', 'written-response', 'graph-or-table'],
    bestFor: ['exam-ready'],
  },
])

const stageIds = MASTERY_STAGES.map((stage) => stage.id)

function masteryStages(checkpoints) {
  return Object.freeze({
    stageIds: [...stageIds],
    checkpoints: Object.freeze(checkpoints),
  })
}

const COMPONENT_TAGS = Object.freeze({
  'physics-9702-mechanics': ['AS P2', 'A2 P4'],
  'physics-9702-waves': ['AS P2', 'A2 P4'],
  'physics-9702-electricity': ['AS P2'],
  'physics-9702-fields': ['A2 P4'],
  'physics-9702-particles': ['AS P2', 'A2 P4'],
  'physics-9702-thermal': ['A2 P4'],
  'physics-9702-practical-data': ['AS P3', 'A2 P5'],
  'math-9709-pure': ['AS P1', 'A2 P3'],
  'math-9709-mechanics': ['AS/A2 P4 (M1)'],
  'math-9709-statistics': ['AS/A2 P5 (S1)', 'A2 P6 (S2)'],
  'math-9709-problem-solving': ['P1/P3 mixed'],
  'math-9231-further-pure': ['AS P1', 'A2 P2'],
  'math-9231-further-mechanics': ['AS or A2 P3'],
  'math-9231-further-statistics': ['AS or A2 P4'],
  'math-9231-problem-solving': ['P1-P4 mixed'],
})

// Cambridge 9702 2025-2027 syllabus topic headings. The topic numbers are
// part of the student's specification, so they remain stable IDs for tagging.
const OFFICIAL_9702_TOPICS = Object.freeze([
  ['01', 'Physical quantities and units', 'AS P2|A2 P4', ['SI units', 'errors and uncertainties', 'scalars and vectors']],
  ['02', 'Kinematics', 'AS P2|A2 P4', ['equations of motion', 'motion graphs', 'free fall']],
  ['03', 'Dynamics', 'AS P2|A2 P4', ['momentum', 'Newton laws', 'non-uniform motion']],
  ['04', 'Forces, density and pressure', 'AS P2|A2 P4', ['moments', 'equilibrium', 'density and pressure']],
  ['05', 'Work, energy and power', 'AS P2|A2 P4', ['energy conservation', 'work done', 'power']],
  ['06', 'Deformation of solids', 'AS P2|A2 P4', ['stress and strain', 'Young modulus', 'elastic and plastic behaviour']],
  ['07', 'Waves', 'AS P2|A2 P4', ['progressive waves', 'transverse and longitudinal waves', 'Doppler effect', 'electromagnetic spectrum', 'polarisation']],
  ['08', 'Superposition', 'AS P2|A2 P4', ['stationary waves', 'diffraction', 'interference', 'diffraction grating']],
  ['09', 'Electricity', 'AS P2|A2 P4', ['current', 'potential difference', 'resistance', 'resistivity']],
  ['10', 'D.C. circuits', 'AS P2|A2 P4', ['practical circuits', 'Kirchhoff laws', 'potential dividers']],
  ['11', 'Particle physics', 'AS P2|A2 P4', ['atoms', 'nuclei and radiation', 'fundamental particles']],
  ['12', 'Motion in a circle', 'A2 P4', ['angular speed', 'centripetal acceleration', 'circular motion']],
  ['13', 'Gravitational fields', 'A2 P4', ['gravitational field', 'Newton law of gravitation', 'gravitational potential', 'orbits']],
  ['14', 'Temperature', 'A2 P4', ['thermal equilibrium', 'temperature scales', 'specific heat capacity', 'specific latent heat']],
  ['15', 'Ideal gases', 'A2 P4', ['mole', 'equation of state', 'kinetic theory']],
  ['16', 'Thermodynamics', 'A2 P4', ['internal energy', 'first law of thermodynamics']],
  ['17', 'Oscillations', 'A2 P4', ['simple harmonic oscillations', 'energy in SHM', 'damping', 'resonance']],
  ['18', 'Electric fields', 'A2 P4', ['field lines', 'uniform electric fields', 'electric force', 'electric potential']],
  ['19', 'Capacitance', 'A2 P4', ['capacitors', 'energy stored', 'discharging']],
  ['20', 'Magnetic fields', 'A2 P4', ['magnetic field', 'force on current', 'force on moving charge', 'electromagnetic induction']],
  ['21', 'Alternating currents', 'A2 P4', ['alternating currents', 'rectification', 'smoothing']],
  ['22', 'Quantum physics', 'A2 P4', ['photons', 'photoelectric effect', 'wave-particle duality', 'energy levels']],
  ['23', 'Nuclear physics', 'A2 P4', ['mass defect', 'binding energy', 'radioactive decay']],
  ['24', 'Medical physics', 'A2 P4', ['ultrasound', 'X-rays', 'PET scanning']],
  ['25', 'Astronomy and cosmology', 'A2 P4', ['standard candles', 'stellar radii', 'Hubble law', 'Big Bang theory']],
])

function officialPhysicsGroup([number, name, components, themes]) {
  const id = `physics-9702-topic-${number}`
  return group({
    id,
    subjectId: 'physics-9702',
    name: `${Number(number)} ${name}`,
    description: `Cambridge 9702 official syllabus topic ${number}: ${name}.`,
    themes,
    skills: ['identify the syllabus command', 'select the physical model', 'show complete working', 'check units and significant figures'],
    priority: Number(number) <= 11 ? 1 : 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: `Recall the definitions, relationships and representations in official topic ${number}.`,
      developing: `Solve familiar ${name} questions with clear substitutions and units.`,
      secure: `Apply ${name} ideas to unfamiliar contexts and explain the evidence.`,
      'exam-ready': `Complete mixed ${name} questions under the relevant Cambridge component timing.`,
    },
    stageTags: components.split('|'),
    officialTopicNumber: Number(number),
  })
}

const OFFICIAL_9702_GROUPS = Object.freeze(OFFICIAL_9702_TOPICS.map(officialPhysicsGroup))
const OFFICIAL_9702_GROUP_IDS = OFFICIAL_9702_GROUPS.map((item) => item.id)
const LEGACY_9702_GROUP_IDS = Object.freeze([
  'physics-9702-mechanics', 'physics-9702-waves', 'physics-9702-electricity',
  'physics-9702-fields', 'physics-9702-particles', 'physics-9702-thermal', 'physics-9702-practical-data',
])

export function stagesForComponentTags(tags = []) {
  const hasAS = tags.some((tag) => /(?:^|[^A-Z0-9])AS(?:$|[^A-Z0-9])/i.test(tag))
  const hasA2 = tags.some((tag) => /(?:^|[^A-Z0-9])A2(?:$|[^A-Z0-9])/i.test(tag))
  if (hasAS && hasA2) return ['AS', 'A2']
  if (hasA2) return ['A2']
  if (hasAS) return ['AS']
  return tags.some((tag) => /IGCSE|Core|Extended/i.test(tag)) ? ['IGCSE'] : ['AS', 'A2']
}

function group({ id, subjectId, name, description, themes, skills, priority, recommendedModes, checkpoints, stageTags: explicitStageTags, officialTopicNumber = null, hidden = false, routeId: explicitRouteId = null }) {
  const stageTags = explicitStageTags || COMPONENT_TAGS[id] || (subjectId === 'physics-0625'
    ? ['IGCSE']
    : ['AS', 'A2'])
  const routeId = explicitRouteId || resolveRouteId({ subjectId, knowledgeGroupId: id }) || LEGACY_UNSCOPED_ROUTE_ID
  const route = routeById(routeId)
  return Object.freeze({
    id,
    subjectId,
    routeId,
    qualification: route?.qualification || null,
    stage: route?.stage || LEGACY_UNSCOPED_ROUTE_ID,
    paperComponent: null,
    syllabusTopic: id,
    sourcePaper: null,
    name,
    description,
    themes: Object.freeze([...themes]),
    skills: Object.freeze([...skills]),
    stageTags: Object.freeze(stageTags),
    priority,
    recommendedModes: Object.freeze([...recommendedModes]),
    mastery: masteryStages(checkpoints),
    officialTopicNumber,
    hidden: Boolean(hidden),
  })
}

export const KNOWLEDGE_GROUPS = Object.freeze([
  ...OFFICIAL_9702_GROUPS,
  group({
    id: 'physics-9702-mechanics',
    subjectId: 'physics-9702',
    name: 'Mechanics',
    description: 'Model motion, forces, momentum, energy, and circular motion from physical situations.',
    themes: ['kinematics', 'dynamics', 'forces and momentum', 'work energy and power', 'circular motion'],
    skills: ['choose a model', 'draw or interpret force diagrams', 'use equations with units', 'explain assumptions'],
    priority: 1,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Recognise displacement, velocity, acceleration, resultant force, and the relevant SI units.',
      developing: 'Solve one-stage motion and force problems and show substitutions clearly.',
      secure: 'Combine force, energy, and momentum ideas in unfamiliar contexts.',
      'exam-ready': 'Select an efficient model under time pressure and check signs, units, and limiting cases.',
    },
    hidden: true,
  }),
  group({
    id: 'physics-9702-waves',
    subjectId: 'physics-9702',
    name: 'Waves',
    description: 'Connect wave quantities, superposition, interference, diffraction, and stationary waves.',
    themes: ['wave properties', 'superposition', 'interference and diffraction', 'stationary waves', 'optical waves'],
    skills: ['interpret wave diagrams', 'relate phase and path difference', 'use v = f lambda', 'describe observations'],
    priority: 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mixed-review', 'mistake-review'],
    checkpoints: {
      foundation: 'Define amplitude, wavelength, frequency, period, phase, and wave speed.',
      developing: 'Use wave equations and identify constructive or destructive interference.',
      secure: 'Explain observations using phase, path difference, and superposition rather than keywords alone.',
      'exam-ready': 'Handle unfamiliar wave diagrams and communicate conditions precisely.',
    },
    hidden: true,
  }),
  group({
    id: 'physics-9702-electricity',
    subjectId: 'physics-9702',
    name: 'Electricity',
    description: 'Build circuit intuition from charge flow to resistance, energy, and practical measurements.',
    themes: ['current and charge', 'potential difference and resistance', 'DC circuits', 'energy and power', 'resistivity'],
    skills: ['read circuit diagrams', 'apply Kirchhoff-style reasoning', 'plot and interpret graphs', 'check units and scales'],
    priority: 1,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Distinguish current, charge, potential difference, resistance, and power.',
      developing: 'Solve simple series and parallel circuit problems with consistent units.',
      secure: 'Interpret I-V characteristics and explain resistance changes from evidence.',
      'exam-ready': 'Move between diagrams, equations, graphs, and written explanations without losing data.',
    },
    hidden: true,
  }),
  group({
    id: 'physics-9702-fields',
    subjectId: 'physics-9702',
    name: 'Fields',
    description: 'Compare gravitational, electric, and magnetic fields through force, potential, and energy.',
    themes: ['gravitational fields', 'electric fields', 'magnetic fields', 'field strength and potential', 'orbits'],
    skills: ['draw field patterns', 'distinguish field strength from potential', 'use inverse-square relationships', 'reason from direction'],
    priority: 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mixed-review', 'mistake-review'],
    checkpoints: {
      foundation: 'Describe a field as a region where an object experiences a force and identify field directions.',
      developing: 'Use field strength, force, potential, and energy relationships in direct problems.',
      secure: 'Compare field models and explain how distance changes the relevant quantities.',
      'exam-ready': 'Combine vector direction and scalar energy reasoning in multi-step contexts.',
    },
    hidden: true,
  }),
  group({
    id: 'physics-9702-particles',
    subjectId: 'physics-9702',
    name: 'Particles and nuclear physics',
    description: 'Use particle models, conservation laws, decay, and nuclear structure to explain evidence.',
    themes: ['particle interactions', 'quarks and leptons', 'nuclear structure', 'radioactive decay', 'mass energy'],
    skills: ['apply conservation laws', 'read decay equations', 'interpret detector evidence', 'distinguish activity and count rate'],
    priority: 3,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Identify common particles, charges, and the meaning of nucleon and proton numbers.',
      developing: 'Complete conservation checks and use decay relationships in familiar examples.',
      secure: 'Explain observations with the particle model and separate evidence from inference.',
      'exam-ready': 'Handle unfamiliar interaction or decay descriptions with precise conservation reasoning.',
    },
    hidden: true,
  }),
  group({
    id: 'physics-9702-thermal',
    subjectId: 'physics-9702',
    name: 'Thermal physics',
    description: 'Relate microscopic particle motion to temperature, ideal gases, and energy transfer.',
    themes: ['temperature and internal energy', 'ideal gases', 'kinetic theory', 'thermal processes', 'specific heat and latent heat'],
    skills: ['translate between models', 'use state equations', 'interpret experimental data', 'track energy changes'],
    priority: 3,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mixed-review'],
    checkpoints: {
      foundation: 'Distinguish temperature, internal energy, and thermal energy transfer.',
      developing: 'Use gas and energy equations with correct absolute temperature and units.',
      secure: 'Explain macroscopic changes through particle motion and energy distribution.',
      'exam-ready': 'Combine model assumptions, data interpretation, and calculations in one response.',
    },
    hidden: true,
  }),
  group({
    id: 'physics-9702-practical-data',
    subjectId: 'physics-9702',
    name: 'Practical and data analysis',
    description: 'Turn measurements into defensible conclusions with uncertainty, graphs, and evaluation.',
    themes: ['measurement and uncertainty', 'planning investigations', 'graph skills', 'data processing', 'evaluation'],
    skills: ['choose variables', 'control conditions', 'use significant figures', 'evaluate limitations', 'calculate uncertainty'],
    priority: 1,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Identify independent, dependent, and control variables and record units consistently.',
      developing: 'Process a table and construct a graph with sensible scales and labels.',
      secure: 'Link uncertainty and anomalies to the strength of a conclusion.',
      'exam-ready': 'Plan, calculate, graph, and evaluate an investigation within the available time.',
    },
    hidden: true,
  }),

  group({
    id: 'math-9709-pure',
    subjectId: 'math-9709',
    name: 'Pure Mathematics',
    description: 'Develop the algebraic, graphical, trigonometric, calculus, and vector tools used across the course.',
    themes: ['algebra and functions', 'coordinate geometry', 'sequences and series', 'trigonometry', 'differentiation', 'integration', 'vectors'],
    skills: ['transform expressions', 'choose a representation', 'show exact working', 'check domain and constraints'],
    priority: 1,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Manipulate standard forms and recall the meaning of core graphs, identities, and notation.',
      developing: 'Complete familiar algebra and calculus procedures with a clear line of working.',
      secure: 'Choose between algebraic, graphical, and calculus methods for mixed questions.',
      'exam-ready': 'Maintain exactness and speed across multi-part pure questions, including domain checks.',
    },
  }),
  group({
    id: 'math-9709-mechanics',
    subjectId: 'math-9709',
    name: 'Mechanics',
    description: 'Apply mathematical models to motion, forces, momentum, and energy.',
    themes: ['kinematics', 'forces and equilibrium', 'Newton laws', 'momentum', 'work energy and power'],
    skills: ['define positive direction', 'draw force diagrams', 'select equations', 'state modelling assumptions'],
    priority: 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Translate words into displacement, velocity, acceleration, force, and mass quantities.',
      developing: 'Solve direct motion and force problems with a declared sign convention.',
      secure: 'Link kinematics, Newton laws, momentum, and energy in multi-stage models.',
      'exam-ready': 'Set up unfamiliar models quickly and present assumptions and units clearly.',
    },
  }),
  group({
    id: 'math-9709-statistics',
    subjectId: 'math-9709',
    name: 'Statistics and probability',
    description: 'Use data summaries, probability models, distributions, and inference-style reasoning.',
    themes: ['representation of data', 'permutations and combinations', 'probability', 'discrete distributions', 'normal distribution', 'sampling'],
    skills: ['define events', 'choose a distribution', 'interpret parameters', 'communicate conclusions in context'],
    priority: 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Read summaries and define events, outcomes, populations, and samples.',
      developing: 'Calculate probabilities and distribution values with appropriate notation.',
      secure: 'Select a model from context and interpret the result rather than only calculating it.',
      'exam-ready': 'Manage multi-part data questions with accurate calculator use and contextual conclusions.',
    },
  }),
  group({
    id: 'math-9709-problem-solving',
    subjectId: 'math-9709',
    name: 'Mathematical problem solving',
    description: 'Practise connecting topics, interpreting command words, and checking a complete solution.',
    themes: ['multi-topic modelling', 'proof and justification', 'graphs and interpretation', 'exact and numerical answers'],
    skills: ['plan before calculating', 'identify hidden constraints', 'write connected reasoning', 'verify results'],
    priority: 3,
    recommendedModes: ['guided-drill', 'mixed-review', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Underline knowns, unknowns, restrictions, and the command word before choosing a method.',
      developing: 'Connect two familiar ideas and explain why each step is valid.',
      secure: 'Solve mixed problems without relying on topic labels or a memorised sequence.',
      'exam-ready': 'Control time, proof quality, notation, and checking across a full section.',
    },
  }),

  group({
    id: 'math-9231-further-pure',
    subjectId: 'math-9231',
    name: 'Further Pure Mathematics',
    description: 'Extend pure methods into complex numbers, matrices, differential equations, and advanced functions.',
    themes: ['complex numbers', 'matrices and transformations', 'roots of polynomial equations', 'series', 'differential equations', 'hyperbolic functions', 'polar coordinates', 'numerical methods'],
    skills: ['work with abstract notation', 'choose a suitable form', 'justify transformations', 'check numerical stability'],
    priority: 1,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Use the notation and definitions for the selected Further Pure themes without mixing conventions.',
      developing: 'Carry out standard procedures such as matrix operations, complex-number forms, or equation solving.',
      secure: 'Connect representations and explain why a transformation or method is valid.',
      'exam-ready': 'Select efficient methods and maintain exact, logically complete working on unfamiliar problems.',
    },
  }),
  group({
    id: 'math-9231-further-mechanics',
    subjectId: 'math-9231',
    name: 'Further Mechanics',
    description: 'Model more demanding motion and force systems with careful assumptions and conservation reasoning.',
    themes: ['momentum and collisions', 'energy methods', 'variable force', 'circular motion', 'rigid-body or advanced motion models'],
    skills: ['define a system', 'choose conservation boundaries', 'handle vectors and components', 'validate a model'],
    priority: 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Identify the system, variables, and modelling assumptions in an advanced mechanics setup.',
      developing: 'Apply standard momentum, energy, and force methods to familiar configurations.',
      secure: 'Combine methods and interpret the physical meaning of a mathematical result.',
      'exam-ready': 'Set up demanding models efficiently and explain rejected or limiting cases.',
    },
  }),
  group({
    id: 'math-9231-further-statistics',
    subjectId: 'math-9231',
    name: 'Further Probability and Statistics',
    description: 'Strengthen probability models, distributions, and statistical reasoning for Further Mathematics.',
    themes: ['advanced probability', 'random variables', 'distributions', 'sampling and inference', 'statistical modelling'],
    skills: ['state assumptions', 'derive or select a model', 'interpret parameters', 'evaluate evidence'],
    priority: 3,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Use probability notation and define the random variable and model in context.',
      developing: 'Calculate standard distribution quantities and explain the chosen assumptions.',
      secure: 'Compare models and interpret evidence with appropriate statistical language.',
      'exam-ready': 'Handle multi-stage probability and inference questions without losing conditions or context.',
    },
  }),
  group({
    id: 'math-9231-problem-solving',
    subjectId: 'math-9231',
    name: 'Further problem solving',
    description: 'Interleave Further Pure, Mechanics, and Statistics so method selection becomes automatic.',
    themes: ['cross-topic modelling', 'proof and justification', 'interpretation', 'method selection'],
    skills: ['classify the problem', 'make a plan', 'compare methods', 'audit the final result'],
    priority: 4,
    recommendedModes: ['guided-drill', 'mixed-review', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Break a long problem into knowns, definitions, and smaller claims.',
      developing: 'Link two Further Mathematics methods with prompts and explicit checking.',
      secure: 'Choose a method independently when the topic is not signposted.',
      'exam-ready': 'Sustain accurate reasoning and time management across a mixed paper.',
    },
  }),
  group({
    id: 'physics-0625-forces',
    subjectId: 'physics-0625',
    name: 'Forces and motion',
    description: 'Build the IGCSE model of motion, forces, energy, momentum, and pressure from observable situations.',
    themes: ['motion', 'forces', 'energy', 'momentum', 'pressure'],
    skills: ['read graphs', 'use F = ma', 'describe energy transfers', 'include units'],
    priority: 1,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Recognise common quantities, units, and the direction of a resultant force.',
      developing: 'Use motion and force relationships in familiar numerical questions.',
      secure: 'Explain changes in motion using force, mass, and energy evidence.',
      'exam-ready': 'Move between diagrams, graphs, calculations, and explanations under time pressure.',
    },
  }),
  group({
    id: 'physics-0625-electricity',
    subjectId: 'physics-0625',
    name: 'Electricity and magnetism',
    description: 'Practise circuits, electrical safety, magnetic fields, motors, generators, and transformers.',
    themes: ['charge and current', 'circuits', 'electrical power', 'magnetism', 'electromagnetic effects'],
    skills: ['read circuits', 'choose meters', 'use equations', 'describe fields and induction'],
    priority: 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Distinguish current, voltage, resistance, and the role of a circuit component.',
      developing: 'Calculate electrical quantities and use correct meter connections.',
      secure: 'Explain circuit behaviour from measurements and component characteristics.',
      'exam-ready': 'Combine circuit diagrams, equations, practical evidence, and safety reasoning.',
    },
  }),
  group({
    id: 'physics-0625-waves',
    subjectId: 'physics-0625',
    name: 'Waves',
    description: 'Connect wave quantities, reflection, refraction, sound, light, and the electromagnetic spectrum.',
    themes: ['wave properties', 'reflection and refraction', 'sound', 'light', 'electromagnetic spectrum'],
    skills: ['interpret diagrams', 'use wave equations', 'describe observations', 'compare wave behaviour'],
    priority: 3,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mixed-review'],
    checkpoints: {
      foundation: 'Define wavelength, frequency, amplitude, and temperature with units.',
      developing: 'Use wave relationships in direct questions.',
      secure: 'Explain wave observations using a clear model.',
      'exam-ready': 'Select precise evidence and terminology in unfamiliar contexts.',
    },
  }),
  group({
    id: 'physics-0625-atomic-space',
    subjectId: 'physics-0625',
    name: 'Nuclear physics',
    description: 'Use atomic models, radiation properties, half-life data, safety principles, fission, and fusion.',
    themes: ['the nuclear atom', 'radioactivity', 'half-life', 'fission and fusion'],
    skills: ['compare radiation', 'interpret decay data', 'apply safety principles', 'link evidence to models'],
    priority: 4,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Identify radiation types, atomic structure, and common safety precautions.',
      developing: 'Use definitions and relationships in familiar atomic questions.',
      secure: 'Explain observations using particle and decay evidence.',
      'exam-ready': 'Compare models and justify conclusions with precise scientific language.',
    },
  }),
  group({
    id: 'physics-0625-thermal',
    subjectId: 'physics-0625',
    name: 'Thermal physics',
    description: 'Connect particle models, temperature, thermal expansion, specific heat capacity, and energy transfer.',
    themes: ['particle model', 'temperature', 'thermal expansion', 'specific heat capacity', 'energy transfer'],
    skills: ['use particle explanations', 'calculate energy changes', 'compare transfer processes', 'include units'],
    priority: 2,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Describe solids, liquids, and gases using particle arrangement and motion.',
      developing: 'Calculate thermal energy changes and identify transfer processes.',
      secure: 'Explain thermal observations by linking particle behaviour and energy transfer.',
      'exam-ready': 'Combine calculations and particle explanations in unfamiliar thermal contexts.',
    },
  }),
  group({
    id: 'physics-0625-space',
    subjectId: 'physics-0625',
    name: 'Space physics',
    description: 'Use scale, orbital motion, stellar evolution, redshift, and cosmological evidence.',
    themes: ['Earth and Solar System', 'orbits', 'stars', 'redshift', 'age of the Universe'],
    skills: ['work with large scales', 'calculate orbital quantities', 'sequence stellar evolution', 'interpret evidence'],
    priority: 4,
    recommendedModes: ['learn', 'guided-drill', 'topic-set', 'mistake-review'],
    checkpoints: {
      foundation: 'Identify Solar System objects and the main stages in a star life cycle.',
      developing: 'Calculate speed, distance, or time for orbital and astronomical data.',
      secure: 'Explain stellar evolution and redshift using physical evidence.',
      'exam-ready': 'Interpret unfamiliar astronomical data and justify conclusions precisely.',
    },
  }),
  ...additionalKnowledgeGroups,
])

const SUBJECT_DEFINITIONS = [
  {
    id: 'physics-9702',
    code: '9702',
    name: 'Physics',
    qualification: 'Cambridge International AS & A Level',
    syllabusUrl: curriculumSources['9702'].syllabus,
    knowledgeGroupIds: [...OFFICIAL_9702_GROUP_IDS, ...LEGACY_9702_GROUP_IDS],
    mockConfigIds: ['mock-9702-foundation', 'mock-9702-full-paper'],
  },
  {
    id: 'physics-0625',
    code: '0625',
    name: 'IGCSE Physics',
    qualification: 'Cambridge IGCSE',
    syllabusUrl: curriculumSources['0625'].syllabus,
    knowledgeGroupIds: ['physics-0625-forces', 'physics-0625-thermal', 'physics-0625-waves', 'physics-0625-electricity', 'physics-0625-atomic-space', 'physics-0625-space'],
    mockConfigIds: [],
  },
  {
    id: 'math-9709',
    code: '9709',
    name: 'Mathematics',
    qualification: 'Cambridge International AS & A Level',
    syllabusUrl: curriculumSources['9709'].syllabus,
    knowledgeGroupIds: ['math-9709-pure', 'math-9709-mechanics', 'math-9709-statistics', 'math-9709-problem-solving'],
    mockConfigIds: ['mock-9709-topic-mix', 'mock-9709-full-paper'],
  },
  {
    id: 'math-9231',
    code: '9231',
    name: 'Further Mathematics',
    qualification: 'Cambridge International AS & A Level',
    syllabusUrl: curriculumSources['9231'].syllabus,
    knowledgeGroupIds: ['math-9231-further-pure', 'math-9231-further-mechanics', 'math-9231-further-statistics', 'math-9231-problem-solving'],
    mockConfigIds: ['mock-9231-topic-mix', 'mock-9231-full-paper'],
  },
  ...additionalSubjects,
]

export const SUBJECTS = Object.freeze(SUBJECT_DEFINITIONS.map((subject) => {
  const routeIds = routesForSubject(subject.id).map((route) => route.routeId)
  const routeId = routeIds.length === 1 ? routeIds[0] : LEGACY_UNSCOPED_ROUTE_ID
  const route = routeById(routeId)
  return Object.freeze({
    ...subject,
    routeId,
    routeIds: Object.freeze(routeIds),
    stage: route?.stage || LEGACY_UNSCOPED_ROUTE_ID,
  })
}))

const MOCK_EXAM_DEFINITIONS = [
  {
    id: 'mock-9702-foundation',
    subjectId: 'physics-9702',
    courseStage: 'AS',
    title: 'Physics focused mock',
    description: 'A shorter mixed configuration for checking readiness before a complete paper.',
    durationMinutes: 45,
    recommendedStage: 'secure',
    scope: ['physics-9702-mechanics', 'physics-9702-waves', 'physics-9702-electricity'],
    reviewChecklist: ['method choice', 'units and significant figures', 'explanation evidence', 'time spent per part'],
    sourcePolicy: 'Use verified question-paper content from the selected specification and session; this config contains no paper content.',
  },
  {
    id: 'mock-9702-full-paper',
    subjectId: 'physics-9702',
    title: 'Physics full-paper simulation',
    description: 'Select a verified paper and preserve its published duration, sections, marks, and allowed tools.',
    durationMinutes: null,
    recommendedStage: 'exam-ready',
    scope: ['physics-9702-mechanics', 'physics-9702-waves', 'physics-9702-electricity', 'physics-9702-fields', 'physics-9702-particles', 'physics-9702-thermal', 'physics-9702-practical-data'],
    reviewChecklist: ['paper completion', 'mark allocation', 'data and formula use', 'uncertainty and evaluation', 'unanswered parts'],
    sourcePolicy: 'Duration and content must come from the exact verified paper metadata. Do not infer them from this plan.',
  },
  {
    id: 'mock-9709-topic-mix',
    subjectId: 'math-9709',
    title: 'Mathematics mixed-topic mock',
    description: 'A short mixed set that tests method selection across Pure, Mechanics, and Statistics.',
    durationMinutes: 50,
    recommendedStage: 'secure',
    scope: ['math-9709-pure', 'math-9709-mechanics', 'math-9709-statistics'],
    reviewChecklist: ['method selection', 'exact versus decimal form', 'calculator decisions', 'interpretation and checking'],
    sourcePolicy: 'Use verified question-paper content or clearly labelled original practice content; this config contains no paper content.',
  },
  {
    id: 'mock-9709-full-paper',
    subjectId: 'math-9709',
    title: 'Mathematics full-paper simulation',
    description: 'Select a verified paper configuration for the student\'s specification version and option combination.',
    durationMinutes: null,
    recommendedStage: 'exam-ready',
    scope: ['math-9709-pure', 'math-9709-mechanics', 'math-9709-statistics', 'math-9709-problem-solving'],
    reviewChecklist: ['time by section', 'notation and exactness', 'method marks', 'calculator use', 'checking constraints'],
    sourcePolicy: 'Paper code, duration, marks, and option combination must come from exact verified paper metadata.',
  },
  {
    id: 'mock-9231-topic-mix',
    subjectId: 'math-9231',
    title: 'Further Mathematics mixed-topic mock',
    description: 'A shorter diagnostic across Further Pure, Further Mechanics, and Further Statistics.',
    durationMinutes: 60,
    recommendedStage: 'secure',
    scope: ['math-9231-further-pure', 'math-9231-further-mechanics', 'math-9231-further-statistics'],
    reviewChecklist: ['representation choice', 'assumptions', 'proof quality', 'contextual interpretation'],
    sourcePolicy: 'Use verified question-paper content or clearly labelled original practice content; this config contains no paper content.',
  },
  {
    id: 'mock-9231-full-paper',
    subjectId: 'math-9231',
    title: 'Further Mathematics full-paper simulation',
    description: 'Select the exact Further Mathematics paper and option required by the student\'s specification version.',
    durationMinutes: null,
    recommendedStage: 'exam-ready',
    scope: ['math-9231-further-pure', 'math-9231-further-mechanics', 'math-9231-further-statistics', 'math-9231-problem-solving'],
    reviewChecklist: ['time by section', 'logical completeness', 'model assumptions', 'exact forms', 'unanswered parts'],
    sourcePolicy: 'Paper code, duration, marks, and option combination must come from exact verified paper metadata.',
  },
]

export const MOCK_EXAM_CONFIGS = Object.freeze(MOCK_EXAM_DEFINITIONS.map((mock) => {
  const routeId = resolveRouteId({ subjectId: mock.subjectId, stage: mock.courseStage, paperComponent: mock.paperComponent }) || LEGACY_UNSCOPED_ROUTE_ID
  const route = routeById(routeId)
  return Object.freeze({
    ...mock,
    routeId,
    qualification: route?.qualification || null,
    stage: route?.stage || LEGACY_UNSCOPED_ROUTE_ID,
    paperComponent: mock.paperComponent ?? null,
    syllabusTopic: null,
    sourcePaper: null,
  })
}))

export const LEARNING_SUGGESTIONS = Object.freeze([
  {
    id: 'start-small',
    label: 'Start with one group',
    text: 'Choose one knowledge group and finish a short guided drill before opening a full paper.',
    when: 'no-data',
    action: 'guided-drill',
  },
  {
    id: 'repair-weakest',
    label: 'Repair the weakest group',
    text: 'Work on the group with the lowest recent mastery, then retest the same skill after a short break.',
    when: 'low-mastery',
    action: 'mistake-review',
  },
  {
    id: 'mix-methods',
    label: 'Practise method choice',
    text: 'Mix two or three secure groups so you practise recognising the method before calculating.',
    when: 'secure',
    action: 'mixed-review',
  },
  {
    id: 'build-timing',
    label: 'Build timed accuracy',
    text: 'Use a short timed set, then review unfinished parts and slow steps before attempting a full mock.',
    when: 'exam-ready',
    action: 'timed-set',
  },
  {
    id: 'simulate-under-time',
    label: 'Simulate under time',
    text: 'Use a verified paper with its own published timing only after the relevant groups are exam ready.',
    when: 'exam-ready',
    action: 'mock-exam',
  },
])

const SUBJECT_BY_ID = new Map(SUBJECTS.map((subject) => [subject.id, subject]))
const GROUP_BY_ID = new Map(KNOWLEDGE_GROUPS.map((knowledgeGroup) => [knowledgeGroup.id, knowledgeGroup]))
const MOCK_BY_ID = new Map(MOCK_EXAM_CONFIGS.map((mock) => [mock.id, mock]))
const STAGE_RANK = new Map(MASTERY_STAGES.map((stage, index) => [stage.id, index]))

export const learningPlan = Object.freeze({
  schemaVersion: 2,
  courseRoutes,
  subjects: SUBJECTS,
  knowledgeGroups: KNOWLEDGE_GROUPS,
  masteryStages: MASTERY_STAGES,
  practiceModes: PRACTICE_MODES,
  mockExams: MOCK_EXAM_CONFIGS,
  suggestions: LEARNING_SUGGESTIONS,
})

export function getSubject(subjectId) {
  return SUBJECT_BY_ID.get(subjectId) ?? null
}

export function getKnowledgeGroups(subjectId) {
  const subject = getSubject(subjectId)
  if (!subject) return []
  return subject.knowledgeGroupIds.map((id) => GROUP_BY_ID.get(id)).filter(Boolean)
}

export function getKnowledgeGroup(groupId) {
  return GROUP_BY_ID.get(groupId) ?? null
}

export function getPracticeModes(groupId) {
  const knowledgeGroup = getKnowledgeGroup(groupId)
  if (!knowledgeGroup) return []
  const modeIds = new Set(knowledgeGroup.recommendedModes)
  return PRACTICE_MODES.filter((mode) => modeIds.has(mode.id))
}

export function getMockExams(subjectId) {
  const subject = getSubject(subjectId)
  if (!subject) return []
  return subject.mockConfigIds.map((id) => MOCK_BY_ID.get(id)).filter(Boolean)
}

export function getMasteryStage(stageId) {
  return MASTERY_STAGES.find((stage) => stage.id === stageId) ?? MASTERY_STAGES[0]
}

export function getRecommendedNextStep(subjectId, masteryByGroup = {}) {
  const groups = getKnowledgeGroups(subjectId)
  if (groups.length === 0) return null

  const rankedGroups = groups
    .map((knowledgeGroup, index) => {
      const stageId = masteryByGroup[knowledgeGroup.id]?.stage ?? masteryByGroup[knowledgeGroup.id] ?? 'foundation'
      const rank = STAGE_RANK.has(stageId) ? STAGE_RANK.get(stageId) : 0
      return { knowledgeGroup, stageId, rank, index }
    })
    .sort((left, right) => left.rank - right.rank || left.knowledgeGroup.priority - right.knowledgeGroup.priority || left.index - right.index)

  const next = rankedGroups[0]
  const stage = getMasteryStage(next.stageId)
  const isNew = !Object.prototype.hasOwnProperty.call(masteryByGroup, next.knowledgeGroup.id)
  const action = isNew ? 'guided-drill' : stage.suggestedModes[0]
  const suggestion = LEARNING_SUGGESTIONS.find((item) => item.action === action) ?? LEARNING_SUGGESTIONS[0]

  return {
    subjectId,
    groupId: next.knowledgeGroup.id,
    groupName: next.knowledgeGroup.name,
    stageId: next.stageId,
    stageLabel: stage.label,
    modeId: action,
    label: suggestion.label,
    text: isNew
      ? `Start ${next.knowledgeGroup.name} with a guided drill and build a first evidence sample.`
      : `${suggestion.text} Focus next on ${next.knowledgeGroup.name}.`,
  }
}
