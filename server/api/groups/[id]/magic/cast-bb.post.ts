/**
 * POST /api/groups/:id/magic/cast-bb — Battlebuben-Magie wirken.
 *
 * Mechanik (abweichend vom HtbaH-Komplexitaetswurf in cast.post.ts):
 *  1. Magie-Probe: W100 ≤ (Magie-Fertigkeitswert − Schwierigkeit). Der Skill
 *     wird ueber die Stil→Skill-Bindung (magicState.bbStilSkills) gewaehlt.
 *  2. Arkanum-Pool wird immer um die Spruchkosten reduziert (auch bei
 *     Fehlschlag — wie der Komplexitaetswurf Mana zieht).
 *  3. Bei Erfolg wird der Effekt mit der erreichten QS skaliert (server-
 *     seitig gewuerfelt, transparent im Chat aufgeschluesselt).
 *  4. Ab Level 3 verursacht ein Fehlschlag 1W8 Schaden am Wirker (direkt auf
 *     hp.current angerechnet).
 *
 * Schreibt Arkanum-Pool (+ ggf. Selbstschaden) in den Character-Datensatz und
 * postet eine Roll-Message in den Gruppen-Chat.
 *
 * Body: { characterId, spellKey }
 */
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { useDb } from '~~/server/utils/db'
import { requireGroupMember } from '~~/server/utils/group-access'
import { characters, messages, type RollPayload } from '~~/server/database/schema'
import {
  htbahRollProbe,
  htbahSkillTotal,
  htbahQualityLabel,
  type HtbahCharacterData,
} from '~~/shared/engines/htbah'
import {
  BATTLEBUBEN_SPELL_BY_KEY,
  BATTLEBUBEN_STIL_LABELS,
  battlebubenSpellMeta,
  rollBattlebubenEffect,
  type BattlebubenEffectPart,
} from '~~/shared/battlebuben-magic'
import { pushGroupChanged } from '~~/server/utils/pusher'

const bodySchema = z.object({
  characterId: z.number().int().positive(),
  spellKey: z.string().min(1).max(80),
})

