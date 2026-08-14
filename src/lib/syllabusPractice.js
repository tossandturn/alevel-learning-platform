import importedQuestionIndex from '../data/importedQuestionIndex.json' with { type: 'json' }
import paperCatalog from '../../public/data/papers.json' with { type: 'json' }
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../data/syllabus/cambridge-9702-as-2025-2027.js'
import { isHumanReviewedPastPaperItem, normalizeImportedQuestion } from '../data/questionBank.js'
import { routeById } from '../data/routeRegistry.js'

export const SYLLABUS_CATALOG_SCHEMA_VERSION = 'syllabus-catalog-v1'
export const SYLLABUS_MAPPING_SCHEMA_VERSION = 'question-syllabus-mapping-v1'

const SUPPORTED_9702_COMPONENTS = Object.freeze([1, 2])
const SET_SIZES = Object.freeze([5, 10, 15])

function official9702FirstBatchPapers() {
  return (paperCatalog.items || []).filter((item) => (
    item.subject === '9702'
    && item.kind === 'qp'
    && [1, 2].includes(Number(item.examProfile?.paperNumber ?? item.paperComponent))
    && item.markSchemeId
    && Number(item.year) >= 2023
    && Number(item.year) <= 2025
  ))
}

function joinedIndexItems(index) {
  if (Array.isArray(index.items)) return index.items
  const answers = new Map((index.answers || []).map((answer) => [answer.answerId, answer]))
  const bindings = new Map((index.bindings || []).map((binding) => [binding.questionId, binding]))
  return (index.questions || []).map((question) => {
    const binding = bindings.get(question.questionId)
    const answer = answers.get(binding?.answerId)
    return {
      ...question,
      ...(answer || {}),
      answerBinding: binding || null,
    }
  })
}

function raw9702QuestionGroups() {
  const route = routeById(CAMBRIDGE_9702_AS_SYLLABUS.routeId)
  return joinedIndexItems(importedQuestionIndex)
    .filter((question) => (
      question.subjectCode === '9702'
      && SUPPORTED_9702_COMPONENTS.includes(Number(question.sourceRef?.component))
      && question.sourceRef?.paperId
    ))
    .map((question) => {
      const answerRef = question.answerRef || {}
      const answerBinding = question.answerBinding || {}
      return normalizeImportedQuestion({
        ...question,
        answerBinding,
        answerRef,
        answerParts: question.answerParts || [],
        parts: question.parts || [],
      }, route)
    })
}

function candidateMappingFor(question) {
  const topicId = String(question.knowledgeGroupId || question.topicId || '')
  const topic = CAMBRIDGE_9702_AS_SYLLABUS.topics.find((item) => item.id === topicId)
  if (!topic) return null
  const suppliedStatus = String(question.syllabusMapping?.reviewStatus || '').toLowerCase()
  const reviewed = suppliedStatus === 'reviewed'
  return Object.freeze({
    schemaVersion: SYLLABUS_MAPPING_SCHEMA_VERSION,
    questionGroupId: question.sourceQuestionId || question.questionGroupId,
    primaryTopicId: topic.id,
    secondaryTopicIds: Object.freeze([]),
    syllabusPointIds: Object.freeze(question.syllabusMapping?.syllabusPointIds || []),
    confidence: reviewed ? Number(question.syllabusMapping?.confidence || 1) : 0.5,
    mappingMethod: reviewed ? 'manual' : 'rule',
    reviewStatus: reviewed ? 'reviewed' : 'pending',
    reviewedBy: reviewed ? question.syllabusMapping.reviewedBy || null : null,
    reviewedAt: reviewed ? question.syllabusMapping.reviewedAt || null : null,
    reviewReason: reviewed ? null : 'Machine-indexed topic tag is a review candidate, not publishable evidence.',
  })
}

function currentReviewedQuestionById(questionBank) {
  return new Map((Array.isArray(questionBank) ? questionBank : [])
    .filter((question) => question?.routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId)
    .map((question) => [question.sourceQuestionId || question.questionGroupId, question]))
}

