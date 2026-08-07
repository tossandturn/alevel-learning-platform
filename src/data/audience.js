export const learningTracks = Object.freeze([
  { id: 'IGCSE', label: 'IGCSE', audience: 'Years 10-11', description: 'Build the syllabus map, practical vocabulary and exam habits.' },
  { id: 'AS', label: 'AS', audience: 'First year', description: 'Secure the AS components before the A2 route adds new papers.' },
  { id: 'A2', label: 'A2', audience: 'Second year', description: 'Close gaps, practise the A2 components and prepare for the full route.' },
  { id: 'competition', label: 'Competition', audience: 'BPhO / ESAT / TMUA / AMC12', description: 'Train problem selection, proof and unfamiliar applications.' },
  { id: 'IELTS', label: 'IELTS', audience: 'Academic English', description: 'Learn the language needed to read and explain STEM questions.' },
])

export const workspaceRoles = Object.freeze([
  { id: 'student', label: 'Student', description: 'Choose a route, practise, submit and improve.' },
  { id: 'teacher', label: 'Teacher', description: 'Create classes, assign verified work and review evidence.' },
  { id: 'school', label: 'School', description: 'See programme coverage, participation and risk by cohort.' },
])

export const dataChain = Object.freeze([
  { label: 'Source', detail: 'Official syllabus, paper, mark scheme and source-page evidence.' },
  { label: 'Learning', detail: 'Student route, stage, topic, mode, answer and handwriting evidence.' },
  { label: 'Assessment', detail: 'Deterministic marks plus bounded AI review with confidence and provenance.' },
  { label: 'Sharing', detail: 'Assignment, class membership, submission event and teacher feedback.' },
  { label: 'Insight', detail: 'Mastery, mistakes, retests and cohort-level next actions.' },
])

export function stagesForSubject(code) {
  if (code === '0610' || code === '0625' || code === '0580' || code === '0606') return ['IGCSE']
  if (code === '9700' || code === '9701' || code === '9702' || code === '9708' || code === '9709' || code === '9231') return ['AS', 'A2']
  return ['Competition']
}
