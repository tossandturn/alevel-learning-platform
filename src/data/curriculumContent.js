import { LEGACY_UNSCOPED_ROUTE_ID, resolveRouteId, routeById, routesForSubject } from './routeRegistry.js'

const SOURCES = Object.freeze({
  '0580': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-mathematics-0580/',
    syllabus: 'https://www.cambridgeinternational.org/Images/662466-2025-2027-syllabus.pdf',
    years: '2025-2027',
  },
  '0606': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-mathematics-additional-0606/',
    syllabus: 'https://www.cambridgeinternational.org/Images/662470-2025-2027-syllabus.pdf',
    years: '2025-2027',
  },
  '0625': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-physics-0625/',
    syllabus: 'https://www.cambridgeinternational.org/Images/697209-2026-2028-syllabus.pdf',
    years: '2026-2028',
  },
  '9702': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-physics-9702/',
    syllabus: 'https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf',
    years: '2025-2027',
  },
  '9701': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-chemistry-9701/',
    syllabus: 'https://www.cambridgeinternational.org/Images/664563-2025-2027-syllabus.pdf',
    years: '2025-2027',
  },
  '9708': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-economics-9708/',
    syllabus: 'https://www.cambridgeinternational.org/Images/697423-2026-2028-syllabus.pdf',
    years: '2026-2028',
  },
  '9709': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-mathematics-9709/',
    syllabus: 'https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf',
    years: '2026-2027',
  },
  '9231': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-mathematics-further-9231/',
    syllabus: 'https://www.cambridgeinternational.org/Images/697357-2026-2027-syllabus.pdf',
    years: '2026-2027 Version 3',
  },
  '0610': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-igcse-biology-0610/',
    syllabus: 'https://www.cambridgeinternational.org/Images/697203-2026-2028-syllabus.pdf',
    years: '2026-2028',
  },
  '9700': {
    page: 'https://www.cambridgeinternational.org/programmes-and-qualifications/cambridge-international-as-and-a-level-biology-9700/',
    syllabus: 'https://www.cambridgeinternational.org/Images/664560-2025-2027-syllabus.pdf',
    years: '2025-2027',
  },
})

export const curriculumSources = SOURCES

function checkpoints(name) {
  return {
    foundation: `Recall the definitions, notation and first methods used in ${name}.`,
    developing: `Complete familiar ${name} questions with clear working and checks.`,
    secure: `Choose the correct ${name} method in unfamiliar contexts without prompts.`,
    'exam-ready': `Solve mixed ${name} questions accurately under Cambridge timing.`,
  }
}

function chapter({ id, subjectId, name, description, themes, stageTags = ['IGCSE'], priority = 1 }) {
  const stage = stageTags.length === 1 ? stageTags[0] : null
  const routeId = resolveRouteId({ subjectId, stage, knowledgeGroupId: id }) || LEGACY_UNSCOPED_ROUTE_ID
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
    themes: Object.freeze(themes),
    skills: Object.freeze(['select a method', 'show complete working', 'check notation and accuracy']),
    stageTags: Object.freeze(stageTags),
    priority,
    recommendedModes: Object.freeze(['learn', 'guided-drill', 'topic-set', 'timed-set', 'mistake-review']),
    mastery: Object.freeze({
      stageIds: Object.freeze(['foundation', 'developing', 'secure', 'exam-ready']),
      checkpoints: Object.freeze(checkpoints(name)),
    }),
  })
}

