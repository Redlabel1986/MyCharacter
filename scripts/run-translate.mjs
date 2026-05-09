// Standalone-Runner fuer translateLibrary, der via jiti die TS-Quelle laedt.
// Aufruf:
//   node --env-file=.env scripts/run-translate.mjs <slug?> <pageLimit?> <model?>
import { createJiti } from 'jiti'
import { resolve } from 'node:path'

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { '~~': process.cwd() },
})

const mod = await jiti.import(resolve(process.cwd(), 'server/utils/translate-pdf.ts'))

const [, , slug, pageLimitArg, model] = process.argv
const pageLimit = pageLimitArg ? Number(pageLimitArg) : undefined

console.log(`[runner] start: slug=${slug ?? '(alle)'} pageLimit=${pageLimit ?? '(alle)'} model=${model ?? '(default)'}`)

const result = await mod.translateLibrary({
  onlySlug: slug || undefined,
  pageLimit,
  model,
  log: (m) => console.log(`[translate] ${m}`),
})

console.log('[runner] DONE')
console.log(JSON.stringify(result, null, 2))