function rand1to100(): number {
  return Math.floor(Math.random() * 100) + 1
}
function rand1to8(): number {
  return Math.floor(Math.random() * 8) + 1
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const groupId = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(groupId)) {
    throw createError({ statusCode: 400, statusMessage: 'Ungültige Gruppen-ID.' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)
  const db = useDb()
  await requireGroupMember(db, groupId, user.id)

  const [char] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, body.characterId))
    .limit(1)
  if (!char) {
    throw createError({ statusCode: 404, statusMessage: 'Charakter nicht gefunden.' })
  }
  if (char.userId !== user.id) {
    throw createError({ statusCode: 403, statusMessage: 'Nicht dein Charakter.' })
  }
  if (char.system !== 'htbah') {
    throw createError({ statusCode: 400, statusMessage: 'Battlebuben-Magie nur fuer HtbaH.' })
  }
  const data = char.data as unknown as HtbahCharacterData
  if (!data.magicState?.active || data.magicState.module !== 'battlebuben') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Battlebuben-Magie-Modul ist nicht aktiv (im Bogen aktivieren).',
    })
  }

  const spell = BATTLEBUBEN_SPELL_BY_KEY[body.spellKey]
  if (!spell) {
    throw createError({ statusCode: 404, statusMessage: 'Zauber nicht im Katalog gefunden.' })
  }
  const meta = battlebubenSpellMeta(spell)
  const stilLabel = BATTLEBUBEN_STIL_LABELS[spell.stil] ?? spell.stil

  // Arkanum-Pool pruefen.
  const arkanumBefore = Math.max(0, Math.floor(data.magicState.bbArkanumCurrent ?? 0))
  if (arkanumBefore < meta.arkanum) {
    throw createError({
      statusCode: 400,
      statusMessage: `Nicht genug Arkanum: ${arkanumBefore} (benötigt ${meta.arkanum}).`,
    })
  }

  // Stil → Skill-Bindung aufloesen.
  const skillId = data.magicState.bbStilSkills?.[spell.stil]
  const skill = skillId ? data.skills.find((sk) => sk.id === skillId) : undefined
  if (!skill) {
    throw createError({
      statusCode: 400,
      statusMessage: `Kein Skill fuer Stil "${stilLabel}" gebunden. Im Bogen einen Skill zuweisen.`,
    })
  }

  // Probe: W100 ≤ (Fertigkeitswert − Schwierigkeit), Battlebuben-Ruleset.
  const baseTarget = htbahSkillTotal(data, skill)
  const target = baseTarget - meta.schwierigkeit
  const roll = rand1to100()
  const probe = htbahRollProbe({ roll, target, ruleset: 'battlebuben' })
  const qs = probe.qualityStep ?? 0

  // Arkanum abziehen (immer beim Wirken).
  const arkanumAfter = Math.max(0, arkanumBefore - meta.arkanum)

  // Effekt bei Erfolg, QS-skaliert.
  const effectParts: BattlebubenEffectPart[] = probe.success
    ? rollBattlebubenEffect(spell, qs)
    : []

  // Fehlschlag-Selbstschaden ab Level 3 (1W8).
  let selfDamage = 0
  if (!probe.success && meta.fehlschlag) {
    selfDamage = rand1to8()
  }
  const hpBefore = data.hp.current
  const hpAfter = selfDamage > 0 ? Math.max(0, hpBefore - selfDamage) : hpBefore

  // Persistenz: Arkanum-Pool + ggf. LP.
  const updatedData: HtbahCharacterData = {
    ...data,
    hp: { ...data.hp, current: hpAfter },
    magicState: { ...data.magicState, bbArkanumCurrent: arkanumAfter },
  }
  await db
    .update(characters)
    .set({ data: updatedData as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(eq(characters.id, char.id))

  // Chat-Aufschluesselung.
  const outcomeLabel = probe.fumble
    ? '💥 Kritischer Patzer'
    : probe.critical
      ? '⚡ Kritischer Erfolg'
      : probe.success
        ? '✓ Erfolg'
        : '✗ Misserfolg'
  const qsLabel = probe.success ? htbahQualityLabel(qs, 'battlebuben') : '—'
  const noteLines: string[] = [
    outcomeLabel,
    `${stilLabel} · Level ${spell.level} · Probe ${roll} vs ${target} (FW ${baseTarget} − Schw. ${meta.schwierigkeit})`,
    `Arkanum −${meta.arkanum} → ${arkanumAfter}/${data.magicState.bbArkanumMax ?? 0}`,
  ]
  if (probe.success && effectParts.length) {
    noteLines.push(effectParts.map((p) => `${p.label}: ${p.value} (${p.detail})`).join(' · '))
  }
  if (spell.extra) noteLines.push(spell.extra)
  if (selfDamage > 0) {
    noteLines.push(`Fehlschlag-Schaden 1W8 = ${selfDamage} → LP ${hpBefore} → ${hpAfter}`)
  }

  const payload: RollPayload = {
    system: 'htbah',
    label: `Zauber: ${spell.name} (${stilLabel}, Lvl ${spell.level})`,
    characterId: char.id,
    characterName: char.name,
    target,
    modifier: meta.schwierigkeit ? -meta.schwierigkeit : undefined,
    dice: [roll],
    success: probe.success,
    critical: probe.critical || undefined,
    fumble: probe.fumble || undefined,
    qualityStep: probe.qualityStep,
    ruleset: 'battlebuben',
    note: noteLines.join(' · '),
  }
  await db.insert(messages).values({
    groupId,
    userId: user.id,
    type: 'roll',
    content: `Zauber ${spell.name}: W100 ${roll} vs ${target} — ${probe.success ? `Erfolg (${qsLabel})` : 'Misserfolg'}`,
    payload,
  })

  await pushGroupChanged(groupId, 'magic-cast')
  return {
    success: probe.success,
    critical: probe.critical,
    fumble: probe.fumble,
    qs: probe.qualityStep ?? null,
    qsLabel,
    roll,
    target,
    effectParts,
    selfDamage,
    arkanum: arkanumAfter,
    arkanumMax: data.magicState.bbArkanumMax ?? 0,
    hp: hpAfter,
  }
})
