const CAMBRIDGE_ROOT = 'https://www.cambridgeinternational.org/programmes-and-qualifications/'

export const examStructures = {
  '0580': {
    subject: 'Mathematics',
    qualification: 'Cambridge IGCSE',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-igcse-mathematics-0580/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/662466-2025-2027-syllabus.pdf',
    stageOptions: [{ value: 'core', label: 'Core route' }, { value: 'extended', label: 'Extended route' }],
    stageGuidance: {
      core: 'The current Core route uses Paper 1 (non-calculator) and Paper 3 (calculator).',
      extended: 'The current Extended route uses Paper 2 (non-calculator) and Paper 4 (calculator).',
    },
    routes: [
      { id: '0580-core', stage: 'core', label: 'Core: P1 + P3', papers: [1, 3], guidance: 'Current Core route: Paper 1 without a calculator and Paper 3 with a calculator.' },
      { id: '0580-extended', stage: 'extended', label: 'Extended: P2 + P4', papers: [2, 4], guidance: 'Current Extended route: Paper 2 without a calculator and Paper 4 with a calculator.' },
    ],
    papers: {
      1: { title: 'Core (Non-calculator)', mode: 'structured', durationMinutes: 90, maxMarks: 80, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['core'] },
      2: { title: 'Extended (Non-calculator)', mode: 'structured', durationMinutes: 120, maxMarks: 100, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['extended'] },
      3: { title: 'Core (Calculator)', mode: 'structured', durationMinutes: 90, maxMarks: 80, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['core'] },
      4: { title: 'Extended (Calculator)', mode: 'structured', durationMinutes: 120, maxMarks: 100, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['extended'] },
    },
    legacyPapers: {
      1: { title: 'Core paper', mode: 'structured', durationMinutes: null, maxMarks: null, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['core'] },
      2: { title: 'Extended paper', mode: 'structured', durationMinutes: null, maxMarks: null, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['extended'] },
      3: { title: 'Core paper', mode: 'structured', durationMinutes: null, maxMarks: null, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['core'] },
      4: { title: 'Extended paper', mode: 'structured', durationMinutes: null, maxMarks: null, defaultQuestionCount: null, questionCountRange: [1, 40], stages: ['extended'] },
    },
  },
  '0606': {
    subject: 'Additional Mathematics',
    qualification: 'Cambridge IGCSE',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-igcse-mathematics-additional-0606/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/662470-2025-2027-syllabus.pdf',
    stageOptions: [{ value: 'igcse', label: 'IGCSE course' }],
    stageGuidance: { igcse: 'The current course uses Paper 1 (non-calculator) and Paper 2 (calculator).' },
    routes: [{ id: '0606-full', stage: 'igcse', label: 'Course: P1 + P2', papers: [1, 2], guidance: 'Complete both current Additional Mathematics papers.' }],
    papers: {
      1: { title: 'Paper 1 (Non-calculator)', mode: 'structured', durationMinutes: 120, maxMarks: 80, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['igcse'] },
      2: { title: 'Paper 2 (Calculator)', mode: 'structured', durationMinutes: 120, maxMarks: 80, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['igcse'] },
    },
  },
  '0610': {
    subject: 'Biology',
    qualification: 'Cambridge IGCSE',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-igcse-biology-0610/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/697203-2026-2028-syllabus.pdf',
    stageOptions: [{ value: 'core', label: 'Core route' }, { value: 'extended', label: 'Extended route' }],
    stageGuidance: {
      core: 'Core uses Papers 1 and 3, plus either the Practical Test (P5) or Alternative to Practical (P6).',
      extended: 'Extended uses Papers 2 and 4, plus either the Practical Test (P5) or Alternative to Practical (P6).',
    },
    routes: [
      { id: '0610-core-practical', stage: 'core', label: 'Core: P1 + P3 + P5', papers: [1, 3, 5], guidance: 'Core theory with the Practical Test.' },
      { id: '0610-core-alternative', stage: 'core', label: 'Core: P1 + P3 + P6', papers: [1, 3, 6], guidance: 'Core theory with Alternative to Practical.' },
      { id: '0610-extended-practical', stage: 'extended', label: 'Extended: P2 + P4 + P5', papers: [2, 4, 5], guidance: 'Extended theory with the Practical Test.' },
      { id: '0610-extended-alternative', stage: 'extended', label: 'Extended: P2 + P4 + P6', papers: [2, 4, 6], guidance: 'Extended theory with Alternative to Practical.' },
    ],
    papers: {
      1: { title: 'Multiple Choice (Core)', mode: 'mcq', durationMinutes: 45, maxMarks: 40, defaultQuestionCount: 40, questionCountRange: [40, 40], stages: ['core'] },
      2: { title: 'Multiple Choice (Extended)', mode: 'mcq', durationMinutes: 45, maxMarks: 40, defaultQuestionCount: 40, questionCountRange: [40, 40], stages: ['extended'] },
      3: { title: 'Theory (Core)', mode: 'structured', durationMinutes: 75, maxMarks: 80, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['core'] },
      4: { title: 'Theory (Extended)', mode: 'structured', durationMinutes: 75, maxMarks: 80, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['extended'] },
      5: { title: 'Practical Test', mode: 'practical', durationMinutes: 75, maxMarks: 40, defaultQuestionCount: 4, questionCountRange: [3, 5], stages: ['core', 'extended'] },
      6: { title: 'Alternative to Practical', mode: 'practical', durationMinutes: 60, maxMarks: 40, defaultQuestionCount: 4, questionCountRange: [3, 5], stages: ['core', 'extended'] },
    },
  },
  '9700': {
    subject: 'Biology',
    qualification: 'Cambridge International AS & A Level',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-international-as-and-a-level-biology-9700/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/664560-2025-2027-syllabus.pdf',
    stageGuidance: {
      as: 'AS Level uses Papers 1, 2 and 3.',
      a2: 'The A2 continuation uses Papers 4 and 5 after the AS components.',
      full: 'A full A Level result combines Papers 1, 2, 3, 4 and 5.',
    },
    routes: [
      { id: 'biology-as', stage: 'as', label: 'AS: P1 + P2 + P3', papers: [1, 2, 3], guidance: 'Multiple choice, structured questions and advanced practical skills.' },
      { id: 'biology-a2', stage: 'a2', label: 'Year 2: P4 + P5', papers: [4, 5], guidance: 'A Level structured questions plus planning, analysis and evaluation.' },
      { id: 'biology-full', stage: 'full', label: 'Full: P1 + P2 + P3 + P4 + P5', papers: [1, 2, 3, 4, 5], guidance: 'The complete current Biology route.' },
    ],
    papers: {
      1: { title: 'Multiple Choice', mode: 'mcq', durationMinutes: 75, maxMarks: 40, defaultQuestionCount: 40, questionCountRange: [40, 40], stages: ['as', 'full'] },
      2: { title: 'AS Level Structured Questions', mode: 'structured', durationMinutes: 75, maxMarks: 60, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['as', 'full'] },
      3: { title: 'Advanced Practical Skills', mode: 'practical', durationMinutes: 120, maxMarks: 40, defaultQuestionCount: 2, questionCountRange: [2, 2], stages: ['as', 'full'] },
      4: { title: 'A Level Structured Questions', mode: 'structured', durationMinutes: 120, maxMarks: 100, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['a2', 'full'] },
      5: { title: 'Planning, Analysis and Evaluation', mode: 'practical', durationMinutes: 75, maxMarks: 30, defaultQuestionCount: 2, questionCountRange: [2, 2], stages: ['a2', 'full'] },
    },
  },
  '9702': {
    subject: 'Physics',
    qualification: 'Cambridge International AS & A Level',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-international-as-and-a-level-physics-9702/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf',
    stageGuidance: {
      as: 'AS Level uses Papers 1, 2 and 3.',
      a2: 'The A2 continuation uses Papers 4 and 5 after the AS components.',
      full: 'A full A Level result combines Papers 1, 2, 3, 4 and 5.',
    },
    routes: [
      { id: 'physics-as', stage: 'as', label: 'AS: P1 + P2 + P3', papers: [1, 2, 3], guidance: 'The current AS Physics route combines multiple choice, structured questions and advanced practical skills.' },
      { id: 'physics-a2', stage: 'a2', label: 'Year 2: P4 + P5', papers: [4, 5], guidance: 'Complete the A Level with Paper 4 and Paper 5 after the AS components.' },
      { id: 'physics-full', stage: 'full', label: 'Full: P1 + P2 + P3 + P4 + P5', papers: [1, 2, 3, 4, 5], guidance: 'The full A Level route combines all five current Physics components.' },
    ],
    papers: {
      1: { title: 'Multiple Choice', mode: 'mcq', durationMinutes: 75, maxMarks: 40, defaultQuestionCount: 40, questionCountRange: [40, 40], stages: ['as', 'full'] },
      2: { title: 'AS Level Structured Questions', mode: 'structured', durationMinutes: 75, maxMarks: 60, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['as', 'full'] },
      3: { title: 'Advanced Practical Skills', mode: 'practical', durationMinutes: 120, maxMarks: 40, defaultQuestionCount: 2, questionCountRange: [2, 2], stages: ['as', 'full'] },
      4: { title: 'A Level Structured Questions', mode: 'structured', durationMinutes: 120, maxMarks: 100, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['a2', 'full'] },
      5: { title: 'Planning, Analysis and Evaluation', mode: 'practical', durationMinutes: 75, maxMarks: 30, defaultQuestionCount: 2, questionCountRange: [2, 2], stages: ['a2', 'full'] },
    },
    legacyPapers: {
      6: { title: 'Options', mode: 'structured', durationMinutes: null, maxMarks: null, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['a2', 'full'] },
    },
  },
  '9701': {
    subject: 'Chemistry',
    qualification: 'Cambridge International AS & A Level',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-international-as-and-a-level-chemistry-9701/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/664563-2025-2027-syllabus.pdf',
    stageGuidance: { as: 'AS Level uses Papers 1, 2 and 3.', a2: 'The A2 continuation uses Papers 4 and 5 after AS.', full: 'The full A Level combines Papers 1 to 5.' },
    routes: [
      { id: 'chemistry-as', stage: 'as', label: 'AS: P1 + P2 + P3', papers: [1, 2, 3], guidance: 'Multiple choice, structured questions and advanced practical skills.' },
      { id: 'chemistry-a2', stage: 'a2', label: 'Year 2: P4 + P5', papers: [4, 5], guidance: 'A Level structured questions plus planning, analysis and evaluation.' },
      { id: 'chemistry-full', stage: 'full', label: 'Full: P1 + P2 + P3 + P4 + P5', papers: [1, 2, 3, 4, 5], guidance: 'The complete current Chemistry route.' },
    ],
    papers: {
      1: { title: 'Multiple Choice', mode: 'mcq', durationMinutes: 75, maxMarks: 40, defaultQuestionCount: 40, questionCountRange: [40, 40], stages: ['as', 'full'] },
      2: { title: 'AS Level Structured Questions', mode: 'structured', durationMinutes: 75, maxMarks: 60, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['as', 'full'] },
      3: { title: 'Advanced Practical Skills', mode: 'practical', durationMinutes: 120, maxMarks: 40, defaultQuestionCount: null, questionCountRange: [1, 10], stages: ['as', 'full'] },
      4: { title: 'A Level Structured Questions', mode: 'structured', durationMinutes: 120, maxMarks: 100, defaultQuestionCount: null, questionCountRange: [1, 20], stages: ['a2', 'full'] },
      5: { title: 'Planning, Analysis and Evaluation', mode: 'practical', durationMinutes: 75, maxMarks: 30, defaultQuestionCount: null, questionCountRange: [1, 10], stages: ['a2', 'full'] },
    },
  },
  '9708': {
    subject: 'Economics',
    qualification: 'Cambridge International AS & A Level',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-international-as-and-a-level-economics-9708/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/697423-2026-2028-syllabus.pdf',
    stageGuidance: { as: 'AS Level uses Papers 1 and 2.', a2: 'The A2 continuation uses Papers 3 and 4 after AS.', full: 'The full A Level combines Papers 1 to 4.' },
    routes: [
      { id: 'economics-as', stage: 'as', label: 'AS: P1 + P2', papers: [1, 2], guidance: 'AS multiple choice plus data response and essays.' },
      { id: 'economics-a2', stage: 'a2', label: 'Year 2: P3 + P4', papers: [3, 4], guidance: 'A Level multiple choice plus data response and essays.' },
      { id: 'economics-full', stage: 'full', label: 'Full: P1 + P2 + P3 + P4', papers: [1, 2, 3, 4], guidance: 'The complete current Economics route.' },
    ],
    papers: {
      1: { title: 'AS Level Multiple Choice', mode: 'mcq', durationMinutes: 60, maxMarks: 30, defaultQuestionCount: 30, questionCountRange: [30, 30], stages: ['as', 'full'] },
      2: { title: 'AS Level Data Response and Essays', mode: 'structured', durationMinutes: 120, maxMarks: 60, defaultQuestionCount: null, questionCountRange: [1, 10], stages: ['as', 'full'] },
      3: { title: 'A Level Multiple Choice', mode: 'mcq', durationMinutes: 75, maxMarks: 30, defaultQuestionCount: 30, questionCountRange: [30, 30], stages: ['a2', 'full'] },
      4: { title: 'A Level Data Response and Essays', mode: 'structured', durationMinutes: 120, maxMarks: 60, defaultQuestionCount: null, questionCountRange: [1, 10], stages: ['a2', 'full'] },
    },
  },
  '9709': {
    subject: 'Mathematics',
    qualification: 'Cambridge International AS & A Level',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-international-as-and-a-level-mathematics-9709/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf',
    stageGuidance: {
      as: 'AS routes use Paper 1 with Paper 2, Paper 4 or Paper 5. Paper 2 is the AS-only Pure Mathematics route.',
      a2: 'After AS P1 + P4, continue with P3 + P5. After AS P1 + P5, continue with P3 + P4 or P3 + P6. P1 + P2 is AS-only.',
      full: 'Choose one full A Level route: Papers 1, 3, 4, 5 or Papers 1, 3, 5, 6. Papers 4 and 6 do not belong to the same route.',
    },
    routes: [
      { id: 'as-p1-p5', stage: 'as', label: 'AS: P1 + S1 (P5)', papers: [1, 5], guidance: 'The common AS route combining Pure Mathematics 1 with Probability & Statistics 1.' },
      { id: 'as-p1-p4', stage: 'as', label: 'AS: P1 + M1 (P4)', papers: [1, 4], guidance: 'AS route combining Pure Mathematics 1 with Mechanics.' },
      { id: 'as-p1-p2', stage: 'as', label: 'AS-only: P1 + P2', papers: [1, 2], guidance: 'Pure Mathematics AS route. Cambridge states that this route cannot be carried forward to a full A Level.' },
      { id: 'a2-after-p5-m1', stage: 'a2', label: 'Year 2 after P1+S1: P3 + M1', papers: [3, 4], guidance: 'Complete the A Level with Pure Mathematics 3 and Mechanics after AS Papers 1 and 5.' },
      { id: 'a2-after-p5-s2', stage: 'a2', label: 'Year 2 after P1+S1: P3 + S2', papers: [3, 6], guidance: 'Complete the A Level with Pure Mathematics 3 and Probability & Statistics 2 after AS Papers 1 and 5.' },
      { id: 'a2-after-p4', stage: 'a2', label: 'Year 2 after P1+M1: P3 + S1', papers: [3, 5], guidance: 'Complete the A Level with Pure Mathematics 3 and Probability & Statistics 1 after AS Papers 1 and 4.' },
      { id: 'full-mechanics', stage: 'full', label: 'Full: P1 + P3 + M1 + S1', papers: [1, 3, 4, 5], guidance: 'Full A Level route using Mechanics and Probability & Statistics 1.' },
      { id: 'full-statistics', stage: 'full', label: 'Full: P1 + P3 + S1 + S2', papers: [1, 3, 5, 6], guidance: 'Full A Level route using Probability & Statistics 1 and 2.' },
    ],
    papers: {
      1: { title: 'Pure Mathematics 1', mode: 'structured', durationMinutes: 110, maxMarks: 75, defaultQuestionCount: 11, questionCountRange: [10, 12], stages: ['as', 'full'] },
      2: { title: 'Pure Mathematics 2', mode: 'structured', durationMinutes: 75, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [6, 8], stages: ['as'] },
      3: { title: 'Pure Mathematics 3', mode: 'structured', durationMinutes: 110, maxMarks: 75, defaultQuestionCount: 10, questionCountRange: [9, 11], stages: ['a2', 'full'] },
      4: { title: 'Mechanics', mode: 'structured', durationMinutes: 75, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [6, 8], stages: ['as', 'a2', 'full'] },
      5: { title: 'Probability & Statistics 1', mode: 'structured', durationMinutes: 75, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [6, 8], stages: ['as', 'a2', 'full'] },
      6: { title: 'Probability & Statistics 2', mode: 'structured', durationMinutes: 75, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [6, 8], stages: ['a2', 'full'] },
    },
    legacyPapers: {
      5: { title: 'Mechanics 2', mode: 'structured', durationMinutes: 75, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [5, 9], stages: ['a2', 'full'] },
      6: { title: 'Probability & Statistics 1', mode: 'structured', durationMinutes: 75, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [5, 9], stages: ['as', 'a2', 'full'] },
      7: { title: 'Probability & Statistics 2', mode: 'structured', durationMinutes: 75, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [5, 9], stages: ['a2', 'full'] },
    },
  },
  '9231': {
    subject: 'Further Mathematics',
    qualification: 'Cambridge International AS & A Level',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-international-as-and-a-level-mathematics-further-9231/`,
    syllabusUrl: 'https://www.cambridgeinternational.org/Images/697357-2026-2027-syllabus.pdf',
    stageGuidance: {
      as: 'AS Level uses Paper 1 with either Paper 3 or Paper 4.',
      a2: 'Year 2 adds Paper 2 and the applied paper not taken in the AS route.',
      full: 'A full A Level result combines Papers 1, 2, 3 and 4.',
    },
    routes: [
      { id: 'further-as-mechanics', stage: 'as', label: 'AS: P1 + Further Mechanics (P3)', papers: [1, 3], guidance: 'AS route using Further Pure Mathematics 1 and Further Mechanics.' },
      { id: 'further-as-statistics', stage: 'as', label: 'AS: P1 + Further Statistics (P4)', papers: [1, 4], guidance: 'AS route using Further Pure Mathematics 1 and Further Probability & Statistics.' },
      { id: 'further-a2-after-mechanics', stage: 'a2', label: 'Year 2 after P1+P3: P2 + P4', papers: [2, 4], guidance: 'Complete the A Level with Further Pure Mathematics 2 and Further Probability & Statistics.' },
      { id: 'further-a2-after-statistics', stage: 'a2', label: 'Year 2 after P1+P4: P2 + P3', papers: [2, 3], guidance: 'Complete the A Level with Further Pure Mathematics 2 and Further Mechanics.' },
      { id: 'further-full', stage: 'full', label: 'Full: P1 + P2 + P3 + P4', papers: [1, 2, 3, 4], guidance: 'The complete A Level route uses all four current components.' },
    ],
    papers: {
      1: { title: 'Further Pure Mathematics 1', mode: 'structured', durationMinutes: 120, maxMarks: 75, defaultQuestionCount: 8, questionCountRange: [6, 10], stages: ['as', 'full'] },
      2: { title: 'Further Pure Mathematics 2', mode: 'structured', durationMinutes: 120, maxMarks: 75, defaultQuestionCount: 8, questionCountRange: [6, 10], stages: ['a2', 'full'] },
      3: { title: 'Further Mechanics', mode: 'structured', durationMinutes: 90, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [5, 9], stages: ['as', 'a2', 'full'] },
      4: { title: 'Further Probability & Statistics', mode: 'structured', durationMinutes: 90, maxMarks: 50, defaultQuestionCount: 7, questionCountRange: [5, 9], stages: ['as', 'a2', 'full'] },
    },
  },
  '0625': {
    subject: 'IGCSE Physics',
    qualification: 'Cambridge IGCSE',
    sourceUrl: `${CAMBRIDGE_ROOT}cambridge-igcse-physics-0625/`,
    stageOptions: [{ value: 'core', label: 'Core route' }, { value: 'extended', label: 'Extended route' }],
    stageGuidance: {
      core: 'Core uses Paper 1 and Paper 3 with either practical component Paper 5 or Paper 6.',
      extended: 'Extended uses Paper 2 and Paper 4 with either practical component Paper 5 or Paper 6.',
    },
    routes: [
      { id: '0625-core-practical', stage: 'core', label: 'Core: P1 + P3 + P5', papers: [1, 3, 5], guidance: 'Core theory route with the Practical Test.' },
      { id: '0625-core-alternative', stage: 'core', label: 'Core: P1 + P3 + P6', papers: [1, 3, 6], guidance: 'Core theory route with Alternative to Practical.' },
      { id: '0625-extended-practical', stage: 'extended', label: 'Extended: P2 + P4 + P5', papers: [2, 4, 5], guidance: 'Extended theory route with the Practical Test.' },
      { id: '0625-extended-alternative', stage: 'extended', label: 'Extended: P2 + P4 + P6', papers: [2, 4, 6], guidance: 'Extended theory route with Alternative to Practical.' },
    ],
    papers: {
      1: { title: 'Multiple Choice (Core)', mode: 'mcq', durationMinutes: 45, maxMarks: 40, defaultQuestionCount: 40, questionCountRange: [40, 40], stages: ['core'] },
      2: { title: 'Multiple Choice (Extended)', mode: 'mcq', durationMinutes: 45, maxMarks: 40, defaultQuestionCount: 40, questionCountRange: [40, 40], stages: ['extended'] },
      3: { title: 'Theory (Core)', mode: 'structured', durationMinutes: 75, maxMarks: 80, defaultQuestionCount: 12, questionCountRange: [8, 16], stages: ['core'] },
      4: { title: 'Theory (Extended)', mode: 'structured', durationMinutes: 75, maxMarks: 80, defaultQuestionCount: 12, questionCountRange: [8, 16], stages: ['extended'] },
      5: { title: 'Practical Test', mode: 'practical', durationMinutes: 75, maxMarks: 40, defaultQuestionCount: 4, questionCountRange: [3, 5], stages: ['core', 'extended'] },
      6: { title: 'Alternative to Practical', mode: 'practical', durationMinutes: 60, maxMarks: 40, defaultQuestionCount: 4, questionCountRange: [3, 5], stages: ['core', 'extended'] },
    },
  },
}

export function paperNumberFromVariant(variant) {
  const match = /^(\d)(?:\d)?$/.exec(String(variant || ''))
  return match ? Number(match[1]) : null
}

function paperNumbersFromVariant(variant) {
  return String(variant || '')
    .split('+')
    .map((part) => paperNumberFromVariant(part))
    .filter((paperNumber) => paperNumber != null)
}

function paperMapForYear(subject, year) {
  const structure = examStructures[subject]
  if (!structure) return null
  const useLegacyMaths = year != null && subject === '9709' && Number(year) <= 2019
  const useLegacyPhysics = year != null && subject === '9702' && Number(year) <= 2006
  const useLegacyIgcseMaths = year != null && subject === '0580' && Number(year) <= 2024
  if (!useLegacyMaths && !useLegacyPhysics && !useLegacyIgcseMaths) return structure.papers
  return { ...structure.papers, ...structure.legacyPapers }
}

export function getExamPaperProfile(subject, variant, year = null) {
  const structure = examStructures[subject]
  const paperNumbers = paperNumbersFromVariant(variant)
  const papers = paperMapForYear(subject, year)
  if (!structure || !papers || !paperNumbers.length) return null
  const matchedPapers = paperNumbers.map((paperNumber) => papers[paperNumber]).filter(Boolean)
  if (!matchedPapers.length) return null
  const isCombined = paperNumbers.length > 1
  const paperNumber = isCombined ? null : paperNumbers[0]
  const paper = matchedPapers[0]
  const routeIds = year != null && subject === '9709' && Number(year) <= 2019
    ? []
    : (structure.routes || []).filter((route) => paperNumbers.some((number) => route.papers.includes(number))).map((route) => route.id)
  const syllabusEra = year != null && subject === '9709' && Number(year) <= 2019 ? 'legacy-through-2019' : year != null && subject === '9702' && Number(year) <= 2006 ? 'legacy-through-2006' : year != null && subject === '0580' && Number(year) <= 2024 ? 'legacy-through-2024' : 'current'
  return {
    subject,
    paperNumber,
    paperNumbers,
    code: `${subject}/${variant || paperNumber || ''}`,
    sourceUrl: structure.sourceUrl,
    syllabusUrl: structure.syllabusUrl || structure.sourceUrl,
    qualification: structure.qualification,
    ...(isCombined ? {
      title: `Combined components ${paperNumbers.map((number) => `P${number}`).join(', ')}`,
      mode: 'reference',
      durationMinutes: null,
      maxMarks: null,
      defaultQuestionCount: null,
      questionCountRange: [0, 0],
      stages: [...new Set(matchedPapers.flatMap((entry) => entry.stages || []))],
    } : paper),
    routeIds,
    syllabusEra,
  }
}

export function getStageOptions(subject) {
  const structure = examStructures[subject]
  if (!structure) return []
  if (structure.stageOptions) return structure.stageOptions
  return [
    { value: 'as', label: 'AS components' },
    { value: 'a2', label: 'Year 2 completion' },
    { value: 'full', label: 'Full A Level routes' },
  ]
}

export function getRouteOptions(subject, stage) {
  return (examStructures[subject]?.routes || []).filter((route) => route.stage === stage)
}

export function getRouteGuidance(subject, routeId) {
  return examStructures[subject]?.routes?.find((route) => route.id === routeId)?.guidance || ''
}

export function getStageGuidance(subject, stage) {
  return examStructures[subject]?.stageGuidance?.[stage] || ''
}
