export class MarkingCapabilityError extends Error {
  constructor(code, message, { loginRequired = false, retryable = false } = {}) {
    super(message)
    this.name = 'MarkingCapabilityError'
    this.code = code
    this.loginRequired = loginRequired
    this.retryable = retryable
  }
}

export async function requestMarkingCapabilities({ token, attemptId, mode, submitted, paperId = '', parts, fetchImpl = fetch } = {}) {
  if (!token) throw new MarkingCapabilityError('identity_required', 'Sign in with your IELTSist account before requesting AI marking.', { loginRequired: true })
  let response
  try {
    response = await fetchImpl('/api/stem/marking/capabilities', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attemptId, mode, submitted, paperId, parts }),
    })
  } catch {
    throw new MarkingCapabilityError('marking_capability_unavailable', 'The marking service could not verify this submitted attempt. Your work remains saved.', { retryable: true })
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new MarkingCapabilityError(
      payload.code || (response.status === 401 || response.status === 403 ? 'identity_required' : 'marking_capability_rejected'),
      payload.error || 'This submitted attempt could not be verified for AI marking.',
      { loginRequired: response.status === 401 || response.status === 403, retryable: response.status >= 500 },
    )
  }
  if (!Array.isArray(payload.capabilities)) throw new MarkingCapabilityError('marking_capability_invalid', 'The marking service returned an invalid submitted-attempt capability.', { retryable: true })
  return payload
}
