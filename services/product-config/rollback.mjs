import {
  expectedCurrentValue,
  isMain,
  loadIconAllowlist,
  parseLongArguments,
  runCli,
} from './cli.mjs'
import { rollbackConfig } from './store.mjs'

export function runRollback(argv = process.argv.slice(2)) {
  const args = parseLongArguments(argv, {
    required: ['store', 'channel', 'expected-current', 'revision', 'icon-allowlist'],
  })
  return rollbackConfig({
    storeRoot: args.store,
    channel: args.channel,
    expectedCurrent: expectedCurrentValue(args['expected-current']),
    revision: args.revision,
    iconAllowlist: loadIconAllowlist(args['icon-allowlist']),
  })
}

if (isMain(import.meta.url)) await runCli(() => runRollback())
