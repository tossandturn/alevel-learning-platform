export const LEGACY_UNSCOPED_ROUTE_ID = 'legacy-unscoped'

export function formatRouteComponents(components = []) {
  return components.map((component) => {
    if (typeof component === 'number') return `P${component}`
    return String(component)
      .replaceAll('-', ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  }).join(' + ')
}

const QUALIFICATIONS = Object.freeze({
  IGCSE: 'IGCSE',
  A_LEVEL: 'A-Level',
  ADMISSIONS: 'Admissions',
})

const TOPICS = Object.freeze({
  '0625-igcse': ['Motion, forces and energy', 'Thermal physics', 'Waves', 'Electricity and magnetism', 'Nuclear physics', 'Space physics'],
  '0610-igcse': ['Characteristics and classification', 'Organisation of the organism', 'Movement in and out of cells', 'Biological molecules', 'Enzymes', 'Plant nutrition', 'Human nutrition', 'Transport', 'Diseases and immunity', 'Gas exchange', 'Respiration', 'Excretion', 'Coordination and response', 'Reproduction', 'Inheritance', 'Variation and selection', 'Organisms and their environment', 'Human influences on ecosystems', 'Biotechnology and genetic modification'],
  '0580-igcse': ['Number', 'Algebra and graphs', 'Coordinate geometry', 'Geometry', 'Mensuration', 'Trigonometry', 'Transformations and vectors', 'Probability', 'Statistics'],
  '0606-igcse': ['Functions', 'Quadratics and polynomials', 'Equations, inequalities and graphs', 'Indices, surds and logarithms', 'Factors of polynomials', 'Simultaneous equations', 'Logarithmic and exponential functions', 'Straight-line graphs', 'Circular measure', 'Trigonometry', 'Permutations and combinations', 'Series', 'Vectors', 'Calculus'],
  '9702-as': ['Physical quantities and units', 'Kinematics', 'Dynamics', 'Forces, density and pressure', 'Work, energy and power', 'Deformation of solids', 'Waves', 'Superposition', 'Electricity', 'D.C. circuits', 'Particle physics', 'AS practical skills'],
  '9702-a2': ['Motion in a circle', 'Gravitational fields', 'Temperature', 'Ideal gases', 'Thermodynamics', 'Oscillations', 'Electric fields', 'Capacitance', 'Magnetic fields', 'Alternating currents', 'Quantum physics', 'Nuclear physics', 'Medical physics', 'Astronomy and cosmology', 'A2 planning, analysis and evaluation'],
  '9700-as': ['Cell structure', 'Biological molecules', 'Enzymes', 'Cell membranes and transport', 'The mitotic cell cycle', 'Nucleic acids and protein synthesis', 'Transport in plants', 'Transport in mammals', 'Gas exchange', 'Infectious diseases', 'Immunity', 'AS practical skills'],
  '9700-a2': ['Energy and respiration', 'Photosynthesis', 'Homeostasis', 'Control and coordination', 'Inheritance', 'Selection and evolution', 'Classification, biodiversity and conservation', 'Genetic technology', 'A2 planning, analysis and evaluation'],
  '9701-as': ['Atomic structure', 'Atoms, molecules and stoichiometry', 'Chemical bonding', 'States of matter', 'Chemical energetics', 'Electrochemistry', 'Equilibria', 'Reaction kinetics', 'Periodicity', 'Group 2', 'Group 17', 'Nitrogen and sulfur', 'AS organic chemistry', 'AS analytical techniques', 'AS practical skills'],
  '9701-a2': ['A2 energetics', 'Electrochemistry', 'Equilibria', 'Reaction kinetics', 'Transition elements', 'A2 organic chemistry', 'A2 analytical techniques', 'A2 planning, analysis and evaluation'],
  '9708-as': ['Basic economic ideas and resource allocation', 'The price system and the microeconomy', 'Government microeconomic intervention', 'The macroeconomy', 'Government macroeconomic intervention', 'International economic issues'],
  '9708-a2': ['The price system and the microeconomy', 'Government microeconomic intervention', 'The macroeconomy', 'Government macroeconomic intervention', 'International economic issues'],
  '9709-as': ['Pure Mathematics 1', 'Pure Mathematics 2 (AS-only route)', 'Mechanics', 'Probability and Statistics 1'],
  '9709-a2': ['Pure Mathematics 3', 'Mechanics when selected for A Level completion', 'Probability and Statistics 1 when selected for A Level completion', 'Probability and Statistics 2'],
  '9231-as': ['Further Pure Mathematics 1', 'Further Mechanics', 'Further Probability and Statistics'],
  '9231-a2': ['Further Pure Mathematics 2', 'Further Mechanics when selected for A Level completion', 'Further Probability and Statistics when selected for A Level completion'],
  bpho: ['Mechanics', 'Waves', 'Electricity and magnetism', 'Thermal physics', 'Modern physics'],
  amc12: ['Algebra', 'Geometry', 'Number theory', 'Combinatorics and probability'],
  esat: ['Mathematics 1', 'Mathematics 2', 'Physics', 'Chemistry', 'Biology'],
  tmua: ['Mathematical knowledge and application', 'Mathematical reasoning'],
})

const SYLLABUS = Object.freeze({
  '0580': ['2025-2027', 'https://www.cambridgeinternational.org/Images/662466-2025-2027-syllabus.pdf'],
  '0606': ['2025-2027', 'https://www.cambridgeinternational.org/Images/662470-2025-2027-syllabus.pdf'],
  '0610': ['2026-2028', 'https://www.cambridgeinternational.org/Images/697203-2026-2028-syllabus.pdf'],
  '0625': ['2026-2028', 'https://www.cambridgeinternational.org/Images/697209-2026-2028-syllabus.pdf'],
  '9700': ['2025-2027', 'https://www.cambridgeinternational.org/Images/664560-2025-2027-syllabus.pdf'],
  '9701': ['2025-2027', 'https://www.cambridgeinternational.org/Images/664563-2025-2027-syllabus.pdf'],
  '9702': ['2025-2027', 'https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf'],
  '9708': ['2026-2028', 'https://www.cambridgeinternational.org/Images/697423-2026-2028-syllabus.pdf'],
  '9709': ['2026-2027', 'https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf'],
  '9231': ['2026-2027', 'https://www.cambridgeinternational.org/Images/697357-2026-2027-syllabus.pdf'],
})

function freezeTopics(key) {
  return Object.freeze((TOPICS[key] || []).map((title, index) => Object.freeze({
    id: `${key}-topic-${String(index + 1).padStart(2, '0')}`,
    title,
  })))
}

function cieRoute({ routeId, qualification, stage, subject, subjectId, code, paperComponents, topicKey }) {
  const [version, url] = SYLLABUS[code]
  return Object.freeze({
    routeId,
    qualification,
    qualificationId: qualification === QUALIFICATIONS.IGCSE ? 'cie-igcse' : 'cie-a-level',
    stage,
    subject,
    subjectId,
    subjectCode: code,
    paperComponents: Object.freeze([...paperComponents]),
    syllabus: Object.freeze({ board: 'Cambridge International', code, version, url, topics: freezeTopics(topicKey) }),
  })
}

function admissionsRoute({ routeId, subject, subjectId, paperComponents = [], topicKey }) {
  return Object.freeze({
    routeId,
    qualification: QUALIFICATIONS.ADMISSIONS,
    qualificationId: 'admissions',
    stage: 'Admissions',
    subject,
    subjectId,
    subjectCode: subjectId,
    paperComponents: Object.freeze([...paperComponents]),
    syllabus: Object.freeze({ board: 'Official assessment provider', code: subjectId, version: 'current', url: null, topics: freezeTopics(topicKey) }),
  })
}

export const courseRoutes = Object.freeze([
  cieRoute({ routeId: 'cie-0580-igcse-mathematics', qualification: QUALIFICATIONS.IGCSE, stage: 'IGCSE', subject: 'Mathematics', subjectId: 'math-0580', code: '0580', paperComponents: [1, 2, 3, 4], topicKey: '0580-igcse' }),
  cieRoute({ routeId: 'cie-0606-igcse-additional-mathematics', qualification: QUALIFICATIONS.IGCSE, stage: 'IGCSE', subject: 'Additional Mathematics', subjectId: 'math-0606', code: '0606', paperComponents: [1, 2], topicKey: '0606-igcse' }),
  cieRoute({ routeId: 'cie-0610-igcse-biology', qualification: QUALIFICATIONS.IGCSE, stage: 'IGCSE', subject: 'Biology', subjectId: 'biology-0610', code: '0610', paperComponents: [1, 2, 3, 4, 5, 6], topicKey: '0610-igcse' }),
  cieRoute({ routeId: 'cie-0625-igcse-physics', qualification: QUALIFICATIONS.IGCSE, stage: 'IGCSE', subject: 'Physics', subjectId: 'physics-0625', code: '0625', paperComponents: [1, 2, 3, 4, 5, 6], topicKey: '0625-igcse' }),
  cieRoute({ routeId: 'cie-9700-as-biology', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Biology', subjectId: 'biology-9700', code: '9700', paperComponents: [1, 2, 3], topicKey: '9700-as' }),
  cieRoute({ routeId: 'cie-9700-a2-biology', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Biology', subjectId: 'biology-9700', code: '9700', paperComponents: [4, 5], topicKey: '9700-a2' }),
  cieRoute({ routeId: 'cie-9701-as-chemistry', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Chemistry', subjectId: 'chemistry-9701', code: '9701', paperComponents: [1, 2, 3], topicKey: '9701-as' }),
  cieRoute({ routeId: 'cie-9701-a2-chemistry', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Chemistry', subjectId: 'chemistry-9701', code: '9701', paperComponents: [4, 5], topicKey: '9701-a2' }),
  cieRoute({ routeId: 'cie-9702-as-physics', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Physics', subjectId: 'physics-9702', code: '9702', paperComponents: [1, 2, 3], topicKey: '9702-as' }),
  cieRoute({ routeId: 'cie-9702-a2-physics', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Physics', subjectId: 'physics-9702', code: '9702', paperComponents: [4, 5], topicKey: '9702-a2' }),
  cieRoute({ routeId: 'cie-9708-as-economics', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Economics', subjectId: 'economics-9708', code: '9708', paperComponents: [1, 2], topicKey: '9708-as' }),
  cieRoute({ routeId: 'cie-9708-a2-economics', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Economics', subjectId: 'economics-9708', code: '9708', paperComponents: [3, 4], topicKey: '9708-a2' }),
  cieRoute({ routeId: 'cie-9709-as-p1-p2', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Mathematics', subjectId: 'math-9709', code: '9709', paperComponents: [1, 2], topicKey: '9709-as' }),
  cieRoute({ routeId: 'cie-9709-as-p1-p4', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Mathematics', subjectId: 'math-9709', code: '9709', paperComponents: [1, 4], topicKey: '9709-as' }),
  cieRoute({ routeId: 'cie-9709-as-p1-p5', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Mathematics', subjectId: 'math-9709', code: '9709', paperComponents: [1, 5], topicKey: '9709-as' }),
  cieRoute({ routeId: 'cie-9709-a2-after-p1-p5-p3-p4', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Mathematics', subjectId: 'math-9709', code: '9709', paperComponents: [3, 4], topicKey: '9709-a2' }),
  cieRoute({ routeId: 'cie-9709-a2-after-p1-p5-p3-p6', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Mathematics', subjectId: 'math-9709', code: '9709', paperComponents: [3, 6], topicKey: '9709-a2' }),
  cieRoute({ routeId: 'cie-9709-a2-after-p1-p4-p3-p5', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Mathematics', subjectId: 'math-9709', code: '9709', paperComponents: [3, 5], topicKey: '9709-a2' }),
  cieRoute({ routeId: 'cie-9231-as-p1-p3', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Further Mathematics', subjectId: 'math-9231', code: '9231', paperComponents: [1, 3], topicKey: '9231-as' }),
  cieRoute({ routeId: 'cie-9231-as-p1-p4', qualification: QUALIFICATIONS.A_LEVEL, stage: 'AS', subject: 'Further Mathematics', subjectId: 'math-9231', code: '9231', paperComponents: [1, 4], topicKey: '9231-as' }),
  cieRoute({ routeId: 'cie-9231-a2-after-p1-p3-p2-p4', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Further Mathematics', subjectId: 'math-9231', code: '9231', paperComponents: [2, 4], topicKey: '9231-a2' }),
  cieRoute({ routeId: 'cie-9231-a2-after-p1-p4-p2-p3', qualification: QUALIFICATIONS.A_LEVEL, stage: 'A2', subject: 'Further Mathematics', subjectId: 'math-9231', code: '9231', paperComponents: [2, 3], topicKey: '9231-a2' }),
  admissionsRoute({ routeId: 'bpho-admissions-physics', subject: 'British Physics Olympiad', subjectId: 'bpho', topicKey: 'bpho' }),
  admissionsRoute({ routeId: 'maa-amc12-admissions-mathematics', subject: 'AMC 12', subjectId: 'amc12', topicKey: 'amc12' }),
  admissionsRoute({ routeId: 'uatuk-esat-admissions', subject: 'ESAT', subjectId: 'esat', paperComponents: ['mathematics-1', 'mathematics-2', 'physics', 'chemistry', 'biology'], topicKey: 'esat' }),
  admissionsRoute({ routeId: 'uatuk-tmua-admissions', subject: 'TMUA', subjectId: 'tmua', paperComponents: [1, 2], topicKey: 'tmua' }),
])

const ROUTE_BY_ID = new Map(courseRoutes.map((route) => [route.routeId, route]))

const SUBJECT_ALIASES = Object.freeze({
  '0580': 'math-0580', 'igcse-math': 'math-0580', 'igcse-mathematics': 'math-0580',
  '0606': 'math-0606', 'additional-math': 'math-0606', 'igcse-additional-mathematics': 'math-0606',
  '0610': 'biology-0610', 'igcse-biology': 'biology-0610',
  '0625': 'physics-0625', 'igcse-physics': 'physics-0625',
  '9700': 'biology-9700', biology: 'biology-9700',
  '9701': 'chemistry-9701', chemistry: 'chemistry-9701',
  '9702': 'physics-9702', physics: 'physics-9702',
  '9708': 'economics-9708', economics: 'economics-9708',
  '9709': 'math-9709', math: 'math-9709', mathematics: 'math-9709',
  '9231': 'math-9231', 'further-math': 'math-9231', 'further-mathematics': 'math-9231',
  bpho: 'bpho', amc12: 'amc12', esat: 'esat', tmua: 'tmua',
})

const KNOWLEDGE_GROUP_ROUTE = Object.freeze({
  'physics-9702-electricity': 'cie-9702-as-physics',
  'physics-9702-fields': 'cie-9702-a2-physics',
  'physics-9702-thermal': 'cie-9702-a2-physics',
  'economics-9708-international': 'cie-9708-a2-economics',
})

function canonicalSubjectId(value) {
  const key = String(value || '').trim().toLowerCase()
  if (SUBJECT_ALIASES[key]) return SUBJECT_ALIASES[key]
  const code = key.match(/(?:^|[-_])(0580|0606|0610|0625|9700|9701|9702|9708|9709|9231)(?:$|[-_])/)?.[1]
  return code ? SUBJECT_ALIASES[code] : null
}

function normaliseQualification(value) {
  const key = String(value || '').trim().toLowerCase()
  if (/igcse/.test(key)) return QUALIFICATIONS.IGCSE
  if (/a[ -]?level|as[ &-]+a|cambridge-international/.test(key)) return QUALIFICATIONS.A_LEVEL
  if (/admission|bpho|amc|esat|tmua/.test(key)) return QUALIFICATIONS.ADMISSIONS
  return null
}

function normaliseStage(value) {
  const key = String(value || '').trim().toUpperCase()
  if (key === 'IGCSE' || key === 'AS' || key === 'A2') return key
  if (key === 'ADMISSIONS' || key === 'COMPETITION') return 'Admissions'
  return null
}

function paperNumber(value) {
  if (value == null || value === '') return null
  const match = String(value).trim().match(/(?:^|PAPER\s*|P)([1-6])(?:\d)?(?:$|[^0-9])/i)
  return match ? Number(match[1]) : null
}

function evidenceFromSourcePaper(sourcePaper) {
  const source = String(sourcePaper || '').toLowerCase()
  const subjectCode = source.match(/(?:^|[/\\_-])(0580|0606|0610|0625|9700|9701|9702|9708|9709|9231)(?:[/\\_-]|$)/)?.[1] || null
  const component = source.match(/_(?:qp|ms)_([1-6])\d(?:\.[a-z0-9]+)?(?:#.*)?$/i)?.[1]
  return { subjectCode, paperComponent: component ? Number(component) : null }
}

function routeForKnowledgeGroup(knowledgeGroupId) {
  const id = String(knowledgeGroupId || '').toLowerCase()
  if (!id) return null
  if (KNOWLEDGE_GROUP_ROUTE[id]) return KNOWLEDGE_GROUP_ROUTE[id]
  const official9702 = id.match(/^physics-9702-topic-(\d{2})$/)
  if (official9702) return Number(official9702[1]) <= 11 ? 'cie-9702-as-physics' : 'cie-9702-a2-physics'
  if (/-as(?:-|$)/.test(id)) {
    const subjectId = canonicalSubjectId(id)
    const routes = routesForSubject(subjectId).filter((route) => route.stage === 'AS')
    return routes.length === 1 ? routes[0].routeId : null
  }
  if (/-a2(?:-|$)/.test(id)) {
    const subjectId = canonicalSubjectId(id)
    const routes = routesForSubject(subjectId).filter((route) => route.stage === 'A2')
    return routes.length === 1 ? routes[0].routeId : null
  }
  const subjectId = canonicalSubjectId(id)
  const routes = routesForSubject(subjectId)
  return routes.length === 1 ? routes[0].routeId : null
}

export function routeById(routeId) {
  return ROUTE_BY_ID.get(routeId) || null
}

export function routesForSubject(subjectId) {
  const canonical = canonicalSubjectId(subjectId)
  if (!canonical) return []
  return courseRoutes.filter((route) => route.subjectId === canonical)
}

export function topicsForRoute(routeId) {
  return routeById(routeId)?.syllabus.topics || []
}

export function resolveRouteId({ qualificationId, subjectId, stage, paperComponent, sourcePaper, knowledgeGroupId, year } = {}) {
  const sourceEvidence = evidenceFromSourcePaper(sourcePaper)
  const groupRouteId = routeForKnowledgeGroup(knowledgeGroupId)
  const groupRoute = routeById(groupRouteId)
  const canonical = canonicalSubjectId(subjectId) || canonicalSubjectId(sourceEvidence.subjectCode) || groupRoute?.subjectId || null
  if (!canonical) return null

  let candidates = routesForSubject(canonical)
  const qualification = normaliseQualification(qualificationId)
  const normalisedStage = normaliseStage(stage)
  const component = paperNumber(paperComponent) ?? sourceEvidence.paperComponent

  if (qualification) candidates = candidates.filter((route) => route.qualification === qualification)
  if (normalisedStage) candidates = candidates.filter((route) => route.stage === normalisedStage)
  if (groupRouteId) candidates = candidates.filter((route) => route.routeId === groupRouteId)

  const legacyPaperMapping = Number.isFinite(Number(year)) && (
    (canonical === 'math-9709' && Number(year) <= 2019)
    || (canonical === 'physics-9702' && Number(year) <= 2006)
  )
  if (component != null && !(legacyPaperMapping && !normalisedStage)) {
    candidates = candidates.filter((route) => route.paperComponents.includes(component))
  }

  return candidates.length === 1 ? candidates[0].routeId : null
}