function effectiveQuestionRecords(questionBank) {
  const reviewedById = currentReviewedQuestionById(questionBank)
  return raw9702QuestionGroups().map((rawQuestion) => {
    const sourceQuestionId = rawQuestion.sourceQuestionId || rawQuestion.questionGroupId
    const reviewedQuestion = reviewedById.get(sourceQuestionId)
    const question = reviewedQuestion || rawQuestion
    const mapping = candidateMappingFor(question)
    const reviewed = Boolean(
      reviewedQuestion
      && isHumanReviewedPastPaperItem(reviewedQuestion)
      && mapping?.reviewStatus === 'reviewed',
    )
    return Object.freeze({
      question,
      sourceQuestionId,
      questionGroupId: question.questionGroupId || sourceQuestionId,
      routeId: CAMBRIDGE_9702_AS_SYLLABUS.routeId,
      stage: 'AS',
      subjectCode: '9702',
      paperComponent: Number(question.sourceRef?.component) || null,
      verificationStatus: question.answerBinding?.verificationStatus || 'machine-indexed',
      sourceContentComplete: question.sourceContent?.complete === true,
      semanticStatus: question.sourceContent?.semanticStatus || 'unreviewed',
      mapping: mapping || Object.freeze({
        schemaVersion: SYLLABUS_MAPPING_SCHEMA_VERSION,
        questionGroupId: sourceQuestionId,
        primaryTopicId: null,
        secondaryTopicIds: Object.freeze([]),
        syllabusPointIds: Object.freeze([]),
        confidence: 0,
        mappingMethod: 'rule',
        reviewStatus: 'rejected',
        reviewReason: 'No canonical 9702 syllabus topic could be resolved.',
      }),
      eligible: reviewed,
    })
  })
}

function topicRowsForRoute(routeId, questionBank) {
  if (routeId !== CAMBRIDGE_9702_AS_SYLLABUS.routeId) {
    const route = routeById(routeId)
    return (route?.syllabus?.topics || []).map((topic, index) => ({
      id: topic.id,
      routeId,
      syllabusVersion: route.syllabus.version,
      code: String(index + 1),
      name: topic.title,
      order: index + 1,
      officialPage: null,
      points: [],
      verifiedQuestionCount: 0,
      indexedQuestionCount: 0,
      pendingReviewCount: 0,
      availableSetSizes: [],
      ready: false,
      ctaPolicy: 'hidden',
      sourceGap: 'This route has no syllabus-backed question mapping yet.',
    }))
  }

  const records = effectiveQuestionRecords(questionBank)
  return CAMBRIDGE_9702_AS_SYLLABUS.topics.map((topic) => {
    const topicRecords = records.filter((record) => record.mapping.primaryTopicId === topic.id)
    const eligible = topicRecords.filter((record) => record.eligible)
    const verifiedQuestionCount = eligible.length
    const indexedQuestionCount = topicRecords.length
    const pendingReviewCount = topicRecords.filter((record) => !record.eligible).length
    const ready = verifiedQuestionCount >= 10
    return {
      ...topic,
      verifiedQuestionCount,
      indexedQuestionCount,
      pendingReviewCount,
      availableSetSizes: SET_SIZES.filter((size) => size <= verifiedQuestionCount),
      ready,
      ctaPolicy: ready ? 'start' : verifiedQuestionCount > 0 ? 'limited-indexing' : 'hidden',
      sourceGap: ready
        ? null
        : `Official QP/MS candidates indexed: ${indexedQuestionCount}; semantic-reviewed and mapped: ${verifiedQuestionCount}. Human source review is required before Topic Drill can start.`,
    }
  })
}

