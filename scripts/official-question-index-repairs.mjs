const PAPER_ID = 'cie-9709-9709_m25_qp_42'
const QUESTION_DOCUMENT_SHA256 = '2160290042b4186b06b0563ff53cccf042a77fba5fdf9cb98d2cc84bbb672e0b'
const MARK_SCHEME_ID = 'cie-9709-9709_m25_ms_42'
const MARK_SCHEME_DOCUMENT_SHA256 = '424b626bdd4ba7e7d26df5961f5c0c43ba2b64911810e281bd6330a705f83523'

function assetUrl(prefix, page) {
  return `/question-assets/${PAPER_ID}/${prefix}-${String(page).padStart(2, '0')}.jpg`
}

function part(label, promptFragment, marks, sourcePage, answerSourcePage, markSchemePoints, answerText) {
  return {
    partId: `${PAPER_ID}:q__QUESTION__:part-${label}`,
    label,
    promptFragment,
    marks,
    questionDeclaredMarks: marks,
    markSource: 'official-question-paper',
    answerArea: { type: 'handwritten', input: 'handwriting' },
    sourcePage,
    answerSourcePage,
    markSchemePoints,
    answerText,
  }
}

const MECHANICS_GROUPS = Object.freeze([
  Object.freeze({
    number: 1,
    questionPages: [3],
    markSchemePages: [9],
    parts: [part('a', 'Three coplanar forces of magnitudes 40 N, 30 N and X N act at a point in the directions shown in the diagram. Given that the forces are in equilibrium, find the values of theta and X.', 4, 3, 9, ['Resolve the forces consistently in two directions.', 'Obtain X = 50 N and theta = 36.9 degrees.'], 'X = 50 N, theta = 36.9 degrees')],
  }),
  Object.freeze({
    number: 2,
    questionPages: [4],
    markSchemePages: [10],
    parts: [
      part('a', 'A cyclist is travelling along a straight horizontal road at a speed of 4 m s-1 when she passes O. She accelerates at a constant rate for 42 m, reaching V m s-1. She maintains V m s-1 for 50 m and then decelerates at 2 m s-2 before coming to rest, travelling 16 m while decelerating. Find V.', 2, 4, 10, ['Use constant acceleration for the deceleration section.', 'Obtain V = 8 m s-1.'], 'V = 8 m s-1'),
      part('b', 'Find the total time for which the cyclist is in motion from the instant that she passes O.', 3, 4, 10, ['Find the times for the acceleration, constant-speed and deceleration sections.', 'Obtain total time 69/4 s = 17.25 s.'], '69/4 s = 17.25 s'),
    ],
  }),
  Object.freeze({
    number: 3,
    questionPages: [5],
    markSchemePages: [10, 11],
    parts: [
      part('a', 'An aeroplane is flying horizontally. Its engines produce a constant power of 5500 kW and it experiences a constant horizontal resistance force of 25 kN. Find the speed of the aeroplane.', 2, 5, 10, ['Use power = force multiplied by speed.', 'Obtain speed = 220 m s-1.'], '220 m s-1'),
      part('b', 'The aeroplane then ascends 300 m in 50 s while maintaining the same speed. The work done against resistance is 270 000 kJ and the mass is 60 000 kg. Find the average power of the engines.', 4, 5, 11, ['Include the gain in gravitational potential energy and work against resistance.', 'Obtain required power = 9000 kW.'], '9000 kW'),
    ],
  }),
  Object.freeze({
    number: 4,
    questionPages: [6, 7],
    markSchemePages: [11, 12],
    parts: [
      part('a', 'Two particles A and B have masses 0.3 kg and 0.1 kg respectively. They are attached to the ends of a light inextensible string passing over a fixed smooth pulley and are initially at a height of x m above horizontal ground, as shown. The system is released from rest. Find the tension in the string and the acceleration of the particles.', 4, 6, 11, ['Apply Newton’s second law consistently to the two particles.', 'Obtain acceleration = 5 m s-2 and tension = 1.5 N.'], 'acceleration = 5 m s-2, tension = 1.5 N'),
      part('b', 'During the subsequent motion B does not reach the pulley. When A reaches the ground it comes to rest. Given that the greatest height of B above the ground is 1.2 m, find x.', 3, 7, 12, ['Use constant-acceleration equations before and after A reaches the ground.', 'Obtain x = 0.48 m.'], 'x = 0.48 m'),
    ],
  }),
  Object.freeze({
    number: 5,
    questionPages: [8, 9],
    markSchemePages: [12, 13, 14],
    parts: [
      part('a', 'Three particles P, Q and R of masses 0.6 kg, 0.4 kg and 0.8 kg respectively are initially at rest in a straight line on a smooth horizontal plane, with P-to-Q and Q-to-R distances both 3 m. P is projected towards Q at 3 m s-1. After P and Q collide, P continues at 1.5 m s-1. Find the speed of Q after the collision.', 2, 8, 12, ['Use conservation of momentum for P and Q.', 'Obtain speed of Q = 2.25 m s-1.'], '2.25 m s-1'),
      part('b', 'In the subsequent collision between Q and R, the particles coalesce. Find the speed of the combined particle.', 1, 8, 12, ['Use conservation of momentum for Q and R.', 'Obtain speed = 0.75 m s-1.'], '0.75 m s-1'),
      part('c', 'Find the time from when P is initially projected until P collides with the combined particle.', 4, 9, 13, ['Use the relative motion of P and the combined Q/R particle.', 'Obtain time = 11/3 s.'], '11/3 s'),
    ],
  }),
  Object.freeze({
    number: 6,
    questionPages: [10, 11],
    markSchemePages: [15, 16],
    parts: [
      part('a', 'A block of mass 12 kg is on a rough plane inclined at angle alpha to the horizontal, where alpha = tan-1 0.5. A force X N acts directly up the plane and the coefficient of friction is mu. Given mu = 0.15 and X = 20, find the time for the block to move 2 m down the plane from rest.', 6, 10, 15, ['Resolve forces along the plane and use friction = mu R.', 'Use constant acceleration over 2 m.', 'Obtain t = 1.65 s.'], 't = 1.65 s'),
      part('b', 'It is given instead that mu is not 0.15 and that when X = 10, the block is on the point of moving down the plane. Find mu and the value of X for which the block is on the point of moving up the plane.', 4, 11, 16, ['Resolve forces parallel to the slope for both limiting cases.', 'Obtain mu = 0.407 and X = 97.3 N.'], 'mu = 0.407, X = 97.3 N'),
    ],
  }),
  Object.freeze({
    number: 7,
    questionPages: [12, 13],
    markSchemePages: [17, 18],
    parts: [
      part('a', 'A particle moves in a straight line. Its velocity v m s-1 at time t s after leaving O is v = k(20 + pt - 6t squared), where k and p are constants. The acceleration at t = 1 is 42 m s-2 and the displacement from O at t = 1 is 93 m. Show that k = 3 and p = 26.', 6, 12, 17, ['Differentiate and integrate the velocity expression, then use both given conditions.', 'Obtain k = 3 and p = 26.'], 'k = 3, p = 26'),
      part('b', 'Find the distance moved by the particle between the time at which its acceleration is zero and the time at which its velocity is zero.', 5, 13, 18, ['Find the positive times at which acceleration and velocity are zero.', 'Integrate velocity between those times.', 'Obtain distance = 273 m.'], '273 m'),
    ],
  }),
])