export const additionalKnowledgeGroups = Object.freeze([
  chapter({ id: 'biology-0610-cell', subjectId: 'biology-0610', name: 'Cells and organisation', description: 'Cell structure, specialised cells, movement across membranes and levels of organisation.', themes: ['cell structure', 'specialised cells', 'diffusion and osmosis', 'enzymes', 'organisation'], stageTags: ['IGCSE'], priority: 1 }),
  chapter({ id: 'biology-0610-coordination', subjectId: 'biology-0610', name: 'Coordination and response', description: 'Nervous and hormonal coordination, homeostasis, tropisms and sensory responses.', themes: ['nervous system', 'hormones', 'homeostasis', 'tropisms', 'sense organs'], stageTags: ['IGCSE'], priority: 2 }),
  chapter({ id: 'biology-0610-genetics', subjectId: 'biology-0610', name: 'Inheritance and variation', description: 'DNA, genes, inheritance, variation, selection and evolution.', themes: ['genes and DNA', 'mitosis and meiosis', 'inheritance', 'variation', 'natural selection'], stageTags: ['IGCSE'], priority: 1 }),
  chapter({ id: 'biology-0610-ecology', subjectId: 'biology-0610', name: 'Ecology and human impact', description: 'Energy flow, cycles, populations, biodiversity and human effects on ecosystems.', themes: ['food chains', 'energy transfer', 'carbon cycle', 'populations', 'biodiversity'], stageTags: ['IGCSE'], priority: 2 }),
  chapter({ id: 'biology-0610-practical', subjectId: 'biology-0610', name: 'Biology practical skills', description: 'Plan investigations, handle data, draw biological diagrams and evaluate experimental evidence.', themes: ['microscopy', 'variables', 'data handling', 'magnification', 'evaluation'], stageTags: ['IGCSE'], priority: 1 }),
  chapter({ id: 'biology-9700-as-cell', subjectId: 'biology-9700', name: 'AS cells and biological molecules', description: 'Cell structure, biological molecules, enzymes, membranes and transport at AS Level.', themes: ['cell structure', 'biological molecules', 'enzymes', 'membranes', 'transport'], stageTags: ['AS'], priority: 1 }),
  chapter({ id: 'biology-9700-as-transport', subjectId: 'biology-9700', name: 'AS transport and gas exchange', description: 'Transport in plants and mammals, gas exchange and infectious disease.', themes: ['transport in plants', 'transport in mammals', 'gas exchange', 'infectious disease'], stageTags: ['AS'], priority: 1 }),
  chapter({ id: 'biology-9700-as-genetics', subjectId: 'biology-9700', name: 'AS biodiversity and classification', description: 'Genetic information, biodiversity, classification and evolution in the AS specification.', themes: ['nucleic acids', 'protein synthesis', 'biodiversity', 'classification', 'evolution'], stageTags: ['AS'], priority: 2 }),
  chapter({ id: 'biology-9700-a2-energy', subjectId: 'biology-9700', name: 'A2 energy, response and homeostasis', description: 'Photosynthesis, respiration, coordination, responses and homeostasis at A2.', themes: ['photosynthesis', 'respiration', 'neurons', 'muscles', 'homeostasis'], stageTags: ['A2'], priority: 1 }),
  chapter({ id: 'biology-9700-a2-inheritance', subjectId: 'biology-9700', name: 'A2 inheritance and evolution', description: 'Inheritance, selection, evolution and population genetics using evidence and models.', themes: ['inheritance', 'selection', 'evolution', 'population genetics'], stageTags: ['A2'], priority: 1 }),
  chapter({ id: 'biology-9700-a2-biotechnology', subjectId: 'biology-9700', name: 'A2 biotechnology and practical skills', description: 'Gene technology, biotechnology, ecology and advanced planning, analysis and evaluation.', themes: ['gene technology', 'biotechnology', 'ecology', 'planning', 'data analysis'], stageTags: ['A2'], priority: 2 }),
  chapter({ id: 'chemistry-9701-physical', subjectId: 'chemistry-9701', name: 'Physical chemistry', description: 'Atomic structure, stoichiometry, bonding, energetics, electrochemistry, equilibria and kinetics.', themes: ['atomic structure', 'stoichiometry', 'chemical bonding', 'states of matter', 'energetics', 'electrochemistry', 'equilibria', 'reaction kinetics'], stageTags: ['AS', 'A2'], priority: 1 }),
  chapter({ id: 'chemistry-9701-inorganic', subjectId: 'chemistry-9701', name: 'Inorganic chemistry', description: 'Periodicity, Group 2, Group 17, nitrogen, sulfur and transition-element chemistry.', themes: ['periodicity', 'Group 2', 'Group 17', 'nitrogen and sulfur', 'transition elements'], stageTags: ['AS', 'A2'], priority: 2 }),
  chapter({ id: 'chemistry-9701-organic', subjectId: 'chemistry-9701', name: 'Organic chemistry', description: 'Functional groups, mechanisms, synthesis and polymerisation across AS and A Level.', themes: ['hydrocarbons', 'halogen compounds', 'hydroxy compounds', 'carbonyl compounds', 'carboxylic acids', 'nitrogen compounds', 'polymerisation', 'organic synthesis'], stageTags: ['AS', 'A2'], priority: 1 }),
  chapter({ id: 'chemistry-9701-analysis', subjectId: 'chemistry-9701', name: 'Analysis and practical skills', description: 'Analytical techniques plus planning, observation, data analysis and evaluation.', themes: ['analytical techniques', 'qualitative analysis', 'planning', 'measurements', 'uncertainty', 'evaluation'], stageTags: ['AS', 'A2'], priority: 2 }),

  chapter({ id: 'economics-9708-as-micro', subjectId: 'economics-9708', name: 'AS microeconomics', description: 'Scarcity, resource allocation, demand and supply, elasticity and government microeconomic intervention.', themes: ['basic economic ideas', 'price system', 'elasticity', 'market failure', 'government intervention'], stageTags: ['AS'], priority: 1 }),
  chapter({ id: 'economics-9708-as-macro', subjectId: 'economics-9708', name: 'AS macroeconomics', description: 'Macroeconomic indicators, aggregate demand and supply, policy and international trade.', themes: ['macroeconomic indicators', 'aggregate demand and supply', 'macroeconomic policy', 'international trade and exchange rates'], stageTags: ['AS'], priority: 1 }),
  chapter({ id: 'economics-9708-a2-micro', subjectId: 'economics-9708', name: 'A Level microeconomics', description: 'Utility, efficiency, market structures, firm behaviour, labour markets and intervention.', themes: ['utility', 'efficiency', 'market structures', 'firm objectives', 'labour markets', 'government microeconomic intervention'], stageTags: ['A2'], priority: 1 }),
  chapter({ id: 'economics-9708-a2-macro', subjectId: 'economics-9708', name: 'A Level macroeconomics', description: 'Income determination, growth, employment, money, banking and macroeconomic policy.', themes: ['circular flow and multiplier', 'growth and sustainability', 'employment', 'money and banking', 'macroeconomic policy'], stageTags: ['A2'], priority: 1 }),
  chapter({ id: 'economics-9708-international', subjectId: 'economics-9708', name: 'International economic issues', description: 'Balance of payments, exchange rates, development, globalisation and relationships between economies.', themes: ['balance of payments', 'exchange rates', 'economic development', 'international aid', 'globalisation'], stageTags: ['A2'], priority: 2 }),

  chapter({ id: 'math-0580-number', subjectId: 'math-0580', name: 'Number', description: 'Use number, ratio, percentage, standard form and bounds in Core and Extended contexts.', themes: ['number', 'ratio and proportion', 'percentages', 'standard form', 'bounds'], priority: 1 }),
  chapter({ id: 'math-0580-algebra', subjectId: 'math-0580', name: 'Algebra and graphs', description: 'Manipulate expressions, solve equations and interpret functions and graphs.', themes: ['algebra', 'equations', 'sequences', 'functions and graphs'], priority: 1 }),
  chapter({ id: 'math-0580-coordinate', subjectId: 'math-0580', name: 'Coordinate geometry', description: 'Work with gradients, equations of lines and coordinate relationships.', themes: ['coordinates', 'gradient', 'straight-line graphs'], priority: 2 }),
  chapter({ id: 'math-0580-geometry', subjectId: 'math-0580', name: 'Geometry', description: 'Apply angle, similarity, symmetry and circle properties with reasons.', themes: ['angles', 'similarity', 'symmetry', 'circle theorems'], priority: 2 }),
  chapter({ id: 'math-0580-mensuration', subjectId: 'math-0580', name: 'Mensuration', description: 'Calculate lengths, areas and volumes with correct units and accuracy.', themes: ['perimeter and area', 'surface area', 'volume'], priority: 2 }),
  chapter({ id: 'math-0580-trigonometry', subjectId: 'math-0580', name: 'Trigonometry', description: 'Use right-triangle trigonometry, bearings and sine and cosine rules.', themes: ['right triangles', 'bearings', 'sine rule', 'cosine rule'], priority: 1 }),
  chapter({ id: 'math-0580-transformations', subjectId: 'math-0580', name: 'Transformations and vectors', description: 'Describe transformations and calculate with two-dimensional vectors.', themes: ['transformations', 'vectors', 'vector geometry'], priority: 3 }),
  chapter({ id: 'math-0580-probability', subjectId: 'math-0580', name: 'Probability', description: 'Model single and combined events using diagrams, tables and exact probabilities.', themes: ['single events', 'combined events', 'tree diagrams'], priority: 2 }),
  chapter({ id: 'math-0580-statistics', subjectId: 'math-0580', name: 'Statistics', description: 'Represent, summarise and interpret data using appropriate statistical methods.', themes: ['data representation', 'averages', 'cumulative frequency', 'histograms'], priority: 2 }),

  chapter({ id: 'math-0606-functions', subjectId: 'math-0606', name: 'Functions', description: 'Use function notation, composite functions, inverse functions and domains.', themes: ['functions', 'composite functions', 'inverse functions'], priority: 1 }),
  chapter({ id: 'math-0606-quadratics', subjectId: 'math-0606', name: 'Quadratics and polynomials', description: 'Use quadratic properties, discriminants, factors and polynomial reasoning.', themes: ['quadratic functions', 'discriminant', 'factors of polynomials'], priority: 1 }),
  chapter({ id: 'math-0606-equations', subjectId: 'math-0606', name: 'Equations, inequalities and graphs', description: 'Solve simultaneous equations and inequalities and connect algebra to graphs.', themes: ['simultaneous equations', 'inequalities', 'graphs'], priority: 1 }),
  chapter({ id: 'math-0606-indices', subjectId: 'math-0606', name: 'Indices, surds and logarithms', description: 'Manipulate exact forms and solve exponential and logarithmic equations.', themes: ['indices', 'surds', 'logarithms', 'exponentials'], priority: 2 }),
  chapter({ id: 'math-0606-trigonometry', subjectId: 'math-0606', name: 'Coordinate geometry and trigonometry', description: 'Use straight lines, circular measure, identities and trigonometric equations.', themes: ['straight-line graphs', 'circular measure', 'trigonometry'], priority: 2 }),
  chapter({ id: 'math-0606-series', subjectId: 'math-0606', name: 'Combinatorics and series', description: 'Apply permutations, combinations, binomial expansion and sequences.', themes: ['permutations and combinations', 'binomial theorem', 'series'], priority: 3 }),
  chapter({ id: 'math-0606-vectors', subjectId: 'math-0606', name: 'Vectors in two dimensions', description: 'Represent and solve geometrical problems using vector methods.', themes: ['vectors', 'magnitude', 'vector geometry'], priority: 3 }),
  chapter({ id: 'math-0606-calculus', subjectId: 'math-0606', name: 'Differentiation and integration', description: 'Differentiate and integrate functions and apply calculus to rates, areas and stationary points.', themes: ['differentiation', 'stationary points', 'integration', 'kinematics'], priority: 1 }),
])