export function syllabusTopicsInventory({ routeId, questionBank = [] } = {}) {
  const route = routeById(routeId)
  if (!route) {
    const error = new Error('routeId is not registered.')
    error.code = 'invalid_route'
    error.statusCode = 400
    throw error
  }
  const topics = topicRowsForRoute(routeId, questionBank)
  const firstBatchPapers = routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId ? official9702FirstBatchPapers() : []
  const effectiveRecords = routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId ? effectiveQuestionRecords(questionBank) : []
  return {
    schemaVersion: SYLLABUS_CATALOG_SCHEMA_VERSION,
    routeId,
    syllabusVersion: routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId
      ? CAMBRIDGE_9702_AS_SYLLABUS.syllabusVersion
      : route.syllabus.version,
    syllabusUrl: routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId
      ? CAMBRIDGE_9702_AS_SYLLABUS.officialUrl
      : route.syllabus.url,
    assessmentComponents: routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId
      ? CAMBRIDGE_9702_AS_SYLLABUS.assessmentComponents
      : [],
    topics,
    ready: topics.some((topic) => topic.ready),
    officialPaperCount: firstBatchPapers.length,
    officialPairedPaperCount: firstBatchPapers.filter((paper) => Boolean(paper.markSchemeId)).length,
    indexedQuestionGroupCount: routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId
      ? effectiveRecords.length
      : topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0),
    verifiedQuestionGroupCount: topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0),
    unmappedQuestionGroupCount: effectiveRecords.filter((record) => !record.mapping.primaryTopicId).length,
    source: 'server-syllabus-catalog',
    gate: 'reviewed-question-group-and-reviewed-syllabus-mapping',
  }
}

export function syllabusMappingCandidates({ questionBank = [] } = {}) {
  return effectiveQuestionRecords(questionBank).map((record) => ({
    schemaVersion: SYLLABUS_MAPPING_SCHEMA_VERSION,
    questionGroupId: record.questionGroupId,
    routeId: record.routeId,
    paperComponent: record.paperComponent,
    questionPaperId: record.question.sourceRef?.paperId || null,
    markSchemeId: record.question.answerRef?.documentId || null,
    primaryTopicId: record.mapping.primaryTopicId,
    secondaryTopicIds: record.mapping.secondaryTopicIds,
    syllabusPointIds: record.mapping.syllabusPointIds,
    confidence: record.mapping.confidence,
    mappingMethod: record.mapping.mappingMethod,
    reviewStatus: record.mapping.reviewStatus,
    reviewedBy: record.mapping.reviewedBy || null,
    reviewedAt: record.mapping.reviewedAt || null,
    sourceContentComplete: record.sourceContentComplete,
    verificationStatus: record.verificationStatus,
    semanticStatus: record.semanticStatus,
  }))
}

