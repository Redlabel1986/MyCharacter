<script setup lang="ts">
/**
 * Mini-Charakterbogen direkt in der Battle-Map.
 *
 * Akzeptiert eine LISTE von Tokens, die dem aktuellen User gehoeren.
 * Bei mehreren Tokens (z.B. der DM mit NPCs / Monstern) erscheinen Tabs zum
 * Wechseln. Pro Token wird gezeigt:
 *   - Charakter-gebunden (HtbaH / D&D 5e+2024 / DSA 5): Portrait, HP-Editor
 *     (sync zum Token), regelwerk-spezifischer Würfler (Skills, Saves,
 *     Eigenschafts-/Talent-/Zauber-Proben), Inventar
 *   - NPC ohne Charakter: HP-Editor + ggf. Beschreibungstext
 */
import {
  HTBAH_TALENTS,
  HTBAH_TALENT_LABELS,
  htbahSkillTotal,
  htbahTalentValue,
  htbahTotalArmor,
  normalizeHtbahPurse,
  type HtbahCharacterData,
  type HtbahSkill,
  type HtbahTalent,
  type HtbahWeaponEntry,
} from '~~/shared/engines/htbah'
import {
  DND_ABILITIES,
  DND_SKILLS,
  abilityModifier,
  saveBonus,
  skillBonus,
  type DnDAbility,
  type DnDCharacterData,
} from '~~/shared/engines/dnd'
import {
  DSA_ABILITIES,
  DSA_ABILITY_LABELS,
  type Dsa5CharacterData,
  type DsaAbility,
} from '~~/shared/engines/dsa5'
import type { GameSystem } from '~~/shared/systems'
import type { NpcAbility } from '~~/shared/npc'
import { timeBonusFor, isDayTime, type TimeOfDay } from '~~/shared/time-of-day'
import { computeDamageLevel, damageLevelColor } from '~~/shared/damage-level'

interface Token {
  id: number
  ownerUserId: number
  characterId: number | null
  name: string
  imageUrl: string | null
  hp: number | null
  hpMax: number | null
  description: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
}

interface CharacterFull {
  id: number
  system: GameSystem
  name: string
  portraitUrl: string | null
  data: Record<string, unknown>
}

const props = defineProps<{
  groupId: number
  mapId: number
  tokens: Token[]
  /**
   * Alle (sichtbaren) Tokens auf der Karte — fuer das Ziel-Dropdown beim
   * Schadens-/Heilungswurf. Wird vom Battle-Map-Page mit `tokens` der Karte
   * versorgt. Wenn nicht gesetzt, faellt das Dropdown auf die eigenen Tokens
   * zurueck.
   */
  allTokens?: Token[]
  timeOfDay?: TimeOfDay
}>()

const emit = defineEmits<{
  (e: 'token-updated'): void
}>()

// Welcher Token ist gerade ausgewaehlt?
const selectedTokenId = ref<number | null>(null)
watch(
  () => props.tokens,
  (toks) => {
    if (!toks.length) {
      selectedTokenId.value = null
      return
    }
    // Wenn aktuell ausgewaehlter weg ist → ersten nehmen.
    if (
      selectedTokenId.value === null ||
      !toks.some((t) => t.id === selectedTokenId.value)
    ) {
      const withChar = toks.find((t) => t.characterId !== null)
      selectedTokenId.value = (withChar ?? toks[0]!).id
    }
  },
  { immediate: true, deep: true },
)

const activeToken = computed<Token | null>(() =>
  props.tokens.find((t) => t.id === selectedTokenId.value) ?? null,
)

// Charakter laden, wenn das aktive Token einen hat
const character = ref<CharacterFull | null>(null)
const characterLoading = ref(false)
const characterError = ref<string | null>(null)
const cacheByCharId = new Map<number, CharacterFull>()

const fetchChar = async (id: number) => {
  if (cacheByCharId.has(id)) {
    character.value = cacheByCharId.get(id)!
    return
  }
  characterLoading.value = true
  characterError.value = null
  try {
    const res = await $fetch<{ character: CharacterFull }>(`/api/characters/${id}`)
    character.value = res.character
    cacheByCharId.set(id, res.character)
  } catch (e: unknown) {
    characterError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Charakter nicht ladbar.'
    character.value = null
  } finally {
    characterLoading.value = false
  }
}

watch(
  () => activeToken.value?.characterId ?? null,
  (id) => {
    if (id) fetchChar(id)
    else {
      character.value = null
      characterError.value = null
    }
  },
  { immediate: true },
)

const isHtbah = computed(() => character.value?.system === 'htbah')
const isDnd = computed(
  () => character.value?.system === 'dnd5e' || character.value?.system === 'dnd2024',
)
const isDsa5 = computed(() => character.value?.system === 'dsa5')

const htbahData = computed<HtbahCharacterData | null>(() =>
  isHtbah.value && character.value ? (character.value.data as HtbahCharacterData) : null,
)
const dndData = computed<DnDCharacterData | null>(() =>
  isDnd.value && character.value ? (character.value.data as DnDCharacterData) : null,
)
const dsa5Data = computed<Dsa5CharacterData | null>(() =>
  isDsa5.value && character.value ? (character.value.data as Dsa5CharacterData) : null,
)

// — HP-Editor: liest vom aktiven Token, ueberschreibt Eingaben aber NICHT
// bei jedem 2s-Poll. Wir tracken den letzten Server-Stand pro Token; nur
// wenn der Draft genau diesem alten Server-Stand entsprach (also der User
// nichts getippt hat), uebernehmen wir den neuen Server-Wert.
const hpDraft = ref<number | null>(null)
const hpMaxDraft = ref<number | null>(null)
let lastServerHp: number | null = null
let lastServerHpMax: number | null = null

// Tab-Wechsel: harte Sync — neuer Token, neuer Stand.
watch(
  selectedTokenId,
  () => {
    const t = activeToken.value
    hpDraft.value = t?.hp ?? null
    hpMaxDraft.value = t?.hpMax ?? null
    lastServerHp = t?.hp ?? null
    lastServerHpMax = t?.hpMax ?? null
  },
  { immediate: true },
)