const ADDITIONAL_SUBJECTS = [
  {
    id: 'biology-9700',
    code: '9700',
    name: 'Biology',
    qualification: 'Cambridge International AS & A Level',
    syllabusUrl: SOURCES['9700'].syllabus,
    knowledgeGroupIds: additionalKnowledgeGroups.filter((item) => item.subjectId === 'biology-9700').map((item) => item.id),
    mockConfigIds: [],
  },
  {
    id: 'biology-0610',
    code: '0610',
    name: 'IGCSE Biology',
    qualification: 'Cambridge IGCSE',
    syllabusUrl: SOURCES['0610'].syllabus,
    knowledgeGroupIds: additionalKnowledgeGroups.filter((item) => item.subjectId === 'biology-0610').map((item) => item.id),
    mockConfigIds: [],
  },
  {
    id: 'chemistry-9701',
    code: '9701',
    name: 'Chemistry',
    qualification: 'Cambridge International AS & A Level',
    syllabusUrl: SOURCES['9701'].syllabus,
    knowledgeGroupIds: additionalKnowledgeGroups.filter((item) => item.subjectId === 'chemistry-9701').map((item) => item.id),
    mockConfigIds: [],
  },
  {
    id: 'economics-9708',
    code: '9708',
    name: 'Economics',
    qualification: 'Cambridge International AS & A Level',
    syllabusUrl: SOURCES['9708'].syllabus,
    knowledgeGroupIds: additionalKnowledgeGroups.filter((item) => item.subjectId === 'economics-9708').map((item) => item.id),
    mockConfigIds: [],
  },
  {
    id: 'math-0580',
    code: '0580',
    name: 'IGCSE Mathematics',
    qualification: 'Cambridge IGCSE',
    syllabusUrl: SOURCES['0580'].syllabus,
    knowledgeGroupIds: additionalKnowledgeGroups.filter((item) => item.subjectId === 'math-0580').map((item) => item.id),
    mockConfigIds: [],
  },
  {
    id: 'math-0606',
    code: '0606',
    name: 'IGCSE Additional Mathematics',
    qualification: 'Cambridge IGCSE',
    syllabusUrl: SOURCES['0606'].syllabus,
    knowledgeGroupIds: additionalKnowledgeGroups.filter((item) => item.subjectId === 'math-0606').map((item) => item.id),
    mockConfigIds: [],
  },
]

