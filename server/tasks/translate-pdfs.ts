/**
 * Nitro-Task: PDFs in der Bibliothek ins Deutsche uebersetzen.
 *
 * Aufruf:
 *   npx nuxi dev
 *   npx nuxi task run translate-pdfs
 *
 * Optional Payload (im Devtools-UI oder via run-Aufruf):
 *   { onlySlug?: string, force?: boolean, pageLimit?: number, model?: string }
 */
import { translateLibrary } from '../utils/translate-pdf'

export default defineTask({
  meta: {
    name: 'translate-pdfs',
    description: 'Uebersetzt englische Bibliotheks-PDFs ins Deutsche (Claude).',
  },
  async run({ payload }) {
    const opts = (payload ?? {}) as {
      onlySlug?: string
      force?: boolean
      pageLimit?: number
      model?: string
    }
    const result = await translateLibrary({
      onlySlug: opts.onlySlug,
      force: opts.force,
      pageLimit: opts.pageLimit,
      model: opts.model,
      log: (m) => console.log(`[translate-pdfs] ${m}`),
    })
    return { result }
  },
})