// Server-Update bei selbem Token (z.B. anderer Spieler heilt mich) —
// nur uebernehmen, wenn der User nichts getippt hat.
watch(
  () => [activeToken.value?.hp ?? null, activeToken.value?.hpMax ?? null] as const,
  ([hp, hpMax]) => {
    if (hpDraft.value === lastServerHp) hpDraft.value = hp
    if (hpMaxDraft.value === lastServerHpMax) hpMaxDraft.value = hpMax
    lastServerHp = hp
    lastServerHpMax = hpMax
  },
)
const hpDirty = computed(
  () =>
    hpDraft.value !== (activeToken.value?.hp ?? null) ||
    hpMaxDraft.value !== (activeToken.value?.hpMax ?? null),
)
const hpSaving = ref(false)
const hpDelta = ref<number>(0)
const applyHpDelta = (sign: 1 | -1) => {
  if (hpDraft.value === null) return
  const change = sign * Math.abs(hpDelta.value || 0)
  hpDraft.value = Math.max(0, hpDraft.value + change)
  hpDelta.value = 0
  saveHp()
}
const saveHp = async () => {
  const t = activeToken.value
  if (!t) return
  hpSaving.value = true
  try {
    await $fetch(
      `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${t.id}`,
      {
        method: 'PUT',
        body: { hp: hpDraft.value, hpMax: hpMaxDraft.value },
      },
    )
    emit('token-updated')
  } catch (err) {
    console.error('HP-Update fehlgeschlagen', err)
  } finally {
    hpSaving.value = false
  }
}

// System-spezifische Wurf-Optionen.
type RollKind =
  | 'htbahSkill'
  | 'htbahTalent'
  | 'dndSkill'
  | 'dndSave'
  | 'dndAbility'
  | 'dsa5Skill'
  | 'dsa5Ability'
  | 'npcHtbah'
  | 'npcDnd'
  | 'npcDsa5'

interface RollTarget {
  kind: RollKind
  id: string
  label: string
  value: number | string
  source?: 'skill' | 'spell' | 'liturgy'
}

// NPC-Roller (Token ohne Charakter, mit eigenem Stat-Block)
const isNpcRoller = computed(() => {
  const t = activeToken.value
  return !!t && t.characterId === null && !!t.system && (t.npcAbilities?.length ?? 0) > 0
})
const isNpcDnd = computed(() => isNpcRoller.value && activeToken.value?.system === 'dnd')

const rollOptions = computed<RollTarget[]>(() => {
  if (htbahData.value) {
    const data = htbahData.value
    const items: RollTarget[] = []
    for (const t of HTBAH_TALENTS) {
      items.push({
        kind: 'htbahTalent',
        id: t,
        label: `${HTBAH_TALENT_LABELS[t]} (Begabung)`,
        value: htbahTalentValue(data, t),
      })
    }
    for (const s of data.skills) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'htbahSkill',
        id: s.id,
        label: `${s.name} — ${HTBAH_TALENT_LABELS[s.talent]}`,
        value: htbahSkillTotal(data, s),
      })
    }
    return items
  }
  if (dndData.value) {
    const data = dndData.value
    const items: RollTarget[] = []
    for (const a of DND_ABILITIES) {
      const m = abilityModifier(data.abilities[a].score)
      items.push({
        kind: 'dndAbility',
        id: a,
        label: `${a}-Probe`,
        value: m >= 0 ? `+${m}` : `${m}`,
      })
    }
    for (const a of DND_ABILITIES) {
      const m = saveBonus(data, a)
      items.push({
        kind: 'dndSave',
        id: a,
        label: `${a}-Rettungswurf`,
        value: m >= 0 ? `+${m}` : `${m}`,
      })
    }
    for (const s of DND_SKILLS) {
      const m = skillBonus(data, s.key).value
      items.push({
        kind: 'dndSkill',
        id: s.key,
        label: `${s.label} (${s.ability})`,
        value: m >= 0 ? `+${m}` : `${m}`,
      })
    }
    return items
  }
  if (dsa5Data.value) {
    const data = dsa5Data.value
    const items: RollTarget[] = []
    for (const a of DSA_ABILITIES) {
      items.push({
        kind: 'dsa5Ability',
        id: a,
        label: `${DSA_ABILITY_LABELS[a]} (Eigenschaft)`,
        value: data.abilities[a],
      })
    }
    for (const s of data.skills) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'dsa5Skill',
        id: s.id,
        source: 'skill',
        label: `${s.name} (${s.probe.join('/')})`,
        value: `FW ${s.fw ?? 0}`,
      })
    }
    for (const s of data.spells) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'dsa5Skill',
        id: s.id,
        source: 'spell',
        label: `Zauber: ${s.name} (${s.probe.join('/')})`,
        value: `ZfW ${s.zfw ?? 0}`,
      })
    }
    for (const s of data.liturgies) {
      if (!s.name?.trim()) continue
      items.push({
        kind: 'dsa5Skill',
        id: s.id,
        source: 'liturgy',
        label: `Liturgie: ${s.name} (${s.probe.join('/')})`,
        value: `LkW ${s.lkw ?? 0}`,
      })
    }
    return items
  }
  // NPC: Stat-Block aus dem Token, wenn kein Charakter gekoppelt ist.
  if (isNpcRoller.value && activeToken.value) {
    const items: RollTarget[] = []
    for (const a of activeToken.value.npcAbilities) {
      if (a.system === 'htbah') {
        items.push({ kind: 'npcHtbah', id: a.id, label: a.label || '(unbenannt)', value: a.value })
      } else if (a.system === 'dnd') {
        items.push({
          kind: 'npcDnd',
          id: a.id,
          label: a.label || '(unbenannt)',
          value: a.mod >= 0 ? `+${a.mod}` : `${a.mod}`,
        })
      } else {
        items.push({
          kind: 'npcDsa5',
          id: a.id,
          label: `${a.label || '(unbenannt)'} (${a.probe.join('/')})`,
          value: `FW ${a.fw}`,
        })
      }
    }
    return items
  }
  return []
})