function seededRandom(seed) {
  let value = Number(seed) >>> 0
  return () => {
    value = (value + 0x6D2B79F5) >>> 0
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffle(items, random) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return copy
}

function questionSortKey(question) {
  return [
    String(question.sourceRef?.paperId || ''),
    Number(question.sourceRef?.year) || 0,
    String(question.sourceRef?.question || ''),
  ].join('\u0000')
}

function selectBalancedQuestions(records, topicIds, requestedCount, attemptedIds, seed) {
  const random = seededRandom(seed)
  const eligible = records.filter((record) => (
    record.eligible
    && topicIds.includes(record.mapping.primaryTopicId)
    && SUPPORTED_9702_COMPONENTS.includes(record.paperComponent)
  ))
  const unseen = eligible.filter((record) => !attemptedIds.has(record.sourceQuestionId))
  const seen = eligible.filter((record) => attemptedIds.has(record.sourceQuestionId))
  const pools = new Map(topicIds.map((topicId) => [
    topicId,
    shuffle([...unseen.filter((record) => record.mapping.primaryTopicId === topicId)].sort((left, right) => questionSortKey(left.question).localeCompare(questionSortKey(right.question))), random),
  ]))
  const seenPools = new Map(topicIds.map((topicId) => [
    topicId,
    shuffle([...seen.filter((record) => record.mapping.primaryTopicId === topicId)].sort((left, right) => questionSortKey(left.question).localeCompare(questionSortKey(right.question))), random),
  ]))
  const selected = []
  while (selected.length < requestedCount) {
    let added = false
    for (const topicId of topicIds) {
      const pool = pools.get(topicId)
      if (pool?.length) {
        selected.push(pool.shift())
        added = true
        if (selected.length >= requestedCount) break
      }
    }
    if (selected.length >= requestedCount) break
    if (!added) {
      for (const topicId of topicIds) {
        const pool = seenPools.get(topicId)
        if (pool?.length) {
          selected.push(pool.shift())
          added = true
          if (selected.length >= requestedCount) break
        }
      }
    }
    if (!added) break
  }
  return selected
}

function publicQuestionGroup(record) {
  const question = record.question
  return {
    id: record.sourceQuestionId,
    questionGroupId: record.questionGroupId,
    routeId: record.routeId,
    stage: record.stage,
    subjectCode: record.subjectCode,
    paperComponent: record.paperComponent,
    questionNumber: question.sourceRef?.question || null,
    totalMarks: Number(question.totalMarks || question.marks || 0),
    prompt: question.prompt || '',
    parts: (question.parts || []).map((part) => ({
      partId: part.partId,
      label: part.label,
      marks: Number(part.marks || 0),
      promptFragment: part.promptFragment || '',
      answerArea: part.answerArea || null,
      sourcePage: part.sourcePage || question.sourceRef?.pageStart || null,
      sourceEvidence: part.sourceEvidence || [],
    })),
    sourceRef: question.sourceRef,
    answerRef: question.answerRef,
    sourceContent: {
      complete: question.sourceContent?.complete === true,
      pages: question.sourceContent?.sourcePages || [],
      assetUrls: question.sourceContent?.assetUrls || question.sourceRef?.assetUrls || [],
      bindingSignature: question.sourceContent?.bindingSignature || '',
    },
    syllabusMapping: record.mapping,
  }
}

export function buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds = [],
  questionCount = 10,
  components,
  excludeAttempted = true,
  attemptedQuestionIds = [],
  seed = Date.now(),
  questionBank = [],
} = {}) {
  if (routeId !== CAMBRIDGE_9702_AS_SYLLABUS.routeId) {
    const error = new Error('This syllabus practice-set route is not configured yet.')
    error.code = 'syllabus_route_not_configured'
    error.statusCode = 409
    throw error
  }
  const topicIds = [...new Set(syllabusTopicIds.map((value) => String(value || '').trim()).filter(Boolean))]
  const validTopicIds = new Set(CAMBRIDGE_9702_AS_SYLLABUS.topics.map((topic) => topic.id))
  if (!topicIds.length || topicIds.some((topicId) => !validTopicIds.has(topicId))) {
    const error = new Error('Select one or more official syllabus topic IDs.')
    error.code = 'invalid_syllabus_topic'
    error.statusCode = 400
    throw error
  }
  const requestedCount = Math.min(15, Math.max(1, Number(questionCount) || 10))
  const requestedComponents = components === undefined
    ? [...SUPPORTED_9702_COMPONENTS]
    : [...new Set((Array.isArray(components) ? components : [components]).map((value) => Number(value)))]
  const invalidComponents = requestedComponents.filter((value) => !SUPPORTED_9702_COMPONENTS.includes(value))
  if (!requestedComponents.length || invalidComponents.length) {
    const error = new Error('Topic Drill uses AS Paper 1 and Paper 2 only. AS Paper 3 is the separate practical-skills track.')
    error.code = 'invalid_paper_component'
    error.statusCode = 400
    throw error
  }
  const selectedComponents = requestedComponents
  const records = effectiveQuestionRecords(questionBank).filter((record) => selectedComponents.includes(record.paperComponent))
  const attemptedIds = new Set(attemptedQuestionIds.map((value) => String(value || '').trim()).filter(Boolean))
  const availableRecords = records.filter((record) => (
    record.eligible && topicIds.includes(record.mapping.primaryTopicId)
  ))
  const selected = selectBalancedQuestions(
    records,
    topicIds,
    requestedCount,
    excludeAttempted ? attemptedIds : new Set(),
    seed,
  )
  if (!selected.length) {
    const error = new Error(`No reviewed source questions are available for the selected syllabus topic${topicIds.length === 1 ? '' : 's'}.`)
    error.code = 'insufficient_verified_questions'
    error.statusCode = 409
    error.availableCount = 0
    error.indexedCount = records.filter((record) => topicIds.includes(record.mapping.primaryTopicId)).length
    throw error
  }
  return {
    schemaVersion: 'syllabus-practice-set-v1',
    routeId,
    stage: 'AS',
    subjectCode: '9702',
    syllabusVersion: CAMBRIDGE_9702_AS_SYLLABUS.syllabusVersion,
    syllabusTopicIds: topicIds,
    components: selectedComponents,
    requestedCount,
    availableCount: availableRecords.length,
    questionCount: selected.length,
    partial: selected.length < requestedCount,
    seed: Number(seed) >>> 0,
    questionGroups: selected.map(publicQuestionGroup),
  }
}

