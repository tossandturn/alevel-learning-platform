const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const PNG_SOURCE_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 40_000_000,
})

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

const VALID_BIT_DEPTHS = Object.freeze({
  0: Object.freeze([1, 2, 4, 8, 16]),
  2: Object.freeze([8, 16]),
  3: Object.freeze([1, 2, 4, 8]),
  4: Object.freeze([8, 16]),
  6: Object.freeze([8, 16]),
})

function invalidPng(reason) {
  return Object.assign(new Error(`PNG source is invalid: ${reason}`), { code: 'png_source_invalid' })
}

function sourceBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  throw invalidPng('bytes are required')
}

function chunkCrc32(bytes, start, end) {
  let crc = 0xffffffff
  for (let offset = start; offset < end; offset += 1) crc = CRC_TABLE[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function validChunkType(bytes, offset) {
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index]
    if (!((value >= 65 && value <= 90) || (value >= 97 && value <= 122))) return false
  }
  return (bytes[offset + 2] & 0x20) === 0
}

function expectedInteger(value, label) {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || value < 1) throw invalidPng(`${label} expectation is invalid`)
  return value
}

export function inspectPngSource(value, { expectedBytes, expectedWidth, expectedHeight } = {}) {
  const bytes = sourceBuffer(value)
  const declaredBytes = expectedInteger(expectedBytes, 'byte length')
  const declaredWidth = expectedInteger(expectedWidth, 'width')
  const declaredHeight = expectedInteger(expectedHeight, 'height')
  if (bytes.length < 8 || bytes.length > PNG_SOURCE_LIMITS.maxBytes) throw invalidPng('byte length is outside the allowed range')
  if (declaredBytes !== null && bytes.length !== declaredBytes) throw invalidPng('byte length does not match the release metadata')
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw invalidPng('signature mismatch')

  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  let sawHeader = false
  let sawPalette = false
  let sawImageData = false
  let imageDataClosed = false
  let imageDataBytes = 0
  let sawEnd = false

  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw invalidPng('truncated chunk framing')
    const length = bytes.readUInt32BE(offset)
    const typeOffset = offset + 4
    const dataOffset = offset + 8
    const dataEnd = dataOffset + length
    const crcOffset = dataEnd
    const chunkEnd = crcOffset + 4
    if (chunkEnd > bytes.length) throw invalidPng('truncated chunk payload')
    if (!validChunkType(bytes, typeOffset)) throw invalidPng('chunk type is invalid')
    const type = bytes.toString('ascii', typeOffset, typeOffset + 4)
    const expectedCrc = bytes.readUInt32BE(crcOffset)
    const actualCrc = chunkCrc32(bytes, typeOffset, dataEnd)
    if (actualCrc !== expectedCrc) throw invalidPng(`${type} CRC mismatch`)
    if (!sawHeader && type !== 'IHDR') throw invalidPng('IHDR must be the first chunk')

    if (type === 'IHDR') {
      if (sawHeader || offset !== 8 || length !== 13) throw invalidPng('IHDR is duplicated or malformed')
      width = bytes.readUInt32BE(dataOffset)
      height = bytes.readUInt32BE(dataOffset + 4)
      const bitDepth = bytes[dataOffset + 8]
      colorType = bytes[dataOffset + 9]
      const compression = bytes[dataOffset + 10]
      const filter = bytes[dataOffset + 11]
      const interlace = bytes[dataOffset + 12]
      const allowedDepths = VALID_BIT_DEPTHS[colorType]
      if (!width || !height || width > PNG_SOURCE_LIMITS.maxWidth || height > PNG_SOURCE_LIMITS.maxHeight || width * height > PNG_SOURCE_LIMITS.maxPixels) {
        throw invalidPng('geometry exceeds the allowed dimensions or pixel count')
      }
      if (!allowedDepths?.includes(bitDepth) || compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) throw invalidPng('IHDR encoding fields are invalid')
      sawHeader = true
    } else if (type === 'PLTE') {
      if (sawPalette || sawImageData || [0, 4].includes(colorType) || length < 3 || length > 768 || length % 3 !== 0) throw invalidPng('PLTE is misplaced or malformed')
      sawPalette = true
    } else if (type === 'IDAT') {
      if (imageDataClosed) throw invalidPng('IDAT chunks must be consecutive')
      if (colorType === 3 && !sawPalette) throw invalidPng('indexed PNG is missing PLTE before IDAT')
      sawImageData = true
      imageDataBytes += length
    } else if (type === 'IEND') {
      if (sawEnd || length !== 0 || !sawImageData || imageDataBytes === 0) throw invalidPng('IEND is misplaced or IDAT is missing')
      sawEnd = true
      if (chunkEnd !== bytes.length) throw invalidPng('bytes follow IEND')
    } else {
      if ((bytes[typeOffset] & 0x20) === 0) throw invalidPng(`unknown critical chunk ${type}`)
    }

    if (sawImageData && type !== 'IDAT') imageDataClosed = true
    offset = chunkEnd
    if (sawEnd) break
  }

  if (!sawHeader) throw invalidPng('IHDR is missing')
  if (!sawImageData || imageDataBytes === 0) throw invalidPng('IDAT is missing')
  if (!sawEnd) throw invalidPng('IEND is missing')
  if (declaredWidth !== null && width !== declaredWidth) throw invalidPng('width does not match the release geometry')
  if (declaredHeight !== null && height !== declaredHeight) throw invalidPng('height does not match the release geometry')
  return Object.freeze({ bytes: bytes.length, width, height })
}
