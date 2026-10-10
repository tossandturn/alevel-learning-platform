export class ProductConfigError extends Error {
  constructor(code, message, { statusCode = 400, details = undefined } = {}) {
    super(message)
    this.name = 'ProductConfigError'
    this.code = code
    this.statusCode = statusCode
    if (details !== undefined) this.details = details
  }
}

export function productConfigError(code, message, options) {
  return new ProductConfigError(code, message, options)
}

export function publicError(error) {
  if (error instanceof ProductConfigError) {
    return {
      statusCode: error.statusCode,
      body: { schemaVersion: ERROR_SCHEMA_VERSION, ok: false, code: error.code, error: error.message },
    }
  }
  return {
    statusCode: 500,
    body: {
      schemaVersion: ERROR_SCHEMA_VERSION,
      ok: false,
      code: 'internal_error',
      error: 'Product configuration service failed safely.',
    },
  }
}
export const ERROR_SCHEMA_VERSION = 'stemist-product-config-error-v1'
