/*
 * Compatibility export for the Cambridge 9709 AS route combining Paper 1
 * with Paper 5 Probability & Statistics 1 (student label S1).
 */

import { CAMBRIDGE_9709_SYLLABUS_SOURCE, cambridge9709SyllabusForRoute } from './cambridge-9709-2026-2027.js'

const ROUTE_ID = 'cie-9709-as-p1-p5'
const syllabus = cambridge9709SyllabusForRoute(ROUTE_ID, [1, 5])

export const CAMBRIDGE_9709_P1_S1_SYLLABUS_SOURCE = Object.freeze({
  ...CAMBRIDGE_9709_SYLLABUS_SOURCE,
  subjectContentPages: Object.freeze([19, 20, 21, 22, 34, 35, 36]),
  assessmentComponents: syllabus.assessmentComponents,
})

export const CAMBRIDGE_9709_AS_P1_S1_TOPICS = syllabus.topics

export const CAMBRIDGE_9709_AS_P1_S1_SYLLABUS = syllabus