const pickedRollId = ref<string>('')
const rollMod = ref<number>(0)
const rollNote = ref<string>('')
const rollDc = ref<number | null>(null)
const rollMode = ref<'normal' | 'advantage' | 'disadvantage'>('normal')

// Auswahl NUR beim echten Tab-Wechsel zuruecksetzen, nicht bei jedem 2s-Poll
// (sonst verliert der Spieler mitten im Wurf seine ausgewaehlte Probe).
watch(selectedTokenId, () => {
  pickedRollId.value = ''
  rollMod.value = 0
  rollNote.value = ''
  rollDc.value = null
  rollMode.value = 'normal'
  damageFormula.value = ''
  damageLabel.value = 'Schaden'
})

// --- Waffen-Auswahl (nur HtbaH-Charaktere mit gepflegten Waffen) ---
const characterWeapons = computed<HtbahWeaponEntry[]>(() => {
  if (!htbahData.value) return []
  return (htbahData.value.weapons ?? []).filter(
    (w: HtbahWeaponEntry) => w.name?.trim() || w.damageFormula?.trim(),
  )
})
const weaponOptions = computed(() => [
  { label: '— Waffe waehlen —', value: '' },
  ...characterWeapons.value.map((w: HtbahWeaponEntry) => ({
    label: `${w.name} (${w.damageFormula})`,
    value: w.id,
  })),
])
const selectedWeaponId = ref<string>('')
// Wenn der Spieler eine Waffe waehlt, Formel + Label uebernehmen.
watch(selectedWeaponId, (id: string) => {
  if (!id) return
  const w = characterWeapons.value.find((x: HtbahWeaponEntry) => x.id === id)
  if (!w) return
  damageFormula.value = w.damageFormula
  damageLabel.value = w.name || 'Schaden'
})

// Ruestungs-Anzeige fuer das aktive (eigene) Token, rein informativ.
const activeArmor = computed(() => {
  if (!htbahData.value) return 0
  return htbahTotalArmor(htbahData.value)
})

// --- Schaden-Wuerfler (freier NdM+X-Wurf, fuer Charakter- und NPC-Tokens) ---
const damageFormula = ref<string>('')
const damageLabel = ref<string>('Schaden')
const damageSending = ref(false)
const damageError = ref<string | null>(null)
const damageSuccess = ref(false)
// Modus: Schaden zieht HP ab, Heilung addiert. Ziel-Token wird unten gewaehlt.
const damageMode = ref<'damage' | 'heal'>('damage')
// Ziel-Token (vom User explizit gewaehlt). 0 = kein Ziel (nur Wurf, keine
// automatische HP-Verrechnung).
const damageTargetId = ref<number>(0)
const damageApplyResult = ref<string | null>(null)

// Vollstaendige Token-Liste: bevorzugt die vom Parent gelieferte allTokens-
// Prop (alle Spieler + NPCs auf der Karte), fallback auf die eigenen Tokens.
const damageTargetTokens = computed<Token[]>(() => props.allTokens ?? props.tokens)
const damageTargetOptions = computed(() => [
  { label: '— kein Ziel (nur würfeln) —', value: 0 },
  ...damageTargetTokens.value.map((t: Token) => {
    const hpStr = t.hp !== null && t.hpMax ? ` · ${t.hp}/${t.hpMax}` : ''
    return { label: `${t.name}${hpStr}`, value: t.id }
  }),
])

// Bei Tab-Wechsel auch das Damage-Ziel zuruecksetzen, damit nicht aus Versehen
// ein altes Ziel uebernommen wird.
watch(selectedTokenId, () => {
  damageMode.value = 'damage'
  damageTargetId.value = 0
  damageApplyResult.value = null
})

const damageParsed = computed<{ count: number; sides: number; mod: number } | null>(() => {
  const m = damageFormula.value.trim().match(/^(\d+)\s*[dwDW]\s*(\d+)\s*([+-]\s*\d+)?$/)
  if (!m) return null
  const count = parseInt(m[1]!, 10)
  const sides = parseInt(m[2]!, 10)
  const mod = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0
  if (count < 1 || count > 20) return null
  if (sides < 2 || sides > 1000) return null
  return { count, sides, mod }
})

const damagePreview = computed(() => {
  const p = damageParsed.value
  if (!p) return ''
  const sign = p.mod > 0 ? `+${p.mod}` : p.mod < 0 ? `${p.mod}` : ''
  return `${p.count}d${p.sides}${sign}`
})

interface RollMessagePayload {
  dice: number[]
  modifier?: number
  /** Bei freien Wuerfen liefert der Server hier die Endsumme (inkl. Wunden). */
  target?: number
  /** Wunden-Malus, der vom Server eingerechnet wurde (negativ). */
  damageMalus?: number
}
interface RollMessage {
  message: { payload: RollMessagePayload | null }
}

