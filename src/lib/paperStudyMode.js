export const PAPER_STUDY_MODES = Object.freeze({
  PRACTICE: 'past-paper-practice',
  SIMULATION: 'exam-simulation',
})

export function normalizePaperStudyMode(value) {
  return String(value || '').trim() === PAPER_STUDY_MODES.SIMULATION
    ? PAPER_STUDY_MODES.SIMULATION
    : PAPER_STUDY_MODES.PRACTICE
}

export function paperStudyModeLabel(value) {
  return normalizePaperStudyMode(value) === PAPER_STUDY_MODES.SIMULATION
    ? 'Exam Simulation'
    : 'Past-paper practice'
}

export function paperDraftKey(paper, mode = paper?.paperStudyMode) {
  const base = String(paper?.pairKey || paper?.paperId || paper?.id || '').trim()
  if (!base) return ''
  return normalizePaperStudyMode(mode) === PAPER_STUDY_MODES.SIMULATION
    ? `${base}::${PAPER_STUDY_MODES.SIMULATION}`
    : base
}
