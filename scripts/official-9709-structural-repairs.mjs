const PAPER_CONFIG = Object.freeze({
  'cie-9709-9709_m25_qp_32': Object.freeze({
    paper: '9709_m25_qp_32.pdf',
    localUrl: '/local-pdf/9709/9709_m25_qp_32.pdf',
    questionSha256: 'c901433b48af308d902d71e5e25a9d627b12b782383073958ad4fda48e2a6170',
    markSchemeId: 'cie-9709-9709_m25_ms_32',
    markScheme: '9709_m25_ms_32.pdf',
    markSchemeSha256: '57b7eb8464d758b91cb8f4c87d6a9f5af8c6c35e189d0b75e891c407d5e86b01',
    component: 3,
    knowledgeGroupId: 'math-9709-pure',
  }),
  'cie-9709-9709_m25_qp_52': Object.freeze({
    paper: '9709_m25_qp_52.pdf',
    localUrl: '/local-pdf/9709/9709_m25_qp_52.pdf',
    questionSha256: 'e9545f181ffd9a0d60466a6fbd7e98b30038347fbc04eb73d39c512f382500d6',
    markSchemeId: 'cie-9709-9709_m25_ms_52',
    markScheme: '9709_m25_ms_52.pdf',
    markSchemeSha256: '0495a44ad4dae091ada5a9dc7b12247e69f0fb0afdc2d975b38728457840f877',
    component: 5,
    knowledgeGroupId: 'math-9709-statistics',
  }),
  'cie-9709-9709_m25_qp_62': Object.freeze({
    paper: '9709_m25_qp_62.pdf',
    localUrl: '/local-pdf/9709/9709_m25_qp_62.pdf',
    questionSha256: 'c9fd87d71d632f9b5dd3e225e5f1cafd1e064469a78f95aff415484c2a5c36eb',
    markSchemeId: 'cie-9709-9709_m25_ms_62',
    markScheme: '9709_m25_ms_62.pdf',
    markSchemeSha256: '9fcc8aca32cf3f88e2732ae0c5c1efd00f674fc5830211070d47bc27c04e760a',
    component: 6,
    knowledgeGroupId: 'math-9709-statistics',
  }),
})

function assetUrl(paperId, prefix, page) {
  return `/question-assets/${paperId}/${prefix}-${String(page).padStart(2, '0')}.jpg`
}

function part(paperId, number, label, promptFragment, marks, sourcePage, answerSourcePage, answerText) {
  return {
    partId: `${paperId}:q${number}:part-${label}`,
    label,
    promptFragment,
    marks,
    questionDeclaredMarks: marks,
    markSource: 'official-question-paper',
    answerArea: { type: 'handwritten', input: 'handwriting' },
    sourcePage,
    answerSourcePage,
    markSchemePoints: [`Official mark scheme evidence for ${label} on page ${answerSourcePage}.`],
    answerText,
  }
}

