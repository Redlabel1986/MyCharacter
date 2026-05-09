import type { GameSystem } from '~~/shared/systems'
import { buildHtbahPdf } from './htbah'

export interface PdfBuildInput {
  name: string
  system: GameSystem
  data: Record<string, unknown>
}

/**
 * Erzeugt ein ausfuellbares PDF fuer einen Charakterbogen. Aktuell nur HtbaH;
 * andere Systeme folgen in eigenen Modulen (server/utils/pdf/{dnd,dsa5,dsa41}.ts).
 */
export async function buildSheetPdf(input: PdfBuildInput): Promise<Uint8Array> {
  switch (input.system) {
    case 'htbah':
      return buildHtbahPdf({
        name: input.name,
        system: input.system,
        data: input.data as unknown as Parameters<typeof buildHtbahPdf>[0]['data'],
      })
    case 'dnd5e':
    case 'dnd2024':
    case 'dsa5':
    case 'dsa41':
      throw createError({
        statusCode: 501,
        statusMessage: `PDF-Export fuer ${input.system} ist noch nicht implementiert.`,
      })
  }
}
