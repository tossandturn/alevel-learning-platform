import crypto from 'node:crypto'
import net from 'node:net'

export function isFetchSafePort(port) {
  return Number.isInteger(port) && port >= 49152 && port <= 65535
}

export async function freeFetchPort() {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const port = crypto.randomInt(49152, 65536)
    try {
      await new Promise((resolve, reject) => {
        const probe = net.createServer()
        probe.once('error', reject)
        probe.listen(port, '127.0.0.1', () => probe.close((error) => error ? reject(error) : resolve()))
      })
      return port
    } catch (error) {
      if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error
    }
  }
  throw new Error('Unable to reserve a fetch-safe local test port')
}
