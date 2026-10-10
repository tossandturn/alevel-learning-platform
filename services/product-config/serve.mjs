import {
  isMain,
  loadIconAllowlist,
  parseLongArguments,
} from './cli.mjs'
import { productConfigError, publicError } from './errors.mjs'
import { createProductConfigServer } from './server.mjs'

export function parseServeArguments(argv = process.argv.slice(2)) {
  const args = parseLongArguments(argv, {
    required: ['store', 'icon-allowlist', 'port'],
    optional: ['host'],
  })
  const host = args.host || '127.0.0.1'
  if (!['127.0.0.1', '::1'].includes(host)) {
    throw productConfigError('host_not_loopback', 'Product configuration service must bind to loopback.', { statusCode: 400 })
  }
  if (!/^\d+$/u.test(args.port)) throw productConfigError('port_invalid', 'Service port is invalid.', { statusCode: 400 })
  const port = Number(args.port)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw productConfigError('port_invalid', 'Service port is invalid.', { statusCode: 400 })
  }
  return { storeRoot: args.store, iconAllowlistPath: args['icon-allowlist'], host, port }
}

export async function runServer(argv = process.argv.slice(2)) {
  const args = parseServeArguments(argv)
  const server = createProductConfigServer({
    storeRoot: args.storeRoot,
    iconAllowlist: loadIconAllowlist(args.iconAllowlistPath),
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(args.port, args.host, resolve)
  })
  const address = server.address()
  process.stdout.write(`${JSON.stringify({
    status: 'LISTENING',
    service: 'stemist-product-config',
    host: args.host,
    port: address.port,
  })}\n`)
  const close = () => server.close(() => process.exit(0))
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
  return server
}

if (isMain(import.meta.url)) {
  try {
    await runServer()
  } catch (error) {
    const failure = publicError(error)
    process.stderr.write(`${JSON.stringify(failure.body)}\n`)
    process.exitCode = 1
  }
}