const rollDamage = async () => {
  const parsed = damageParsed.value
  if (!parsed || !activeToken.value) return
  damageSending.value = true
  damageError.value = null
  damageSuccess.value = false
  damageApplyResult.value = null
  const targetId = damageTargetId.value
  const target = targetId
    ? damageTargetTokens.value.find((t: Token) => t.id === targetId) ?? null
    : null
  try {
    const npcSys = activeToken.value.system
    const sys: 'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah' =
      character.value?.system as 'dnd5e' | 'dnd2024' | 'dsa5' | 'dsa41' | 'htbah'
      ?? (npcSys === 'dnd' ? 'dnd5e' : npcSys === 'dsa5' ? 'dsa5' : 'htbah')
    const isHeal = damageMode.value === 'heal'
    const baseLabel = damageLabel.value.trim() || (isHeal ? 'Heilung' : 'Schaden')
    // Ziel-Suffix ins Label, damit im Chat sofort sichtbar ist, gegen wen der
    // Wurf gefuehrt wurde: "Schaden → Goblin #2" / "Heilung → Tarya".
    const targetSuffix = target ? ` ${isHeal ? '→' : '→'} ${target.name}` : ''
    const labelBase = `${baseLabel}${targetSuffix}`
    // Bei NPC-Token (kein Charakter) den Token-Namen mit ins Label, damit er
    // im Chat erkennbar bleibt — sonst nimmt rollFree nur die character-Daten.
    const label = character.value ? labelBase : `${activeToken.value.name}: ${labelBase}`
    // tokenId mitschicken, wenn der Wurf vom NPC-Token kommt — damit der
    // Server den Wunden-Malus aus den Token-HPs berechnen kann.
    const rollerTokenId =
      !character.value && activeToken.value ? activeToken.value.id : undefined
    const res = (await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount: parsed.count,
        diceSides: parsed.sides,
        modifier: parsed.mod || undefined,
        label,
        system: sys,
        characterId: character.value?.id,
        tokenId: rollerTokenId,
      },
    })) as RollMessage

    // Schaden / Heilung direkt am Ziel-Token verrechnen.
    if (target) {
      const payload = res.message?.payload
      let total: number | null = null
      if (payload) {
        if (typeof payload.target === 'number') {
          total = payload.target
        } else if (Array.isArray(payload.dice)) {
          // Fallback: Summe + Modifier + Wunden-Malus, damit der angewandte
          // HP-Delta auch dann den Malus enthaelt, wenn das Payload kein
          // target-Feld liefert.
          total =
            payload.dice.reduce((a: number, b: number) => a + b, 0) +
            (payload.modifier ?? 0) +
            (payload.damageMalus ?? 0)
        }
      }
      if (total === null) {
        damageApplyResult.value = `Wurf gepostet, aber Summe nicht ermittelbar — HP nicht angepasst.`
      } else if (target.hp === null || target.hpMax === null || target.hpMax === undefined) {
        damageApplyResult.value =
          `Wurf: ${total} — Ziel hat keine HP gepflegt, daher nicht automatisch angerechnet.`
      } else {
        // Negativ-Ergebnis (z.B. wegen schwerer Wunde) wirkt sich nicht
        // umgekehrt aus — Wurfwert wird auf 0 geclampt.
        const amount = Math.max(0, total)
        try {
          // apply-damage rechnet serverseitig Ruestung ab (HtbaH) und
          // liefert oldHp/hp/hpMax/absorbed/applied zurueck.
          const res = (await $fetch(
            `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${target.id}/apply-damage`,
            { method: 'POST', body: { amount, kind: isHeal ? 'heal' : 'damage' } },
          )) as {
            oldHp: number
            hp: number
            hpMax: number
            absorbed: number
            applied: number
          }
          target.hp = res.hp
          const armorPart =
            res.absorbed > 0 ? ` (Ruestung absorbiert ${res.absorbed})` : ''
          damageApplyResult.value = isHeal
            ? `+${res.applied} HP an ${target.name} (${res.oldHp} → ${res.hp}/${res.hpMax}).`
            : `−${res.applied} HP an ${target.name}${armorPart} (${res.oldHp} → ${res.hp}/${res.hpMax}).`
          emit('token-updated')
        } catch (err: unknown) {
          damageApplyResult.value =
            (err as { statusMessage?: string }).statusMessage
            ?? 'HP konnten nicht aktualisiert werden.'
        }
      }
    }

    damageSuccess.value = true
    // damageFormula bewusst NICHT zuruecksetzen — sonst muesste der Spieler
    // fuer jeden weiteren Angriff erst wieder die Waffe waehlen oder die
    // Formel tippen. So funktioniert wiederholtes Klicken auf "Wuerfeln"
    // fuer dasselbe Ziel mit derselben Waffe direkt.
    setTimeout(() => (damageSuccess.value = false), 2200)
  } catch (e: unknown) {
    damageError.value = (e as { statusMessage?: string }).statusMessage ?? 'Wurf fehlgeschlagen.'
  } finally {
    damageSending.value = false
  }
}

const rollSending = ref(false)
const rollError = ref<string | null>(null)
const rollSuccess = ref(false)

const pickedRollOption = computed(() =>
  rollOptions.value.find((o) => `${o.kind}:${o.id}:${o.source ?? ''}` === pickedRollId.value)
    ?? null,
)

