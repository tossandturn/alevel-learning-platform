export const STEM_USER_PROFILE_PROTOCOL = 'stem-user-profile-v1'
export const STEM_USER_PROFILE_MAX_AVATAR_BYTES = 64 * 1024
export const STEM_USER_PROFILE_MAX_BODY_BYTES = 96 * 1024

const DISPLAY_NAME_MAX_CODEPOINTS = 32
const ALLOWED_PROFILE_KEYS = new Set(['displayName', 'avatarDataUrl'])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function profileError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode })
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}

export function ensureStemUserProfileSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS stem_user_profiles (
      owner_user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      avatar_data_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

export function normalizeStemDisplayName(value) {
  if (typeof value !== 'string') {
    throw profileError('profile_display_name_invalid', 'Display name must be text.')
  }
  // Reject controls before trimming so a newline or tab cannot be hidden at
  // either edge. Bidi controls are rejected explicitly without excluding the
  // emoji joiner used by legitimate Unicode names.
  if (/\p{Cc}|\p{Zl}|\p{Zp}|[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]|[\uD800-\uDFFF]/u.test(value)) {
    throw profileError('profile_display_name_invalid', 'Display name contains unsupported control characters.')
  }
  const displayName = value.trim().normalize('NFC')
  const codepointCount = [...displayName].length
  if (codepointCount < 1 || codepointCount > DISPLAY_NAME_MAX_CODEPOINTS) {
    throw profileError('profile_display_name_invalid', `Display name must contain 1 to ${DISPLAY_NAME_MAX_CODEPOINTS} Unicode characters.`)
  }
  return displayName
}

function pngHeader(bytes) {
  return bytes.length >= 24
    && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR'
    && bytes.readUInt32BE(16) > 0
    && bytes.readUInt32BE(20) > 0
}

function jpegHeader(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false
  const marker = bytes[3]
  if (marker === 0x00 || marker === 0xff) return false
  if (marker === 0xe0) return bytes.subarray(6, 11).toString('ascii') === 'JFIF\0'
  if (marker === 0xe1) return bytes.subarray(6, 10).toString('ascii') === 'Exif'
  return (marker >= 0xc0 && marker <= 0xcf) || marker === 0xdb
}

function webpHeader(bytes) {
  if (bytes.length < 16 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') return false
  const chunk = bytes.subarray(12, 16).toString('ascii')
  return ['VP8 ', 'VP8L', 'VP8X'].includes(chunk) && bytes.readUInt32LE(4) + 8 <= bytes.length
}

export function normalizeStemAvatarDataUrl(value) {
  if (value === '') return ''
  if (typeof value !== 'string') throw profileError('profile_avatar_invalid', 'Avatar must be an image data URL or an empty string.')
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/i)
  if (!match || match[2].length % 4 !== 0) {
    throw profileError('profile_avatar_invalid', 'Avatar must be a base64 PNG, JPEG or WebP data URL.')
  }
  const mime = match[1].toLowerCase()
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.toString('base64') !== match[2]) {
    throw profileError('profile_avatar_invalid', 'Avatar base64 data is invalid.')
  }
  if (bytes.length > STEM_USER_PROFILE_MAX_AVATAR_BYTES) {
    throw profileError('profile_avatar_too_large', 'Avatar must be no larger than 64 KiB.', 413)
  }
  const validHeader = mime === 'image/png'
    ? pngHeader(bytes)
    : mime === 'image/jpeg'
      ? jpegHeader(bytes)
      : webpHeader(bytes)
  if (!validHeader) throw profileError('profile_avatar_invalid', 'Avatar bytes do not match the declared image type.')
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function trustedIdentityAvatar(identity) {
  if (!identity?.avatarDataUrl) return ''
  try {
    return normalizeStemAvatarDataUrl(identity.avatarDataUrl)
  } catch {
    return ''
  }
}

function safeStoredDisplayName(value) {
  try {
    return normalizeStemDisplayName(value)
  } catch {
    return ''
  }
}

function safeStoredAvatar(value) {
  if (!value) return ''
  try {
    return normalizeStemAvatarDataUrl(value)
  } catch {
    return ''
  }
}

function storedProfile(database, ownerId) {
  return database.prepare(`
    SELECT owner_user_id, display_name, avatar_data_url, updated_at
    FROM stem_user_profiles
    WHERE owner_user_id = ?
  `).get(ownerId)
}

export function stemUserProfile(database, identity) {
  const ownerId = String(identity?.id || '')
  if (!ownerId) throw profileError('profile_identity_invalid', 'A verified profile owner is required.', 401)
  const row = storedProfile(database, ownerId)
  const storedAvatar = safeStoredAvatar(row?.avatar_data_url)
  return {
    protocol: STEM_USER_PROFILE_PROTOCOL,
    profile: {
      ownerId,
      displayName: safeStoredDisplayName(row?.display_name),
      avatarDataUrl: storedAvatar || trustedIdentityAvatar(identity),
      updatedAt: row?.updated_at || null,
    },
  }
}

export function saveStemUserProfile(database, identity, payload, updatedAt = new Date().toISOString()) {
  if (!isPlainObject(payload) || Object.keys(payload).length !== ALLOWED_PROFILE_KEYS.size || Object.keys(payload).some((key) => !ALLOWED_PROFILE_KEYS.has(key))) {
    throw profileError('profile_payload_invalid', 'Profile updates require exactly displayName and avatarDataUrl.')
  }
  const ownerId = String(identity?.id || '')
  if (!ownerId) throw profileError('profile_identity_invalid', 'A verified profile owner is required.', 401)
  const displayName = normalizeStemDisplayName(payload.displayName)
  const avatarDataUrl = normalizeStemAvatarDataUrl(payload.avatarDataUrl)
  database.prepare(`
    INSERT INTO stem_user_profiles (owner_user_id, display_name, avatar_data_url, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      avatar_data_url = excluded.avatar_data_url,
      updated_at = excluded.updated_at
  `).run(ownerId, displayName, avatarDataUrl, updatedAt)
  return stemUserProfile(database, identity)
}

export function enrichStemIdentity(database, identity) {
  const { profile } = stemUserProfile(database, identity)
  return {
    ...identity,
    displayName: profile.displayName,
    avatarDataUrl: profile.avatarDataUrl,
  }
}
