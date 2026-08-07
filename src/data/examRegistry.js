export const examFamilies = Object.freeze([
  { id: 'cambridge', provider: 'Cambridge International', kind: 'school-qualification' },
  { id: 'olympiad', provider: 'British Physics Olympiad', kind: 'olympiad' },
  { id: 'admissions', provider: 'UAT-UK', kind: 'admissions-test' },
])

export const qualifications = Object.freeze([
  qualification('cambridge-0580', 'cambridge', '0580', 'IGCSE Mathematics', 'math', ['IGCSE']),
  qualification('cambridge-0606', 'cambridge', '0606', 'IGCSE Additional Mathematics', 'math', ['IGCSE']),
  qualification('cambridge-0625', 'cambridge', '0625', 'IGCSE Physics', 'physics', ['IGCSE']),
  qualification('cambridge-0610', 'cambridge', '0610', 'IGCSE Biology', 'biology', ['IGCSE']),
  qualification('cambridge-9700', 'cambridge', '9700', 'AS & A Level Biology', 'biology', ['AS', 'A2']),
  qualification('cambridge-9701', 'cambridge', '9701', 'AS & A Level Chemistry', 'chemistry', ['AS', 'A2']),
  qualification('cambridge-9702', 'cambridge', '9702', 'AS & A Level Physics', 'physics', ['AS', 'A2']),
  qualification('cambridge-9708', 'cambridge', '9708', 'AS & A Level Economics', 'economics', ['AS', 'A2']),
  qualification('cambridge-9709', 'cambridge', '9709', 'AS & A Level Mathematics', 'math', ['AS', 'A2']),
  qualification('cambridge-9231', 'cambridge', '9231', 'AS & A Level Further Mathematics', 'math', ['AS', 'A2']),
  qualification('bpho', 'olympiad', 'bpho', 'British Physics Olympiad', 'physics', ['SPC', 'Round 1', 'Round 2']),
  qualification('esat', 'admissions', 'esat', 'ESAT', 'stem', ['Mathematics 1', 'Mathematics 2', 'Physics', 'Chemistry']),
  qualification('tmua', 'admissions', 'tmua', 'TMUA', 'math', ['Paper 1', 'Paper 2']),
])

function qualification(id, familyId, catalogSubject, title, subjectDomain, stages) {
  return Object.freeze({ id, familyId, catalogSubject, title, subjectDomain, stages })
}

export const qualificationByCatalogSubject = new Map(qualifications.map((item) => [item.catalogSubject, item]))

export function getQualificationByCatalogSubject(subject) {
  return qualificationByCatalogSubject.get(String(subject || '').toLowerCase()) || null
}
