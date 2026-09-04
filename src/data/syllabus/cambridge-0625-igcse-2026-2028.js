/*
 * Cambridge IGCSE Physics 0625, 2026-2028.
 *
 * The topic and point IDs are the stable application representation of the
 * six official syllabus content areas. The official syllabus remains the
 * source of truth; this file records the source URL and the review anchors
 * used when mapping a question group.
 */

export const CAMBRIDGE_0625_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '0625',
  syllabusVersion: '2026-2028',
  officialUrl: 'https://www.cambridgeinternational.org/Images/697209-2026-2028-syllabus.pdf',
  subjectContentPages: Object.freeze([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40]),
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'IGCSE', track: 'theory', label: 'Multiple Choice (Core)' }),
    Object.freeze({ component: 2, stage: 'IGCSE', track: 'theory', label: 'Multiple Choice (Extended)' }),
    Object.freeze({ component: 3, stage: 'IGCSE', track: 'theory', label: 'Theory (Core)' }),
    Object.freeze({ component: 4, stage: 'IGCSE', track: 'theory', label: 'Theory (Extended)' }),
    Object.freeze({ component: 5, stage: 'IGCSE', track: 'practical', label: 'Practical Test' }),
    Object.freeze({ component: 6, stage: 'IGCSE', track: 'practical', label: 'Alternative to Practical' }),
  ]),
})

const ROUTE_ID = 'cie-0625-igcse-physics'

function point(topicId, sectionCode, outcomeNumber, officialText) {
  return Object.freeze({
    id: `physics-0625-point-${sectionCode.replace('.', '-')}-${String(outcomeNumber).padStart(2, '0')}`,
    topicId,
    sectionCode,
    outcomeNumber,
    officialText,
  })
}

function topic(code, name, order, officialPage, sections) {
  const id = `0625-igcse-topic-${String(code).padStart(2, '0')}`
  const points = sections.flatMap(([sectionCode, outcomes]) => outcomes.map((text, index) => point(id, sectionCode, index + 1, text)))
  return Object.freeze({
    id,
    routeId: ROUTE_ID,
    syllabusVersion: CAMBRIDGE_0625_SYLLABUS_SOURCE.syllabusVersion,
    code: String(code),
    name,
    order,
    officialPage,
    points: Object.freeze(points),
  })
}

export const CAMBRIDGE_0625_IGCSE_TOPICS = Object.freeze([
  topic(1, 'Motion, forces and energy', 1, 12, [
    ['1.1', ['describe and explain motion, forces, momentum, pressure, work, energy and power']],
  ]),
  topic(2, 'Thermal physics', 2, 18, [
    ['2.1', ['describe the kinetic particle model and use it to explain thermal behaviour']],
    ['2.2', ['describe temperature, internal energy and changes of state']],
    ['2.3', ['explain conduction, convection and radiation as methods of thermal energy transfer']],
  ]),
  topic(3, 'Waves', 3, 22, [
    ['3.1', ['describe wave properties and use the wave equation']],
    ['3.2', ['describe reflection, refraction and images formed by lenses and mirrors']],
    ['3.3', ['describe sound and the electromagnetic spectrum']],
  ]),
  topic(4, 'Electricity and magnetism', 4, 27, [
    ['4.1', ['describe magnetic fields and magnetic effects']],
    ['4.2', ['use current, potential difference, resistance, charge, energy and power relationships']],
    ['4.3', ['analyse electrical circuits and electrical safety']],
    ['4.4', ['describe electromagnetic induction, transformers and generators']],
  ]),
  topic(5, 'Nuclear physics', 5, 34, [
    ['5.1', ['describe atomic structure and nuclear notation']],
    ['5.2', ['describe radioactivity, radioactive decay, half-life and radiation safety']],
  ]),
  topic(6, 'Space physics', 6, 37, [
    ['6.1', ['describe the Earth, Solar System and gravitational effects']],
    ['6.2', ['describe stars and their evolution']],
    ['6.3', ['describe evidence for the expanding Universe and use the Hubble relationship']],
  ]),
])

export const CAMBRIDGE_0625_IGCSE_SYLLABUS = Object.freeze({
  ...CAMBRIDGE_0625_SYLLABUS_SOURCE,
  routeId: ROUTE_ID,
  topics: CAMBRIDGE_0625_IGCSE_TOPICS,
  points: Object.freeze(CAMBRIDGE_0625_IGCSE_TOPICS.flatMap((item) => item.points)),
})