const STRUCTURAL_GROUPS = Object.freeze([
  {
    paperId: 'cie-9709-9709_m25_qp_32', number: 3, questionPages: [6], markSchemePages: [11], parts: [
      part('cie-9709-9709_m25_qp_32', 3, 'a', 'Find two inequalities in terms of z that define the shaded region.', 3, 6, 11, 'Im(z) <= -1 and |z + 2 - i| <= 3.'),
      part('cie-9709-9709_m25_qp_32', 3, 'b', 'Find the greatest value of |z| for points in this region.', 3, 6, 11, '4.35 or sqrt(10 + 4sqrt(5)).'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_32', number: 7, questionPages: [10, 11], markSchemePages: [15, 16], parts: [
      part('cie-9709-9709_m25_qp_32', 7, 'a', 'Show that p satisfies the equation p = 1/2 tan^-1(3/(2p)).', 3, 10, 15, 'p = 1/2 tan^-1(3/(2p)).'),
      part('cie-9709-9709_m25_qp_32', 7, 'b', 'Show by calculation that 0.5 < p < 0.7.', 2, 11, 15, '0.5 < p < 0.7.'),
      part('cie-9709-9709_m25_qp_32', 7, 'c', 'Use an iterative formula to calculate p correct to 3 decimal places.', 3, 11, 16, 'p = 0.596.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_32', number: 9, questionPages: [14, 15], markSchemePages: [18, 19], parts: [
      part('cie-9709-9709_m25_qp_32', 9, 'a', 'Find the values of a and b.', 5, 14, 18, 'a = -11 and b = -24.'),
      part('cie-9709-9709_m25_qp_32', 9, 'b', 'When a and b have the values found in part (a), factorise p(x) completely.', 3, 15, 19, '(x - 3)(2x + 3)(3x - 1).'),
      part('cie-9709-9709_m25_qp_32', 9, 'c', 'Hence solve the inequality p(x) < 0.', 2, 15, 19, 'x < -3/2 or 1/3 < x < 3.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_32', number: 10, questionPages: [16, 17], markSchemePages: [20, 21], parts: [
      part('cie-9709-9709_m25_qp_32', 10, 'a', 'Express f(x) in partial fractions.', 5, 16, 20, 'A = -3, B = -4, C = 6.'),
      part('cie-9709-9709_m25_qp_32', 10, 'b', 'Find the exact value of the integral from 0 to 2 of f(x) dx.', 6, 17, 21, '3pi/4 - ln(108).'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_52', number: 1, questionPages: [2, 3], markSchemePages: [7], parts: [
      part('cie-9709-9709_m25_qp_52', 1, 'a', 'Show that P(X = 2) = 3/20.', 1, 2, 7, '3/20.'),
      part('cie-9709-9709_m25_qp_52', 1, 'b', 'Draw up the probability distribution table for X.', 3, 2, 7, 'P(X=x): 24/60, 26/60, 9/60, 1/60 for x=0,1,2,3.'),
      part('cie-9709-9709_m25_qp_52', 1, 'c', 'Given that E(X) = 47/60, find Var(X).', 2, 3, 7, '2051/3600 or 0.570.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_52', number: 2, questionPages: [4, 5], markSchemePages: [8, 9], parts: [
      part('cie-9709-9709_m25_qp_52', 2, 'a', 'Find the probability that the 3 customers bought computers all made by different companies.', 1, 4, 8, '0.1485.'),
      part('cie-9709-9709_m25_qp_52', 2, 'b', 'Find the probability that fewer than 10 customers bought a computer made by company F.', 3, 4, 8, '0.958.'),
      part('cie-9709-9709_m25_qp_52', 2, 'c', 'Use a suitable approximation to find the probability that more than 24 customers bought a computer made by company H.', 5, 5, 9, '0.204.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_52', number: 3, questionPages: [6, 7], markSchemePages: [10, 11], parts: [
      part('cie-9709-9709_m25_qp_52', 3, 'a', 'On the grid, draw a cumulative frequency graph.', 4, 6, 10, 'Cumulative frequencies 18, 46, 106, 178, 226, 250 at upper boundaries 9.5 to 39.5.'),
      part('cie-9709-9709_m25_qp_52', 3, 'b', 'Use your graph to find an estimate for k.', 2, 7, 10, 'k is approximately 23.'),
      part('cie-9709-9709_m25_qp_52', 3, 'c', 'Calculate an estimate for the mean length of the leaves.', 3, 7, 11, '20.76 cm.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_52', number: 4, questionPages: [8, 9], markSchemePages: [11, 12, 13], parts: [
      part('cie-9709-9709_m25_qp_52', 4, 'a', 'Find the probability that all three cars are the same colour.', 3, 8, 11, '0.120.'),
      part('cie-9709-9709_m25_qp_52', 4, 'b', 'Find the probability that at least one car is white and at least one car is black.', 4, 9, 12, '0.607 or 17/28.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_52', number: 5, questionPages: [10, 11], markSchemePages: [14, 15], parts: [
      part('cie-9709-9709_m25_qp_52', 5, 'a', 'Find the probability that the mass of peaches is between 56 kg and 75 kg.', 3, 10, 14, '0.677.'),
      part('cie-9709-9709_m25_qp_52', 5, 'b', 'Find the value of sigma for the mass of cherries.', 3, 11, 14, 'sigma = 10.4 kg.'),
      part('cie-9709-9709_m25_qp_52', 5, 'c', 'Find the probability that the first day below 59.1 kg is the fifth day.', 1, 11, 15, '0.0656.'),
      part('cie-9709-9709_m25_qp_52', 5, 'd', 'Find the probability that the first day below 59.1 kg is before the fifth day.', 2, 11, 15, '0.344.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_52', number: 6, questionPages: [12, 13], markSchemePages: [16, 17, 18], parts: [
      part('cie-9709-9709_m25_qp_52', 6, 'a', 'Find the number of different colour arrangements of the 10 books.', 1, 12, 16, '151200.'),
      part('cie-9709-9709_m25_qp_52', 6, 'b', 'Find the number of arrangements with the blue books together and yellow books separated.', 2, 12, 16, '7560.'),
      part('cie-9709-9709_m25_qp_52', 6, 'c', 'Find the number of arrangements with exactly 4 books between the yellow books.', 3, 13, 17, '16800.'),
      part('cie-9709-9709_m25_qp_52', 6, 'd', 'Find the number of selections satisfying the red, blue and yellow conditions.', 4, 13, 18, '60.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_62', number: 2, questionPages: [4, 5], markSchemePages: [9, 10], parts: [
      part('cie-9709-9709_m25_qp_62', 2, 'a', 'Find an unbiased estimate of E(T) and show an unbiased estimate of Var(T).', 3, 4, 9, 'E(T) = 61.3 and Var(T) = 14.44.'),
      part('cie-9709-9709_m25_qp_62', 2, 'b', 'Test at the 2% significance level whether the population mean time is less than 62.4 seconds.', 5, 5, 10, 'Reject H0; there is sufficient evidence that the mean decreased.'),
      part('cie-9709-9709_m25_qp_62', 2, 'c', 'State whether it was necessary to use the Central Limit Theorem and give a reason.', 1, 5, 10, 'Yes, because the population distribution is unknown.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_62', number: 3, questionPages: [6, 7], markSchemePages: [10, 11], parts: [
      part('cie-9709-9709_m25_qp_62', 3, 'a', 'Find P(X >= 3) for X with distribution Po(1.5).', 2, 6, 10, '0.191.'),
      part('cie-9709-9709_m25_qp_62', 3, 'b', 'Find the probability that the sum of three independent values is between 3 and 5 inclusive.', 3, 6, 11, '0.529.'),
      part('cie-9709-9709_m25_qp_62', 3, 'c', 'Using a suitable approximation, find n when P(T > 330) = 0.0391.', 5, 7, 11, 'n = 200.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_62', number: 4, questionPages: [8, 9], markSchemePages: [12, 13], parts: [
      part('cie-9709-9709_m25_qp_62', 4, 'a(i)', 'Show that b = 1 - a.', 2, 8, 12, 'b = 1 - a.'),
      part('cie-9709-9709_m25_qp_62', 4, 'a(ii)', 'Given E(X) = 1.2, find a.', 5, 8, 12, 'a = 0.2.'),
      part('cie-9709-9709_m25_qp_62', 4, 'b', 'Find c such that P(-c < t < c) = 1/2.', 4, 9, 13, 'c = pi/6.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_62', number: 5, questionPages: [10, 11], markSchemePages: [13, 14], parts: [
      part('cie-9709-9709_m25_qp_62', 5, 'a', 'Find the significance level of the binomial test.', 3, 10, 13, '6.05%.'),
      part('cie-9709-9709_m25_qp_62', 5, 'b', 'State the probability of a Type I error.', 1, 10, 13, '0.0605.'),
      part('cie-9709-9709_m25_qp_62', 5, 'c', 'Find the probability of a Type II error when p = 0.05.', 3, 11, 14, '0.0958.'),
    ],
  },
  {
    paperId: 'cie-9709-9709_m25_qp_62', number: 6, questionPages: [12, 13], markSchemePages: [14, 15], parts: [
      part('cie-9709-9709_m25_qp_62', 6, 'a', 'State, with a reason, whether you agree with the sampling method.', 1, 12, 14, 'No; sampling only sports teams is biased and not representative.'),
      part('cie-9709-9709_m25_qp_62', 6, 'b', 'Calculate an approximate 95% confidence interval for the proportion.', 3, 12, 14, '0.640 to 0.860.'),
      part('cie-9709-9709_m25_qp_62', 6, 'c', 'Calculate x for the confidence interval width relationship.', 4, 13, 15, 'x = 80.2 to 80.3, or 80%.'),
    ],
  },
])

function isHumanReviewed(item) {
  return item?.answerBinding?.verificationStatus === 'reviewed'
}

function repairStructuralItem(template, definition) {
  const config = PAPER_CONFIG[definition.paperId]
  const questionId = `${definition.paperId}:q${definition.number}`
  const sourceRef = {
    ...(template?.sourceRef || {}),
    paperId: definition.paperId,
    paper: config.paper,
    question: `Q${definition.number}`,
    localUrl: config.localUrl,
    pageStart: definition.questionPages[0],
    pageEnd: definition.questionPages.at(-1),
    assetUrls: definition.questionPages.map((page) => assetUrl(definition.paperId, 'qp', page)),
    year: 2025,
    season: 'Mar',
    component: config.component,
    sha256: config.questionSha256,
  }
  const answerRef = {
    documentId: config.markSchemeId,
    file: config.markScheme,
    localUrl: config.localUrl,
    pageStart: definition.markSchemePages[0],
    pageEnd: definition.markSchemePages.at(-1),
    assetUrls: definition.markSchemePages.map((page) => assetUrl(definition.paperId, 'ms', page)),
    sha256: config.markSchemeSha256,
  }
  const parts = definition.parts.map((value) => ({ ...value }))
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
    subjectId: template?.subjectId || 'math',
    subjectCode: '9709',
    qualificationId: template?.qualificationId || 'cambridge-9709',
    specificationId: template?.specificationId || 'cambridge-9709-2026-2027',
    knowledgeGroupId: template?.knowledgeGroupId || config.knowledgeGroupId,
    topicId: template?.topicId || config.knowledgeGroupId,
    topicTags: template?.topicTags?.length ? template.topicTags : [config.knowledgeGroupId],
    stageTags: template?.stageTags?.length ? template.stageTags : ['AS', 'A2'],
    componentTags: template?.componentTags?.length ? template.componentTags : [config.component],
    answerType: 'structured',
    prompt: template?.prompt || parts.map((value) => `(${value.label}) ${value.promptFragment}`).join('\n\n'),
    answer: null,
    answerKey: null,
    totalMarks: parts.reduce((sum, value) => sum + value.marks, 0),
    marks: parts.reduce((sum, value) => sum + value.marks, 0),
    questionGroupStatus: 'verified',
    parts,
    answerParts,
    answerRef,
    sourceRef,
    markPoints: answerParts.flatMap((value) => value.markSchemePoints),
    exactAnswer: answerParts.map((value) => value.answerText).join('\n'),
    provenance: {
      ...(template?.provenance || {}),
      repairEvidence: `paired-official-qp-ms-page-audit:${definition.paperId}:q${definition.number}`,
    },
    syllabusMapping: {
      ...(template?.syllabusMapping || {}),
      mappingStatus: 'machine-indexed',
    },
    answerBinding: {
      ...(template?.answerBinding || {}),
      verificationStatus: 'machine-indexed',
      questionDocumentSha256: config.questionSha256,
      answerDocumentSha256: config.markSchemeSha256,
    },
  }
}

export function applyOfficial9709StructuralRepairs(items = []) {
  const next = new Map((items || []).map((item) => [item?.bankId || item?.questionId, item]))
  for (const paperId of Object.keys(PAPER_CONFIG)) {
    const templates = [...next.values()].filter((item) => item?.sourceRef?.paperId === paperId)
    const fallbackTemplate = templates[0] || {}
    for (const definition of STRUCTURAL_GROUPS.filter((candidate) => candidate.paperId === paperId)) {
      const questionId = `${paperId}:q${definition.number}`
      const existing = next.get(questionId)
      if (isHumanReviewed(existing)) continue
      next.set(questionId, repairStructuralItem(existing || fallbackTemplate, definition))
    }
  }
  return [...next.values()]
}

export const OFFICIAL_9709_STRUCTURAL_REPAIR_IDS = Object.freeze(
  STRUCTURAL_GROUPS.map((definition) => `${definition.paperId}:q${definition.number}`),
)
