import fs from 'node:fs'

import { MAX_CONFIG_BYTES } from './schema.mjs'
import {
  expectedCurrentValue,
  isMain,
  loadIconAllowlist,
  parseLongArguments,
  regularInputFile,
  runCli,
} from './cli.mjs'
import { publishConfig } from './store.mjs'

export function runPublish(argv = process.argv.slice(2)) {
  const args = parseLongArguments(argv, {
    required: ['store', 'channel', 'expected-current', 'icon-allowlist', 'input'],
  })
  const input = regularInputFile(args.input, { maxBytes: MAX_CONFIG_BYTES })
  return publishConfig({
    storeRoot: args.store,
    channel: args.channel,
    expectedCurrent: expectedCurrentValue(args['expected-current']),
    bytes: fs.readFileSync(input),
    iconAllowlist: loadIconAllowlist(args['icon-allowlist']),
  })
}

if (isMain(import.meta.url)) await runCli(() => runPublish())
