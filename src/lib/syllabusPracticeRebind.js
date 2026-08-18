const BINDING_FIELDS = Object.freeze([
  'schemaVersion',
  'sourceQuestionId',
  'questionPartId',
  'bindingSignature',
  'reviewVersion',
  'sourceDocumentSha256',
  'answerDocumentSha256',
  'sourceIndexSha256',
  'sourceManifestChecksum',
])

function boundedString(value, maxLength = 512) {
  const text = String(value || '').trim()
  return text ? text.slice(0, maxLength) : ''
}

function compactBinding(value) {
  if (!value || typeof value !== 'object') return null
  const binding = {}
  for (const field of BINDING_FIELDS) {
    const text = boundedString(value[field], field.endsWith('Sha256') || field === 'bindingSignature' ? 256 : 512)
    if (text) binding[field] = text
  }
  return Object.keys(binding).length ? binding : null
}

function compactComponents(value) {
  const values = Array.isArray(value) ? value : [value]
  return [...new Set(values
    .map((component) => Number(component))
    .filter((component) => Number.isInteger(component) && component > 0))]
}

/**
 * Persisted syllabus sets are revalidated against the server's current bank.
 * This payload intentionally carries identities only; the server must supply
 * all student-visible source content again after the binding check.
 */
export function syllabusPracticeRebindPayload(unit) {
  if (!unit || typeof unit !== 'object') return null
  return {
    id: boundedString(unit.id, 256),
    sourceAuthority: boundedString(unit.sourceAuthority, 64),
    sourceGateVersion: boundedString(unit.sourceGateVersion, 128),
    routeId: boundedString(unit.routeId, 160),
    syllabusTopic: boundedString(unit.syllabusTopic || unit.knowledgeGroupId || unit.topicId, 1024),
    knowledgeGroupId: boundedString(unit.knowledgeGroupId || unit.syllabusTopic || unit.topicId, 512),
    paperComponent: compactComponents(unit.paperComponent),
    parts: (Array.isArray(unit.parts) ? unit.parts : []).map((part) => ({
      id: boundedString(part?.id, 512),
      sourceQuestionId: boundedString(part?.sourceQuestionId, 512),
      questionPartId: boundedString(part?.questionPartId || part?.partId, 256),
      sourceBindingProvenance: compactBinding(part?.sourceBindingProvenance || part?.markingProvenance),
    })),
  }
}