export function ensureSyllabusTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS syllabus_topics (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      syllabus_version TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      official_page INTEGER,
      official_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS syllabus_points (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      section_code TEXT NOT NULL,
      outcome_number INTEGER NOT NULL,
      official_text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS question_groups (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      paper_component INTEGER,
      question_paper_id TEXT,
      mark_scheme_id TEXT,
      question_pages_json TEXT NOT NULL,
      mark_scheme_pages_json TEXT NOT NULL,
      total_marks INTEGER NOT NULL,
      source_content_complete INTEGER NOT NULL,
      verification_status TEXT NOT NULL,
      source_json TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_question_groups_syllabus_gate
      ON question_groups(route_id, paper_component, source_content_complete, verification_status);
    CREATE TABLE IF NOT EXISTS question_syllabus_mapping (
      question_group_id TEXT PRIMARY KEY REFERENCES question_groups(id) ON DELETE CASCADE,
      primary_topic_id TEXT REFERENCES syllabus_topics(id),
      secondary_topic_ids_json TEXT NOT NULL,
      syllabus_point_ids_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      mapping_method TEXT NOT NULL,
      review_status TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT,
      evidence_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_question_syllabus_mapping_gate
      ON question_syllabus_mapping(primary_topic_id, review_status);
  `)
}

export function seedSyllabusTables(database, questionBank = []) {
  ensureSyllabusTables(database)
  const now = new Date().toISOString()
  const insertTopic = database.prepare(`
    INSERT INTO syllabus_topics (id, route_id, syllabus_version, code, name, order_index, official_page, official_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      route_id = excluded.route_id,
      syllabus_version = excluded.syllabus_version,
      code = excluded.code,
      name = excluded.name,
      order_index = excluded.order_index,
      official_page = excluded.official_page,
      official_url = excluded.official_url,
      updated_at = excluded.updated_at
  `)
  const insertPoint = database.prepare(`
    INSERT INTO syllabus_points (id, topic_id, section_code, outcome_number, official_text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      topic_id = excluded.topic_id,
      section_code = excluded.section_code,
      outcome_number = excluded.outcome_number,
      official_text = excluded.official_text,
      updated_at = excluded.updated_at
  `)
  for (const topic of CAMBRIDGE_9702_AS_SYLLABUS.topics) {
    insertTopic.run(topic.id, topic.routeId, topic.syllabusVersion, topic.code, topic.name, topic.order, topic.officialPage, CAMBRIDGE_9702_AS_SYLLABUS.officialUrl, now)
    for (const syllabusPoint of topic.points) insertPoint.run(syllabusPoint.id, topic.id, syllabusPoint.sectionCode, syllabusPoint.outcomeNumber, syllabusPoint.officialText, now)
  }

  const records = effectiveQuestionRecords(questionBank)
  const insertQuestion = database.prepare(`
    INSERT INTO question_groups (
      id, route_id, stage, subject_code, paper_component, question_paper_id, mark_scheme_id,
      question_pages_json, mark_scheme_pages_json, total_marks, source_content_complete,
      verification_status, source_json, answer_json, parts_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      route_id = excluded.route_id,
      stage = excluded.stage,
      subject_code = excluded.subject_code,
      paper_component = excluded.paper_component,
      question_paper_id = excluded.question_paper_id,
      mark_scheme_id = excluded.mark_scheme_id,
      question_pages_json = excluded.question_pages_json,
      mark_scheme_pages_json = excluded.mark_scheme_pages_json,
      total_marks = excluded.total_marks,
      source_content_complete = excluded.source_content_complete,
      verification_status = excluded.verification_status,
      source_json = excluded.source_json,
      answer_json = excluded.answer_json,
      parts_json = excluded.parts_json,
      updated_at = excluded.updated_at
  `)
  const insertMapping = database.prepare(`
    INSERT INTO question_syllabus_mapping (
      question_group_id, primary_topic_id, secondary_topic_ids_json, syllabus_point_ids_json,
      confidence, mapping_method, review_status, reviewed_by, reviewed_at, evidence_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(question_group_id) DO UPDATE SET
      primary_topic_id = excluded.primary_topic_id,
      secondary_topic_ids_json = excluded.secondary_topic_ids_json,
      syllabus_point_ids_json = excluded.syllabus_point_ids_json,
      confidence = excluded.confidence,
      mapping_method = excluded.mapping_method,
      review_status = excluded.review_status,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at
  `)
  for (const record of records) {
    const question = record.question
    const answerRef = question.answerRef || {}
    const mapping = record.mapping
    insertQuestion.run(
      record.questionGroupId,
      record.routeId,
      record.stage,
      record.subjectCode,
      record.paperComponent,
      question.sourceRef?.paperId || null,
      answerRef.documentId || null,
      JSON.stringify(question.sourceContent?.sourcePages || []),
      JSON.stringify(answerRef.pageStart ? [answerRef.pageStart] : []),
      Number(question.totalMarks || question.marks || 0),
      record.sourceContentComplete ? 1 : 0,
      record.verificationStatus,
      JSON.stringify(question.sourceRef || {}),
      JSON.stringify(answerRef),
      JSON.stringify(question.parts || []),
      now,
    )
    insertMapping.run(
      record.questionGroupId,
      mapping.primaryTopicId,
      JSON.stringify(mapping.secondaryTopicIds || []),
      JSON.stringify(mapping.syllabusPointIds || []),
      Number(mapping.confidence || 0),
      mapping.mappingMethod,
      mapping.reviewStatus,
      mapping.reviewedBy || null,
      mapping.reviewedAt || null,
      JSON.stringify({ reason: mapping.reviewReason || null, officialUrl: CAMBRIDGE_9702_AS_SYLLABUS.officialUrl }),
      now,
    )
  }
}

export function syllabusDatabaseInventory(database, routeId) {
  const topics = database.prepare(`
    SELECT
      topics.id,
      topics.route_id AS routeId,
      topics.syllabus_version AS syllabusVersion,
      topics.code,
      topics.name,
      topics.order_index AS topicOrder,
      topics.official_page AS officialPage,
      COUNT(DISTINCT CASE
        WHEN groups.source_content_complete = 1
          AND groups.verification_status = 'reviewed'
          AND mapping.review_status = 'reviewed'
        THEN groups.id END
      ) AS verifiedQuestionCount,
      COUNT(DISTINCT groups.id) AS indexedQuestionCount,
      COUNT(DISTINCT CASE
        WHEN NOT (
          groups.source_content_complete = 1
          AND groups.verification_status = 'reviewed'
          AND mapping.review_status = 'reviewed'
        )
        THEN groups.id END
      ) AS pendingReviewCount
    FROM syllabus_topics AS topics
    LEFT JOIN question_syllabus_mapping AS mapping ON mapping.primary_topic_id = topics.id
    LEFT JOIN question_groups AS groups
      ON groups.id = mapping.question_group_id
      AND groups.route_id = topics.route_id
      AND groups.paper_component IN (1, 2)
    WHERE topics.route_id = ?
    GROUP BY topics.id
    ORDER BY topics.order_index ASC
  `).all(routeId)
  return topics.map((topic) => {
    const verifiedQuestionCount = Number(topic.verifiedQuestionCount) || 0
    const indexedQuestionCount = Number(topic.indexedQuestionCount) || 0
    const pendingReviewCount = Number(topic.pendingReviewCount) || 0
    const ready = verifiedQuestionCount >= 10
    return {
      ...topic,
      verifiedQuestionCount,
      indexedQuestionCount,
      pendingReviewCount,
      availableSetSizes: SET_SIZES.filter((size) => size <= verifiedQuestionCount),
      ready,
      ctaPolicy: ready ? 'start' : verifiedQuestionCount > 0 ? 'limited-indexing' : 'hidden',
      sourceGap: ready
        ? null
        : `Official QP/MS candidates indexed: ${indexedQuestionCount}; semantic-reviewed and mapped: ${verifiedQuestionCount}. ${pendingReviewCount} item(s) remain in review.`,
    }
  })
}