function isHumanReviewed(item) {
  return item?.answerBinding?.verificationStatus === 'reviewed'
}

function completedParts(definition) {
  return definition.parts.map((value) => ({
    ...value,
    partId: value.partId.replace('__QUESTION__', String(definition.number)),
  }))
}

function repairItem(template, definition) {
  const parts = completedParts(definition)
  const questionId = `${PAPER_ID}:q${definition.number}`
  const questionPages = [...definition.questionPages]
  const markSchemePages = [...definition.markSchemePages]
  const sourceRef = {
    paperId: PAPER_ID,
    paper: '9709_m25_qp_42.pdf',
    question: `Q${definition.number}`,
    localUrl: '/local-pdf/9709/9709_m25_qp_42.pdf',
    pageStart: questionPages[0],
    pageEnd: questionPages.at(-1),
    assetUrls: questionPages.map((page) => assetUrl('qp', page)),
    year: 2025,
    season: 'Mar',
    component: 4,
    sha256: QUESTION_DOCUMENT_SHA256,
  }
  const answerRef = {
    documentId: MARK_SCHEME_ID,
    file: '9709_m25_ms_42.pdf',
    localUrl: '/local-pdf/9709/9709_m25_ms_42.pdf',
    pageStart: markSchemePages[0],
    pageEnd: markSchemePages.at(-1),
    assetUrls: markSchemePages.map((page) => assetUrl('ms', page)),
    sha256: MARK_SCHEME_DOCUMENT_SHA256,
  }
  const answerParts = parts.map((value) => ({
    partId: value.partId,
    label: value.label,
    marks: value.marks,
    markSchemePoints: value.markSchemePoints,
    answerText: value.answerText,
    sourcePage: value.answerSourcePage,
  }))
  return {
    ...template,
    bankId: questionId,
    questionId,
    questionGroupId: questionId,
    answerId: `${questionId}:answer`,
    examFamilyId: 'cambridge',
    qualificationId: 'cambridge-9709',
    specificationId: 'cambridge-9709-2026-2027',
    subjectId: 'math',
    subjectCode: '9709',
    knowledgeGroupId: 'math-9709-mechanics',
    topicId: 'math-9709-mechanics',
    stageTags: ['AS', 'A2'],
    componentTags: [4],
    topicTags: ['math-9709-mechanics'],
    skillTags: ['official-source-structure-repair'],
    answerType: parts.length === 1 ? 'handwritten' : 'structured',
    prompt: parts.map((value) => `(${value.label}) ${value.promptFragment}`).join('\n\n'),
    answer: null,
    answerKey: null,
    totalMarks: parts.reduce((sum, value) => sum + value.marks, 0),
    marks: parts.reduce((sum, value) => sum + value.marks, 0),
    questionGroupStatus: 'verified',
    parts: parts.map(({ answerSourcePage: _answerSourcePage, markSchemePoints: _markSchemePoints, answerText: _answerText, ...value }) => value),
    answerParts,
    answerRef,
    sourceRef,
    markPoints: answerParts.flatMap((value) => value.markSchemePoints),
    exactAnswer: answerParts.map((value) => value.answerText).join('\n'),
    provenance: {
      licenseStatus: 'Official exam material; personal study library',
      indexedAt: '2026-08-16T00:00:00.000Z',
      repairEvidence: 'paired-official-qp-ms-page-audit:9709-m25-42',
    },
    syllabusMapping: {
      specificationId: 'cambridge-9709-2026-2027',
      syllabusUrl: 'https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf',
      knowledgeGroupId: 'math-9709-mechanics',
      mappingStatus: 'machine-indexed',
    },
    answerBinding: {
      verificationStatus: 'machine-indexed',
      questionDocumentSha256: QUESTION_DOCUMENT_SHA256,
      answerDocumentSha256: MARK_SCHEME_DOCUMENT_SHA256,
    },
  }
}

// This ledger repairs objectively observable source structure only. It never
// assigns reviewed status, source regions, or student-facing eligibility.
export function applyOfficialQuestionIndexRepairs(items = []) {
  const next = new Map((items || []).map((item) => [item?.bankId || item?.questionId, item]))
  const templates = [...next.values()].filter((item) => item?.sourceRef?.paperId === PAPER_ID)
  const fallbackTemplate = templates[0] || {}
  for (const definition of MECHANICS_GROUPS) {
    const questionId = `${PAPER_ID}:q${definition.number}`
    const existing = next.get(questionId)
    if (isHumanReviewed(existing)) continue
    next.set(questionId, repairItem(existing || fallbackTemplate, definition))
  }
  return [...next.values()]
}

export const OFFICIAL_QUESTION_INDEX_REPAIR_IDS = Object.freeze(MECHANICS_GROUPS.map((definition) => `${PAPER_ID}:q${definition.number}`))
