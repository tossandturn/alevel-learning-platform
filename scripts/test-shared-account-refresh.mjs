import assert from 'node:assert/strict'
import { ACCOUNT_REFRESH_RETRY_DELAY_MS, accountRefreshFailureState, accountRefreshRetryDelay } from '../src/lib/sharedAccount.js'

const ready = {
  status: 'ready',
  token: 'x'.repeat(64),
  identity: { id: 'ielts:42', username: 'student' },
  workspace: { classrooms: [] },
  error: '',
}

const degraded = accountRefreshFailureState(ready, {
  name: 'SharedAccountError',
  retryable: true,
  message: 'The STEM account service is temporarily unavailable.',
})
assert.equal(degraded.status, 'ready', 'a transient refresh failure must not sign out an active account')
assert.equal(degraded.token, ready.token, 'the current access token must remain usable during a refresh retry')
assert.equal(degraded.identity.id, ready.identity.id)
assert.equal(degraded.refreshState, 'degraded')

assert.equal(
  accountRefreshRetryDelay({ name: 'SharedAccountError', retryable: true }),
  ACCOUNT_REFRESH_RETRY_DELAY_MS,
  'a transient account refresh failure must schedule a prompt retry instead of waiting for the normal refresh interval',
)
assert.equal(
  accountRefreshRetryDelay({ name: 'AbortError' }),
  ACCOUNT_REFRESH_RETRY_DELAY_MS,
  'an aborted account status request must also recover promptly',
)

const expired = accountRefreshFailureState(ready, {
  name: 'SharedAccountError',
  loginRequired: true,
  retryable: false,
  message: 'Your STEM session has expired.',
})
assert.equal(expired.status, 'guest', 'an explicit session-expired response must clear the account')
assert.equal(expired.token, '')
assert.equal(accountRefreshRetryDelay(expired), 0, 'an explicit session expiry must not keep retrying a cleared session')

console.log('Shared account refresh contract passed.')
