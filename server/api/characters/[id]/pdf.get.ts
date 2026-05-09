import { useDb } from '~~/server/utils/db'
import { loadAccessibleCharacter } from '~~/server/utils/character-access'
import { buildSheetPdf } from '~~/server/utils/pdf'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige ID.' })
  }
  const db = useDb()
  const char = await loadAccessibleCharacter(db, id, user)
  if (!char) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }

  const pdfBytes = await buildSheetPdf({
    name: char.name,
    system: char.system,
    data: char.data as Record<string, unknown>,
  })

  const safeName = char.name.replace(/[^\w\-äöüÄÖÜß ]+/g, '_').slice(0, 60) || 'charakter'
  const filename = `${safeName}.pdf`

  setHeader(event, 'content-type', 'application/pdf')
  setHeader(event, 'content-disposition', `attachment; filename="${filename}"`)
  setHeader(event, 'cache-control', 'private, no-store')

  return Buffer.from(pdfBytes)
})
