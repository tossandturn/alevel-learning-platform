export const PAPER_CATALOG_SCHEMA_VERSION = 2
export const PAPER_GOVERNANCE_SCHEMA_VERSION = 'paper-governance-v1'

const CIE_SUBJECTS = new Set(['0580', '0606', '0610', '0625', '9231', '9700', '9701', '9702', '9708', '9709'])

export const PAPER_GOVERNANCE_POLICIES = Object.freeze({
  'cie-mirror-restricted-v1': Object.freeze({
    sourceClass: 'third-party-mirror',
    licenseStatus: 'unverified-restricted',
    licenseEvidence: 'No first-party redistribution licence is recorded in the import manifest.',
    accessPolicyId: 'personal-study-restricted-v1',
  }),
  'official-public-restricted-v1': Object.freeze({
    sourceClass: 'official-public-source',
    licenseStatus: 'source-published-licence-not-recorded',
    licenseEvidence: 'The source page publishes the material, but a redistribution licence is not recorded locally.',
    accessPolicyId: 'personal-study-restricted-v1',
  }),
  'authorised-archive-restricted-v1': Object.freeze({
    sourceClass: 'authorised-source-archive',
    licenseStatus: 'source-stated-authorisation',
    licenseEvidence: 'The source archive states an authorisation relationship; local redistribution scope still requires review.',
    accessPolicyId: 'personal-study-restricted-v1',
  }),
})

export const PAPER_ACCESS_POLICIES = Object.freeze({
  'personal-study-restricted-v1': Object.freeze({
    audience: 'private-study-library',
    regionPolicy: 'not-verified',
    schoolPolicy: 'not-authorised-for-bulk-distribution',
    publicRedistribution: 'prohibited-until-licence-confirmed',
    accessLogPolicy: 'document-outcome-only-v1',
  }),
})

function normaliseText(value) {
  return String(value || '').trim()
}

export function sourcePolicyIdForPaper(item) {
  const source = `${normaliseText(item?.provenance)} ${normaliseText(item?.copyrightStatus)}`.toLowerCase()
  if (CIE_SUBJECTS.has(normaliseText(item?.subject))) return 'cie-mirror-restricted-v1'
  if (source.includes('permission') || source.includes('authorisation')) return 'authorised-archive-restricted-v1'
  return 'official-public-restricted-v1'
}

export function sourceVersionForPaper(item) {
  return [
    normaliseText(item?.year) || 'undated',
    normaliseText(item?.season) || 'session-not-recorded',
    normaliseText(item?.file),
  ].join(':')
}

export function paperGovernanceForItem(item, { duplicateOf = null, answerStatus = 'not-applicable', override = null } = {}) {
  const sourcePolicyId = sourcePolicyIdForPaper(item)
  const policy = PAPER_GOVERNANCE_POLICIES[sourcePolicyId]
  return Object.freeze({
    schemaVersion: PAPER_GOVERNANCE_SCHEMA_VERSION,
    state: override?.state || 'active',
    sourcePolicyId,
    accessPolicyId: policy.accessPolicyId,
    sourceVersion: sourceVersionForPaper(item),
    retrievedAt: null,
    retrievalStatus: 'not-recorded',
    integrityStatus: override?.integrityStatus || 'pending-release-audit',
    duplicateOf,
    answerStatus,
    reasonCode: override?.reasonCode || null,
    reviewedAt: override?.reviewedAt || null,
    reviewEvidence: override?.reviewEvidence || null,
  })
}

export function isPaperAvailableToStudents(item) {
  return item?.governance?.schemaVersion === PAPER_GOVERNANCE_SCHEMA_VERSION
    && item.governance.state === 'active'
    && Boolean(normaliseText(item.localUrl))
}

export function governancePolicyForItem(item) {
  const governance = item?.governance || {}
  return {
    source: PAPER_GOVERNANCE_POLICIES[governance.sourcePolicyId] || null,
    access: PAPER_ACCESS_POLICIES[governance.accessPolicyId] || null,
  }
}
