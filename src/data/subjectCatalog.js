import { LEGACY_UNSCOPED_ROUTE_ID, routeById, routesForSubject } from './routeRegistry.js'

const SUBJECTS = [
  {
    id: 'igcse-biology',
    name: 'IGCSE Biology',
    code: '0610',
    icon: 'B',
    accent: '#16806a',
    topics: ['cells', 'coordination', 'inheritance', 'ecology'],
  },
  {
    id: 'biology',
    name: 'Biology',
    code: '9700',
    icon: 'B',
    accent: '#0f766e',
    topics: ['cells', 'transport', 'genetics', 'homeostasis'],
  },
  {
    id: 'igcse-math',
    name: 'IGCSE Mathematics',
    code: '0580',
    icon: 'M',
    accent: '#176d5b',
    topics: ['number', 'algebra', 'geometry', 'probability', 'statistics'],
  },
  {
    id: 'additional-math',
    name: 'IGCSE Additional Mathematics',
    code: '0606',
    icon: 'A',
    accent: '#9a4d12',
    topics: ['functions', 'algebra', 'trigonometry', 'calculus'],
  },
  {
    id: 'physics',
    name: 'Physics',
    code: '9702',
    icon: '⚡',
    accent: '#7357e8',
    topics: ['mechanics', 'waves', 'electricity', 'fields'],
  },
  {
    id: 'chemistry',
    name: 'Chemistry',
    code: '9701',
    icon: 'C',
    accent: '#0f766e',
    topics: ['physical chemistry', 'inorganic chemistry', 'organic chemistry', 'analysis'],
  },
  {
    id: 'economics',
    name: 'Economics',
    code: '9708',
    icon: 'E',
    accent: '#9f3d2e',
    topics: ['microeconomics', 'macroeconomics', 'international economics'],
  },
  {
    id: 'igcse-physics',
    name: 'IGCSE Physics',
    code: '0625',
    icon: 'P',
    accent: '#6d4aff',
    topics: ['forces', 'electricity', 'waves', 'thermal', 'atomic'],
  },
  {
    id: 'math',
    name: 'Mathematics',
    code: '9709',
    icon: '∫',
    accent: '#0f9f7a',
    topics: ['pure', 'mechanics-math', 'statistics'],
  },
  {
    id: 'further-math',
    name: 'Further Mathematics',
    code: '9231',
    icon: 'Σ',
    accent: '#b55016',
    topics: ['further-pure', 'further-mechanics'],
  },
  {
    id: 'bpho',
    name: 'BPhO',
    code: 'bpho',
    icon: 'B',
    accent: '#7b3f1d',
    topics: ['mechanics', 'waves', 'electricity', 'modern physics'],
  },
  {
    id: 'esat',
    name: 'ESAT',
    code: 'esat',
    icon: 'E',
    accent: '#4f46a5',
    topics: ['mathematics', 'physics', 'chemistry', 'biology'],
  },
  {
    id: 'tmua',
    name: 'TMUA',
    code: 'tmua',
    icon: 'T',
    accent: '#0e7490',
    topics: ['algebra', 'geometry', 'proof', 'problem solving'],
  },
  {
    id: 'amc12',
    name: 'AMC 12',
    code: 'amc12',
    icon: 'A',
    accent: '#be123c',
    topics: ['algebra', 'geometry', 'number theory', 'logic'],
  },
]

export const subjects = Object.freeze(SUBJECTS.map((subject) => {
  const routeIds = routesForSubject(subject.id).map((route) => route.routeId)
  const routeId = routeIds.length === 1 ? routeIds[0] : LEGACY_UNSCOPED_ROUTE_ID
  const route = routeById(routeId)
  return Object.freeze({
    ...subject,
    routeId,
    routeIds: Object.freeze(routeIds),
    qualificationId: route?.qualificationId || null,
    stage: route?.stage || LEGACY_UNSCOPED_ROUTE_ID,
  })
}))