const rollIt = async () => {
  if (!pickedRollOption.value) return
  // Charakter-Wuerfe brauchen Charakter; NPC-Wuerfe brauchen einen NPC-Token.
  if (!character.value && !isNpcRoller.value) return
  rollSending.value = true
  rollError.value = null
  rollSuccess.value = false
  try {
    const opt = pickedRollOption.value
    const characterId = character.value?.id ?? 0
    const tokenId = activeToken.value?.id ?? 0
    // Tageszeit-Bonus auflösen und in die Modifier mischen — sowohl an
    // NPC-Faehigkeiten (timeBonuses je Phase) als auch an HtbaH-Charakter-
    // Skills (dayBonus / nightBonus, Tag = Morgen+Mittag, Nacht = Abend+Nacht).
    let todBonus = 0
    let todNoteSuffix = ''
    if (
      opt.kind === 'npcHtbah' || opt.kind === 'npcDnd' || opt.kind === 'npcDsa5'
    ) {
      const ability = activeToken.value?.npcAbilities.find((a: NpcAbility) => a.id === opt.id)
      todBonus = timeBonusFor(ability?.timeBonuses, props.timeOfDay)
      if (todBonus !== 0) {
        const sign = todBonus > 0 ? '+' : ''
        todNoteSuffix = ` (Tageszeit ${sign}${todBonus})`
      }
    } else if (opt.kind === 'htbahSkill' && htbahData.value && props.timeOfDay) {
      const skill = htbahData.value.skills.find((s: HtbahSkill) => s.id === opt.id)
      if (skill) {
        const day = skill.dayBonus || 0
        const night = skill.nightBonus || 0
        todBonus = isDayTime(props.timeOfDay) ? day : night
        if (todBonus !== 0) {
          const sign = todBonus > 0 ? '+' : ''
          const phase = isDayTime(props.timeOfDay) ? 'Tag' : 'Nacht'
          todNoteSuffix = ` (${phase} ${sign}${todBonus})`
        }
      }
    }
    const combinedMod = (rollMod.value || 0) + todBonus
    const modifier = combinedMod !== 0 ? combinedMod : undefined
    const baseNote = rollNote.value.trim()
    const note = (baseNote + todNoteSuffix).trim() || undefined
    const dc = rollDc.value || undefined
    const mode = rollMode.value
    let body: Record<string, unknown>
    switch (opt.kind) {
      case 'htbahSkill':
        body = { kind: 'htbahSkill', characterId, skillId: opt.id, modifier, note }
        break
      case 'htbahTalent':
        body = { kind: 'htbahTalent', characterId, talent: opt.id as HtbahTalent, modifier, note }
        break
      case 'dndSkill':
        body = {
          kind: 'dndSkill',
          characterId,
          skillKey: opt.id,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'dndSave':
        body = {
          kind: 'dndSave',
          characterId,
          ability: opt.id as DnDAbility,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'dndAbility':
        body = {
          kind: 'dndAbility',
          characterId,
          ability: opt.id as DnDAbility,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'dsa5Skill':
        body = {
          kind: 'dsa5Skill',
          characterId,
          skillId: opt.id,
          source: opt.source ?? 'skill',
          modifier,
          note,
        }
        break
      case 'dsa5Ability':
        body = {
          kind: 'dsa5Ability',
          characterId,
          ability: opt.id as DsaAbility,
          modifier,
          note,
        }
        break
      case 'npcHtbah':
        body = { kind: 'npcHtbah', tokenId, abilityId: opt.id, modifier, note }
        break
      case 'npcDnd':
        body = {
          kind: 'npcDnd',
          tokenId,
          abilityId: opt.id,
          modifier,
          dc,
          rollMode: mode === 'normal' ? undefined : mode,
          note,
        }
        break
      case 'npcDsa5':
        body = { kind: 'npcDsa5', tokenId, abilityId: opt.id, modifier, note }
        break
    }
    await $fetch(`/api/groups/${props.groupId}/rolls`, { method: 'POST', body })
    rollSuccess.value = true
    rollNote.value = ''
    setTimeout(() => (rollSuccess.value = false), 2200)
  } catch (e: unknown) {
    rollError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Wurf fehlgeschlagen.'
  } finally {
    rollSending.value = false
  }
}

const supportsRoller = computed(
  () => isHtbah.value || isDnd.value || isDsa5.value || isNpcRoller.value,
)
const rollPanelTitle = computed(() => {
  if (isHtbah.value) return 'Probe würfeln (HtbaH)'
  if (isDnd.value) return 'Probe würfeln (D&D)'
  if (isDsa5.value) return 'Probe würfeln (DSA 5)'
  if (isNpcRoller.value) {
    const sys = activeToken.value?.system
    if (sys === 'htbah') return 'NPC-Probe (HtbaH)'
    if (sys === 'dnd') return 'NPC-Probe (D&D)'
    if (sys === 'dsa5') return 'NPC-Probe (DSA 5)'
  }
  return 'Probe würfeln'
})

const inventoryOpen = ref(false)
const inventoryText = computed(() => {
  if (htbahData.value) return htbahData.value.inventory ?? ''
  if (dndData.value) return dndData.value.equipment ?? ''
  if (dsa5Data.value) return dsa5Data.value.inventory ?? ''
  return ''
})

// — Geldbeutel —
// D&D nutzt das bestehende `currency.cp/sp/gp`-Feld (bleibt mit dem vollen
// Bogen synchron). Andere Regelwerke haben keine getypte Waehrungs-Struktur,
// dort speichern wir den Geldbeutel an `data.purse.{copper,silver,gold}`.
interface Purse {
  copper: number
  silver: number
  gold: number
}
const BLANK_PURSE: Purse = { copper: 0, silver: 0, gold: 0 }
const purseLabels = computed(() => {
  if (isDsa5.value) return { copper: 'Heller', silver: 'Silber', gold: 'Dukaten' }
  return { copper: 'Kupfer', silver: 'Silber', gold: 'Gold' }
})

const currentPurse = computed<Purse | null>(() => {
  if (!character.value) return null
  if (isDnd.value && dndData.value) {
    const c = dndData.value.currency
    return {
      copper: c?.cp ?? 0,
      silver: c?.sp ?? 0,
      gold: c?.gp ?? 0,
    }
  }
  // Generischer Geldbeutel fuer DSA/HtbaH/Unbekannt
  const data = character.value.data as { purse?: Partial<Purse> }
  return {
    copper: Number(data.purse?.copper ?? 0),
    silver: Number(data.purse?.silver ?? 0),
    gold: Number(data.purse?.gold ?? 0),
  }
})

const purseDraft = ref<Purse>({ ...BLANK_PURSE })
const purseLastServer = ref<Purse>({ ...BLANK_PURSE })

const sameP = (a: Purse, b: Purse) =>
  a.copper === b.copper && a.silver === b.silver && a.gold === b.gold

watch(
  currentPurse,
  (p: Purse | null) => {
    if (!p) {
      purseDraft.value = { ...BLANK_PURSE }
      purseLastServer.value = { ...BLANK_PURSE }
      return
    }
    // Nur uebernehmen, wenn der Nutzer nichts veraendert hat — analog zum HP-Editor.
    if (sameP(purseDraft.value, purseLastServer.value)) {
      purseDraft.value = { ...p }
    }
    purseLastServer.value = { ...p }
  },
  { immediate: true },
)

const purseDirty = computed(() => {
  const cur = currentPurse.value
  if (!cur) return false
  return !sameP(purseDraft.value, cur)
})

const purseSaving = ref(false)
const purseError = ref<string | null>(null)

const savePurse = async () => {
  if (!character.value) return
  const c = character.value
  // Volle data-Kopie bauen, damit kein anderes Feld am Server verloren geht.
  const nextData: Record<string, unknown> = { ...(c.data as Record<string, unknown>) }
  // Roh-Werte ganzzahlig und nicht-negativ machen; HtbaH zusaetzlich nach
  // 100 Kupfer = 1 Silber, 100 Silber = 1 Gold normalisieren. D&D/DSA folgen
  // ihren eigenen Regelwerken — dort bleiben die Werte unangetastet.
  const raw: Purse = {
    copper: Math.max(0, Math.floor(purseDraft.value.copper || 0)),
    silver: Math.max(0, Math.floor(purseDraft.value.silver || 0)),
    gold: Math.max(0, Math.floor(purseDraft.value.gold || 0)),
  }
  const next: Purse = isHtbah.value ? normalizeHtbahPurse(raw) : raw
  if (isDnd.value) {
    const oldCur = (nextData.currency as DnDCharacterData['currency']) ?? {
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 0,
      pp: 0,
    }
    nextData.currency = {
      ...oldCur,
      cp: next.copper,
      sp: next.silver,
      gp: next.gold,
    }
  } else {
    nextData.purse = next
  }
  purseSaving.value = true
  purseError.value = null
  try {
    const res = (await $fetch(`/api/characters/${c.id}`, {
      method: 'PUT',
      body: { data: nextData },
    })) as { character: CharacterFull }
    if (res.character) {
      character.value = res.character
      cacheByCharId.set(c.id, res.character)
    }
    purseDraft.value = { ...next }
    purseLastServer.value = { ...next }
  } catch (e: unknown) {
    purseError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Geldbeutel konnte nicht gespeichert werden.'
  } finally {
    purseSaving.value = false
  }
}

const hpPercent = computed(() => {
  const t = activeToken.value
  if (!t || !t.hpMax) return 0
  return Math.max(0, Math.min(100, Math.round(((t.hp ?? 0) / t.hpMax) * 100)))
})
// Aktive Schadensstufe des Tokens (live aus Token-HP). Liefert auch den
// Malus-Wert, der bei jedem Wurf serverseitig appliziert wird.
const activeDamageLevel = computed(() => {
  const t = activeToken.value
  if (!t) return computeDamageLevel(null, null)
  return computeDamageLevel(t.hp, t.hpMax)
})
const hpColor = computed(() => {
  const p = hpPercent.value
  if (p > 75) return '#10b981'
  if (p > 50) return '#84cc16'
  if (p > 25) return '#f59e0b'
  if (p > 0) return '#ef4444'
  return '#7f1d1d'
})

const failedImageTokenIds = ref(new Set<number>())
const tabImage = (t: Token): string | null => {
  if (failedImageTokenIds.value.has(t.id)) return null
  if (t.characterId) return `/api/portrait/${t.characterId}`
  if (t.imageUrl) return `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${t.id}/image`
  return null
}
const onImageError = (tokenId: number) => {
  failedImageTokenIds.value.add(tokenId)
}
</script>

<template>
  <div v-if="!tokens.length" class="parchment-card p-3 text-xs text-ink-300 italic">
    Setz deinen Charakter (oder einen NPC) als Token auf die Karte — danach erscheint hier dein Mini-Bogen.
  </div>
  <div v-else class="parchment-card p-3 space-y-3">
    <!-- Tab-Switcher (nur wenn mehrere Tokens) -->
    <div
      v-if="tokens.length > 1"
      class="flex flex-wrap gap-1 -mt-1 -mx-1 pb-1 border-b border-parchment-700/30"
    >
      <button
        v-for="t in tokens"
        :key="t.id"
        type="button"
        class="flex items-center gap-1 px-2 py-1 text-xs rounded border transition"
        :class="t.id === selectedTokenId
          ? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-ink-700 font-semibold'
          : 'bg-white/40 border-parchment-700/30 text-ink-400 hover:bg-white/70'"
        @click="selectedTokenId = t.id"
      >
        <img
          v-if="tabImage(t)"
          :src="tabImage(t) ?? ''"
          :alt="t.name"
          class="w-5 h-5 rounded-full object-cover border border-[var(--color-accent)]/50"
          @error="onImageError(t.id)"
        >
        <UIcon v-else name="i-lucide-user" class="size-4 opacity-60" />
        <span class="max-w-[140px] truncate">{{ t.name }}</span>
        <span
          v-if="t.hp !== null && t.hpMax"
          class="text-[10px] tabular-nums opacity-70"
        >
          {{ t.hp }}/{{ t.hpMax }}
        </span>
      </button>
    </div>

    <!-- Loading-/Fehler-/Inhalt-Zustand -->
    <div v-if="characterLoading" class="text-xs text-ink-400 italic">
      Lade Charakter …
    </div>
    <div v-else-if="characterError" class="text-xs text-red-700">
      {{ characterError }}
    </div>
    <div v-else-if="activeToken" class="space-y-3">
      <!-- Header: Bild + Name + HP-Bar -->
      <div class="flex items-center gap-3">
        <img
          v-if="character?.portraitUrl && !failedImageTokenIds.has(activeToken.id)"
          :src="`/api/portrait/${character.id}`"
          :alt="character.name"
          class="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]"
          @error="onImageError(activeToken.id)"
        >
        <img
          v-else-if="activeToken.imageUrl && !failedImageTokenIds.has(activeToken.id)"
          :src="`/api/groups/${groupId}/maps/${mapId}/tokens/${activeToken.id}/image`"
          :alt="activeToken.name"
          class="w-12 h-12 rounded-full object-cover border border-[var(--color-accent)]"
          @error="onImageError(activeToken.id)"
        >
        <div
          v-else
          class="w-12 h-12 rounded-full border border-[var(--color-accent)] bg-white/40 flex items-center justify-center text-ink-400"
        >
          <UIcon name="i-lucide-user" class="size-6" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="font-serif text-lg truncate">
            {{ character?.name ?? activeToken.name }}
          </div>
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ character ? character.system.toUpperCase() : 'NPC / Token' }}
            <span v-if="activeToken.hp !== null && activeToken.hpMax">
              · {{ activeToken.hp }}/{{ activeToken.hpMax }} HP
            </span>
          </div>
          <div
            v-if="activeToken.hpMax"
            class="mt-1 h-2 rounded bg-black/15 overflow-hidden"
          >
            <div
              class="h-full transition-all"
              :style="{ width: hpPercent + '%', background: hpColor }"
            />
          </div>
        </div>
      </div>

      <!-- Schadensstufen-Badge: zeigt, welcher Wunden-Malus aktuell auf jeden
           Wurf wirkt. Wird nur eingeblendet, wenn der Wuerfler tatsaechlich
           verwundet ist (Stufe >= 1). -->
      <div
        v-if="activeDamageLevel.level > 0"
        class="text-xs px-2 py-1 rounded font-semibold flex items-center gap-2"
        :style="{
          background: damageLevelColor(activeDamageLevel.level) + '22',
          border: '1px solid ' + damageLevelColor(activeDamageLevel.level),
          color: damageLevelColor(activeDamageLevel.level),
        }"
      >
        <UIcon name="i-lucide-heart-crack" class="size-4" />
        <span>Schadensstufe {{ activeDamageLevel.level }}</span>
        <span class="ml-auto tabular-nums">
          {{ activeDamageLevel.malus }} auf jeden Wurf
        </span>
      </div>

      <!-- HP-Editor -->
      <div class="flex flex-wrap items-end gap-2 text-xs">
        <UFormField label="HP">
          <UInput v-model.number="hpDraft" type="number" size="xs" class="w-20" />
        </UFormField>
        <UFormField label="Max">
          <UInput v-model.number="hpMaxDraft" type="number" size="xs" class="w-20" />
        </UFormField>
        <UButton
          v-if="hpDirty"
          size="xs"
          color="primary"
          :loading="hpSaving"
          @click="saveHp"
        >
          HP speichern
        </UButton>
        <span class="flex-1" />
        <UFormField label="±">
          <UInput v-model.number="hpDelta" type="number" size="xs" class="w-16" />
        </UFormField>
        <UButton size="xs" variant="outline" color="error" icon="i-lucide-minus" @click="applyHpDelta(-1)">
          Schaden
        </UButton>
        <UButton size="xs" variant="outline" color="success" icon="i-lucide-plus" @click="applyHpDelta(1)">
          Heilung
        </UButton>
      </div>

      <!-- Geldbeutel (nur fuer Charakter-Tokens) -->
      <div v-if="character" class="space-y-2 border-t border-parchment-700/30 pt-3">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-coins" class="size-4 text-[var(--color-accent)]" />
          <div class="text-[10px] uppercase tracking-widest text-ink-300 flex-1">
            Geldbeutel
            <span v-if="isHtbah" class="normal-case tracking-normal text-ink-300/70">
              · 100 K = 1 S, 100 S = 1 G
            </span>
          </div>
          <UButton
            v-if="purseDirty"
            size="xs"
            color="primary"
            :loading="purseSaving"
            @click="savePurse"
          >
            Speichern
          </UButton>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#b45309" />
                {{ purseLabels.copper }}
              </span>
            </template>
            <UInput v-model.number="purseDraft.copper" type="number" min="0" size="xs" class="w-full" />
          </UFormField>
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#9ca3af" />
                {{ purseLabels.silver }}
              </span>
            </template>
            <UInput v-model.number="purseDraft.silver" type="number" min="0" size="xs" class="w-full" />
          </UFormField>
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#d4af37" />
                {{ purseLabels.gold }}
              </span>
            </template>
            <UInput v-model.number="purseDraft.gold" type="number" min="0" size="xs" class="w-full" />
          </UFormField>
        </div>
        <p v-if="purseError" class="text-xs text-red-700">{{ purseError }}</p>
      </div>

      <!-- Skill-/Begabungs-Würfler (HtbaH, D&D 5e/2024, DSA 5) -->
      <div v-if="supportsRoller" class="space-y-2">
        <div class="text-[10px] uppercase tracking-widest text-ink-300">{{ rollPanelTitle }}</div>
        <UFormField label="Probe">
          <USelect
            v-model="pickedRollId"
            :items="rollOptions.map((o) => ({ label: `${o.label} (${o.value})`, value: `${o.kind}:${o.id}:${o.source ?? ''}` }))"
            value-key="value"
            placeholder="— Probe wählen —"
            size="sm"
            class="w-full"
          />
        </UFormField>
        <div v-if="isDnd || isNpcDnd" class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField label="Modus" class="sm:col-span-4">
            <USelect
              v-model="rollMode"
              :items="[
                { label: 'Normal', value: 'normal' },
                { label: 'Vorteil', value: 'advantage' },
                { label: 'Nachteil', value: 'disadvantage' },
              ]"
              value-key="value"
              size="sm"
            />
          </UFormField>
          <UFormField label="DC (optional)" class="sm:col-span-4">
            <UInput v-model.number="rollDc" type="number" size="sm" placeholder="z.B. 15" />
          </UFormField>
          <UFormField label="Mod ±" class="sm:col-span-4">
            <UInput v-model.number="rollMod" type="number" size="sm" />
          </UFormField>
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField
            label="Mod ±"
            class="sm:col-span-12"
            :help="isDsa5 ? 'Erleichterung (+) / Erschwernis (−) auf jede Eigenschaft' : 'z.B. −10 Erschwernis'"
          >
            <UInput v-model.number="rollMod" type="number" size="sm" class="w-full" />
          </UFormField>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField label="Notiz (optional)" class="sm:col-span-7">
            <UInput
              v-model="rollNote"
              placeholder="z.B. „klettert hoch“ oder „mit Anlauf“"
              size="sm"
              :maxlength="200"
              class="w-full"
            />
          </UFormField>
          <UButton
            color="primary"
            icon="i-lucide-dices"
            :disabled="!pickedRollOption"
            :loading="rollSending"
            class="sm:col-span-5 roll-cta"
            size="lg"
            block
            @click="rollIt"
          >
            Würfeln
          </UButton>
        </div>
        <p v-if="rollError" class="text-xs text-red-700">{{ rollError }}</p>
        <p v-if="rollSuccess" class="text-xs text-emerald-700">✓ Wurf in Gruppen-Chat gepostet</p>
      </div>
      <div v-else-if="character" class="text-xs text-ink-300 italic">
        Für dieses Regelwerk ist (noch) kein Würfler eingebaut — der volle Bogen unten zeigt alle Werte.
      </div>

      <!-- Schaden-/Heilungs-Wuerfler: freier NdM+X-Wurf, optional gegen ein
           Ziel-Token. Wenn ein Ziel gewaehlt ist, wird das Ergebnis direkt von
           seinen HP abgezogen (Schaden) oder addiert (Heilung). -->
      <div class="space-y-2 border-t border-parchment-700/30 pt-3">
        <div class="flex items-baseline justify-between gap-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            {{ damageMode === 'heal' ? 'Heilung' : 'Schaden' }} würfeln
          </div>
          <span
            v-if="activeArmor > 0"
            class="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded"
            :style="{
              background: '#1e3a8a22',
              color: '#1e3a8a',
              border: '1px solid #1e3a8a',
            }"
            title="Ruestung wird beim eingehenden Schaden serverseitig abgezogen."
          >
            🛡 Ruestung {{ activeArmor }}
          </span>
        </div>
        <!-- Waffe waehlen (nur HtbaH-Charaktere mit Waffen) -->
        <UFormField
          v-if="characterWeapons.length"
          label="Waffe"
          help="Auswahl fuellt Wuerfel + Bezeichnung automatisch."
        >
          <USelect
            v-model="selectedWeaponId"
            :items="weaponOptions"
            value-key="value"
            size="sm"
            class="w-full"
          />
        </UFormField>
        <!-- Modus + Ziel -->
        <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField label="Modus" class="sm:col-span-4">
            <USelect
              v-model="damageMode"
              :items="[
                { label: '⚔ Schaden', value: 'damage' },
                { label: '✚ Heilung', value: 'heal' },
              ]"
              value-key="value"
              size="sm"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Ziel"
            class="sm:col-span-8"
            help="Wähle den Charakter/NPC, dem der Wurf angerechnet wird."
          >
            <USelect
              v-model="damageTargetId"
              :items="damageTargetOptions"
              value-key="value"
              size="sm"
              class="w-full"
            />
          </UFormField>
        </div>
        <!-- Formel + Bezeichnung + Wuerfel-Button -->
        <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <UFormField label="Würfel" class="sm:col-span-4" help="z.B. 2d6, 4w8+3, 1d20−1">
            <UInput
              v-model="damageFormula"
              placeholder="2d6+3"
              size="sm"
              @keydown.enter="rollDamage"
            />
          </UFormField>
          <UFormField label="Bezeichnung" class="sm:col-span-4">
            <UInput
              v-model="damageLabel"
              :placeholder="damageMode === 'heal' ? 'Heilung' : 'Schaden'"
              size="sm"
              :maxlength="60"
            />
          </UFormField>
          <UButton
            :color="damageMode === 'heal' ? 'success' : 'primary'"
            :icon="damageMode === 'heal' ? 'i-lucide-heart-pulse' : 'i-lucide-swords'"
            :disabled="!damageParsed || damageSending"
            :loading="damageSending"
            class="sm:col-span-4 roll-cta"
            size="lg"
            block
            @click="rollDamage"
          >
            Würfeln
          </UButton>
        </div>
        <p
          v-if="damageFormula && !damageParsed"
          class="text-xs text-amber-700"
        >
          Format: NdM±X — z.B. <code>2d6+3</code>, <code>1w20</code>, <code>4d10−2</code>
        </p>
        <p
          v-else-if="damageParsed"
          class="text-[11px] text-ink-300 italic"
        >
          Wirft <code class="font-semibold">{{ damagePreview }}</code> in den Gruppen-Chat.
        </p>
        <p v-if="damageError" class="text-xs text-red-700">{{ damageError }}</p>
        <p v-if="damageSuccess" class="text-xs text-emerald-700">
          ✓ {{ damageMode === 'heal' ? 'Heilung' : 'Schaden' }} in Gruppen-Chat gepostet
        </p>
        <p
          v-if="damageApplyResult"
          class="text-xs"
          :class="damageMode === 'heal' ? 'text-emerald-700' : 'text-red-700'"
        >
          {{ damageApplyResult }}
        </p>
      </div>

      <!-- Klappbares Inventar / Beschreibung -->
      <div>
        <button
          type="button"
          class="flex items-center gap-1 w-full text-left text-xs uppercase tracking-widest text-ink-400 hover:text-[var(--color-accent)]"
          @click="inventoryOpen = !inventoryOpen"
        >
          <UIcon :name="inventoryOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3" />
          {{ character ? 'Inventar' : 'Beschreibung' }}
        </button>
        <div
          v-if="inventoryOpen"
          class="mt-1 text-xs whitespace-pre-wrap bg-white/40 border border-parchment-700/20 rounded p-2 max-h-40 overflow-auto"
        >
          <span v-if="character && inventoryText.trim()">{{ inventoryText }}</span>
          <span v-else-if="!character && activeToken.description?.trim()">
            {{ activeToken.description }}
          </span>
          <span v-else class="italic text-ink-300">Leer.</span>
        </div>
      </div>

      <NuxtLink
        v-if="character"
        :to="`/characters/${character.id}`"
        class="block text-[10px] text-[var(--color-accent)] hover:underline"
        target="_blank"
      >
        Vollen Charakterbogen öffnen ↗
      </NuxtLink>
    </div>
  </div>
</template>

<style scoped>
/* Wuerfeln-Button: prominenter, mit Akzent-Glow und groesserer Schrift. */
.roll-cta :deep(button) {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  box-shadow:
    0 0 0 1px var(--color-accent),
    0 0 12px 2px color-mix(in srgb, var(--color-accent) 50%, transparent);
  transition: box-shadow 120ms ease, transform 60ms ease;
}
.roll-cta :deep(button:hover:not(:disabled)) {
  box-shadow:
    0 0 0 1px var(--color-accent),
    0 0 18px 4px color-mix(in srgb, var(--color-accent) 70%, transparent);
}
.roll-cta :deep(button:active:not(:disabled)) {
  transform: translateY(1px);
}
</style>