export const additionalSubjects = Object.freeze(ADDITIONAL_SUBJECTS.map((subject) => {
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

function provenance(code, paperRef = null) {
  return {
    source: paperRef ? 'Cambridge question paper and mark scheme indexed from the local verified library' : `Original practice aligned to the public Cambridge ${code} syllabus`,
    licenseStatus: paperRef ? 'Official source reference; personal study library' : 'Original practice, not official paper text',
    paperRef: paperRef || SOURCES[code].syllabus,
    syllabusUrl: SOURCES[code].syllabus,
  }
}

function numericUnit({ id, subjectId, groupId, code, topic, subtopic, prompt, value, units = [''], tolerance = 0, marks = 2, stage = 'IGCSE', sourceRef = null }) {
  const routeId = resolveRouteId({
    subjectId,
    stage,
    paperComponent: sourceRef?.component,
    sourcePaper: sourceRef?.paper,
    knowledgeGroupId: groupId,
    year: sourceRef?.year,
  }) || LEGACY_UNSCOPED_ROUTE_ID
  const route = routeById(routeId)
  const routeFields = {
    routeId,
    qualification: route?.qualification || null,
    stage: route?.stage || LEGACY_UNSCOPED_ROUTE_ID,
    paperComponent: sourceRef?.component ?? null,
    syllabusTopic: groupId,
    sourcePaper: sourceRef?.paper || null,
  }
  return Object.freeze({
    id,
    type: 'topic',
    subjectId,
    ...routeFields,
    knowledgeGroupId: groupId,
    topicId: groupId,
    topic,
    subtopic,
    title: `${subtopic} checkpoint`,
    icon: '#',
    board: `Cambridge ${code}`,
    specification: `${code} ${stage} syllabus practice`,
    stageTags: Object.freeze([stage]),
    durationSec: 6 * 60,
    maxMarks: marks,
    difficulty: 'Core skill',
    estimatedMinutes: 6,
    priority: 'Chapter practice',
    provenance: provenance(code, sourceRef?.paper),
    parts: Object.freeze([Object.freeze({
      id: `${id}-a`,
      ...routeFields,
      label: 'a',
      marks,
      answerType: 'numeric',
      prompt,
      acceptedValue: value,
      tolerance,
      acceptedUnits: units,
      markPoints: marks === 1 ? ['Gives the correct value.'] : ['Uses a valid method.', 'Gives the correct final answer.'],
      sourceRef,
    })]),
  })
}

function mcqUnit({ id, subjectId, groupId, code, topic, subtopic, prompt, options, answer, stage = 'IGCSE' }) {
  const routeId = resolveRouteId({ subjectId, stage, knowledgeGroupId: groupId }) || LEGACY_UNSCOPED_ROUTE_ID
  const route = routeById(routeId)
  const routeFields = {
    routeId,
    qualification: route?.qualification || null,
    stage: route?.stage || LEGACY_UNSCOPED_ROUTE_ID,
    paperComponent: null,
    syllabusTopic: groupId,
    sourcePaper: null,
  }
  return Object.freeze({
    id,
    type: 'topic',
    subjectId,
    ...routeFields,
    knowledgeGroupId: groupId,
    topicId: groupId,
    topic,
    subtopic,
    title: `${subtopic} checkpoint`,
    icon: '?',
    board: `Cambridge ${code}`,
    specification: `${code} ${stage} syllabus practice`,
    stageTags: Object.freeze([stage]),
    durationSec: 4 * 60,
    maxMarks: 1,
    difficulty: 'Core skill',
    estimatedMinutes: 4,
    priority: 'Chapter practice',
    provenance: provenance(code),
    parts: Object.freeze([Object.freeze({ id: `${id}-a`, ...routeFields, label: 'a', marks: 1, answerType: 'multiple-choice', prompt, options, answer, markPoints: ['Selects the correct result or method.'] })]),
  })
}

export const curriculumPracticeUnits = Object.freeze([
  numericUnit({ id: 'topic-0580-number-past', subjectId: 'igcse-math', groupId: 'math-0580-number', code: '0580', topic: 'Number', subtopic: 'Cost and multiplication', prompt: 'Oranges cost 220 rupees per kilogram. Work out the cost of 9 kg of oranges.', value: 1980, units: ['', 'rupees'], marks: 1, sourceRef: { paper: '0580_m25_qp_22.pdf', question: 'Q1', page: 3, localUrl: '/local-pdf/0580/0580_m25_qp_22.pdf#page=3', markSchemeUrl: '/local-pdf/0580/0580_m25_ms_22.pdf#page=6' } }),
  numericUnit({ id: 'topic-0580-algebra', subjectId: 'igcse-math', groupId: 'math-0580-algebra', code: '0580', topic: 'Algebra and graphs', subtopic: 'Linear equations', prompt: 'Solve 3x + 5 = 20.', value: 5 }),
  numericUnit({ id: 'topic-0580-coordinate', subjectId: 'igcse-math', groupId: 'math-0580-coordinate', code: '0580', topic: 'Coordinate geometry', subtopic: 'Gradient', prompt: 'Find the gradient of the line through (2, 3) and (6, 11).', value: 2 }),
  numericUnit({ id: 'topic-0580-geometry', subjectId: 'igcse-math', groupId: 'math-0580-geometry', code: '0580', topic: 'Geometry', subtopic: 'Regular polygons', prompt: 'The exterior angle of a regular polygon is 30 degrees. Find the number of sides.', value: 12 }),
  numericUnit({ id: 'topic-0580-mensuration', subjectId: 'igcse-math', groupId: 'math-0580-mensuration', code: '0580', topic: 'Mensuration', subtopic: 'Cylinder volume', prompt: 'A cylinder has radius 3 cm and height 5 cm. Calculate its volume, using pi = 3.142.', value: 141.39, units: ['cm^3', 'cm3'], tolerance: 0.05 }),
  numericUnit({ id: 'topic-0580-trigonometry', subjectId: 'igcse-math', groupId: 'math-0580-trigonometry', code: '0580', topic: 'Trigonometry', subtopic: 'Right triangles', prompt: 'In a right triangle, the opposite side is 6 cm and the hypotenuse is 10 cm. Find the angle in degrees.', value: 36.87, units: ['', 'degree', 'degrees'], tolerance: 0.1 }),
  mcqUnit({ id: 'topic-0580-transformations', subjectId: 'igcse-math', groupId: 'math-0580-transformations', code: '0580', topic: 'Transformations and vectors', subtopic: 'Translations', prompt: 'The vector (3, -2) translates the point (1, 4). What is its image?', options: ['(4, 2)', '(4, 6)', '(-2, 2)', '(3, -8)'], answer: '(4, 2)' }),
  numericUnit({ id: 'topic-0580-probability', subjectId: 'igcse-math', groupId: 'math-0580-probability', code: '0580', topic: 'Probability', subtopic: 'Single events', prompt: 'A bag contains 3 red and 5 blue counters. Find the probability of selecting a red counter.', value: 0.375, tolerance: 0.001 }),
  numericUnit({ id: 'topic-0580-statistics', subjectId: 'igcse-math', groupId: 'math-0580-statistics', code: '0580', topic: 'Statistics', subtopic: 'Mean', prompt: 'Find the mean of 4, 7, 9 and 10.', value: 7.5 }),

  numericUnit({ id: 'topic-0606-functions', subjectId: 'additional-math', groupId: 'math-0606-functions', code: '0606', topic: 'Functions', subtopic: 'Composite functions', prompt: 'Given f(x) = 2x + 1 and g(x) = x^2, find f(g(3)).', value: 19 }),
  numericUnit({ id: 'topic-0606-quadratics', subjectId: 'additional-math', groupId: 'math-0606-quadratics', code: '0606', topic: 'Quadratics and polynomials', subtopic: 'Discriminant', prompt: 'Find the discriminant of x^2 - 6x + 5.', value: 16 }),
  mcqUnit({ id: 'topic-0606-equations', subjectId: 'additional-math', groupId: 'math-0606-equations', code: '0606', topic: 'Equations, inequalities and graphs', subtopic: 'Inequalities', prompt: 'Which interval solves 2x - 3 > 5?', options: ['x > 4', 'x < 4', 'x > 1', 'x < 1'], answer: 'x > 4' }),
  numericUnit({ id: 'topic-0606-indices', subjectId: 'additional-math', groupId: 'math-0606-indices', code: '0606', topic: 'Indices, surds and logarithms', subtopic: 'Logarithms', prompt: 'Find log base 2 of 32.', value: 5 }),
  numericUnit({ id: 'topic-0606-trigonometry', subjectId: 'additional-math', groupId: 'math-0606-trigonometry', code: '0606', topic: 'Coordinate geometry and trigonometry', subtopic: 'Circular measure', prompt: 'Find the arc length when radius r = 4 and angle theta = 1.2 radians.', value: 4.8 }),
  numericUnit({ id: 'topic-0606-series', subjectId: 'additional-math', groupId: 'math-0606-series', code: '0606', topic: 'Combinatorics and series', subtopic: 'Combinations', prompt: 'Calculate the number of ways to choose 2 students from 5 students.', value: 10 }),
  numericUnit({ id: 'topic-0606-vectors', subjectId: 'additional-math', groupId: 'math-0606-vectors', code: '0606', topic: 'Vectors in two dimensions', subtopic: 'Magnitude', prompt: 'Find the magnitude of the vector (5, 12).', value: 13 }),
  numericUnit({ id: 'topic-0606-calculus', subjectId: 'additional-math', groupId: 'math-0606-calculus', code: '0606', topic: 'Differentiation and integration', subtopic: 'Differentiation', prompt: 'For y = 4x^3 - 3x, find dy/dx when x = 2.', value: 45 }),

  numericUnit({ id: 'topic-0625-electricity', subjectId: 'igcse-physics', groupId: 'physics-0625-electricity', code: '0625', topic: 'Electricity', subtopic: 'Potential difference', prompt: 'A current of 2.0 A flows through a 6.0 ohm resistor. Calculate the potential difference.', value: 12, units: ['V', 'volt', 'volts'], stage: 'IGCSE' }),
  numericUnit({ id: 'topic-0625-thermal', subjectId: 'igcse-physics', groupId: 'physics-0625-thermal', code: '0625', topic: 'Thermal physics', subtopic: 'Specific heat capacity', prompt: 'A 0.50 kg block receives 2100 J of energy. Its specific heat capacity is 420 J/(kg K). Calculate its temperature increase.', value: 10, units: ['K', 'C', 'degrees C'], stage: 'IGCSE' }),
  numericUnit({ id: 'topic-0625-waves', subjectId: 'igcse-physics', groupId: 'physics-0625-waves', code: '0625', topic: 'Waves and thermal physics', subtopic: 'Wave speed', prompt: 'A wave has frequency 500 Hz and wavelength 0.68 m. Calculate its speed.', value: 340, units: ['m/s', 'm s^-1', 'ms^-1'], stage: 'IGCSE' }),
  numericUnit({ id: 'topic-0625-atomic', subjectId: 'igcse-physics', groupId: 'physics-0625-atomic-space', code: '0625', topic: 'Magnetism, space and atomic physics', subtopic: 'Half-life', prompt: 'A sample has count rate 80 counts per minute. Find the count rate after three half-lives.', value: 10, units: ['counts/min', 'counts per minute'], stage: 'IGCSE' }),
  numericUnit({ id: 'topic-0625-space', subjectId: 'igcse-physics', groupId: 'physics-0625-space', code: '0625', topic: 'Space physics', subtopic: 'Orbital speed', prompt: 'A planet travels 9.0e11 m in 3.0e7 s. Calculate its average orbital speed.', value: 30000, units: ['m/s', 'm s^-1', 'ms^-1'], tolerance: 1, stage: 'IGCSE' }),

  numericUnit({ id: 'topic-9702-electricity', subjectId: 'physics', groupId: 'physics-9702-electricity', code: '9702', topic: 'Electricity', subtopic: 'Charge and current', prompt: 'A charge of 12 C passes a point in 3.0 s. Calculate the current.', value: 4, units: ['A', 'ampere', 'amperes'], stage: 'AS' }),
  numericUnit({ id: 'topic-9702-fields', subjectId: 'physics', groupId: 'physics-9702-fields', code: '9702', topic: 'Fields', subtopic: 'Electric field force', prompt: 'A charge of 2.0e-6 C is in an electric field of strength 3000 N/C. Calculate the force.', value: 0.006, units: ['N', 'newton', 'newtons'], tolerance: 0.00001, stage: 'A2' }),
  numericUnit({ id: 'topic-9702-particles', subjectId: 'physics', groupId: 'physics-9702-particles', code: '9702', topic: 'Particles and nuclear physics', subtopic: 'Half-life', prompt: 'The activity is initially 160 Bq. Find the activity after three half-lives.', value: 20, units: ['Bq', 'becquerel', 'becquerels'], stage: 'A2' }),
  numericUnit({ id: 'topic-9702-thermal', subjectId: 'physics', groupId: 'physics-9702-thermal', code: '9702', topic: 'Thermal physics', subtopic: 'Ideal gases', prompt: 'One mole of ideal gas is at 300 K in a volume of 0.025 m^3. Using R = 8.31, calculate the pressure.', value: 99720, units: ['Pa', 'pascal', 'pascals'], tolerance: 5, stage: 'A2' }),
  numericUnit({ id: 'topic-9702-practical', subjectId: 'physics', groupId: 'physics-9702-practical-data', code: '9702', topic: 'Practical and data analysis', subtopic: 'Percentage uncertainty', prompt: 'A length is measured as 10.0 +/- 0.2 cm. Calculate the percentage uncertainty.', value: 2, units: ['%', 'percent'], stage: 'AS/A2' }),

  numericUnit({ id: 'topic-9709-mechanics', subjectId: 'math', groupId: 'math-9709-mechanics', code: '9709', topic: 'Mechanics', subtopic: 'Constant acceleration', prompt: 'A particle starts from rest with acceleration 2 m/s^2 for 4 s. Calculate the displacement.', value: 16, units: ['m', 'metre', 'metres'], stage: 'AS/A2' }),
  numericUnit({ id: 'topic-9709-statistics', subjectId: 'math', groupId: 'math-9709-statistics', code: '9709', topic: 'Statistics and probability', subtopic: 'Binomial expectation', prompt: 'For X distributed as Bin(20, 0.3), find E(X).', value: 6, stage: 'AS/A2' }),
  numericUnit({ id: 'topic-9709-problem', subjectId: 'math', groupId: 'math-9709-problem-solving', code: '9709', topic: 'Mathematical problem solving', subtopic: 'Method selection', prompt: 'The arithmetic sequence has first term 7 and common difference 3. Find its 20th term.', value: 64, stage: 'AS' }),

  numericUnit({ id: 'topic-9231-mechanics', subjectId: 'further-math', groupId: 'math-9231-further-mechanics', code: '9231', topic: 'Further Mechanics', subtopic: 'Momentum', prompt: 'A 2 kg particle moving at 5 m/s sticks to a 3 kg particle at rest. Find their common speed.', value: 2, units: ['m/s', 'm s^-1', 'ms^-1'], stage: 'AS/A2' }),
  numericUnit({ id: 'topic-9231-statistics', subjectId: 'further-math', groupId: 'math-9231-further-statistics', code: '9231', topic: 'Further Probability and Statistics', subtopic: 'Variance', prompt: 'For X distributed as Bin(20, 0.3), find Var(X).', value: 4.2, stage: 'AS/A2' }),
  numericUnit({ id: 'topic-9231-problem', subjectId: 'further-math', groupId: 'math-9231-problem-solving', code: '9231', topic: 'Further problem solving', subtopic: 'Complex-number check', prompt: 'Find the real part of (2 + 3i)(4 - i).', value: 11, stage: 'AS/A2' }),
])
