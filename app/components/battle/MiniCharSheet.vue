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
  HTBAH_DC_PRESETS,
  HTBAH_SPELL_MANA_COST,
  HTBAH_RDD_SCALES,
  HTBAH_RDD_SCALE_LABELS,
  HTBAH_UNIVERSAL_WEAPON_MOD,
  HTBAH_UNIVERSAL_ARMOR_MOD,
  HTBAH_BB_DUAL_WIELD,
  HTBAH_BB_REGEN,
  htbahSkillTotal,
  htbahTalentValue,
  htbahTotalArmor,
  htbahArmorParadeBonus,
  htbahWeaponAttackBonus,
  htbahManaMax,
  htbahUniversalDamage,
  normalizeHtbahPurse,
  type HtbahCharacterData,
  type HtbahSkill,
  type HtbahTalent,
  type HtbahWeaponEntry,
  type HtbahSpellEntry,
  type HtbahSpellLevel,
  type HtbahUsableItem,
  type HtbahUniversalWeaponKind,
  type HtbahUniversalArmorKind,
  type HtbahMerchant,
} from '~~/shared/engines/htbah'
import { HTBAH_SPELL_BY_KEY } from '~~/shared/engines/htbah-spell-catalog'
import {
  BATTLEBUBEN_SPELL_BY_KEY,
  BATTLEBUBEN_STIL_LABELS,
  battlebubenSpellMeta,
  type BattlebubenSpell,
  type BattlebubenEffectPart,
} from '~~/shared/battlebuben-magic'
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
import {
  resolveStatValue,
  statContext,
  type RuleSystemDefinition,
  type CustomCharacterData,
  type RsSpellDef,
} from '~~/shared/rule-system'
import { rollFormula } from '~~/shared/formula'
import type { NpcAbility } from '~~/shared/npc'
import { htbahConditionModsFromStatusText } from '~~/shared/conditions'
import { timeBonusFor, isDayTime, type TimeOfDay } from '~~/shared/time-of-day'
import { computeDamageLevel, damageLevelColor } from '~~/shared/damage-level'
import { chebyshevTiles, parseHtbahRangeTiles } from '~~/shared/distance'

interface Token {
  id: number
  ownerUserId: number
  characterId: number | null
  name: string
  imageUrl: string | null
  /** Karten-Position in Pixeln (Mittelpunkt) — fuer Entfernungs-Checks. */
  x: number
  y: number
  hp: number | null
  hpMax: number | null
  description: string
  system: 'htbah' | 'dnd' | 'dsa5' | null
  npcAbilities: NpcAbility[]
  /** CSV der Conditions am Token (z.B. "prone,frightened") + Frei-Text-Reste. */
  statusText: string
  /** Haendler-Konfiguration (NPC-Token-Haendler). null = kein Haendler. */
  merchant?: HtbahMerchant | null
}

interface CharacterFull {
  id: number
  system: GameSystem | 'custom'
  ruleSystemId?: number | null
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
  /**
   * Charakter-IDs, fuer die der SL gerade Initiative-Wuerfe anfordert.
   * Wenn die characterId des aktiven Charakter-Tokens hier auftaucht,
   * erscheint im MiniCharSheet ein roter "Initiative wuerfeln"-Button.
   */
  awaitingInitiativeFor?: number[]
  /**
   * Pixel pro Rasterzelle. Wird fuer Entfernungs-Checks (Nahkampf-Reichweite,
   * Spruch-Reichweite) gegen die Token-Pixel-Positionen verrechnet. Fehlt
   * der Wert (z.B. weil das Eltern-Page ihn nicht durchreicht), wird die
   * Reichweiten-Pruefung weich uebersprungen.
   */
  gridSize?: number
  /**
   * Ob der lokale User Spielleiter ist. Spieler werden bei Reichweiten-
   * Verstoss am Wuerfeln gehindert, der DM darf jederzeit ausserhalb
   * Reichweite wuerfeln (Storytelling, Edge-Cases).
   */
  isDm?: boolean
  /**
   * Von der Battle-Page per Rechtsklick auf einen Token gesetztes Ziel.
   * Wird in das interne Ziel (damageTargetId / uniTargetId) uebernommen, damit
   * Schaden/Angriff/Zauber in JEDEM System direkt auf das angeklickte Token
   * gehen — ohne das Dropdown.
   */
  targetTokenId?: number | null
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
  isHtbah.value && character.value ? (character.value.data as unknown as HtbahCharacterData) : null,
)
// Battlebuben-Hausregel aktiv? Schaltet Zwei-Waffen-Manoever, Parade-QS-
// Hinweis und Regenerations-/Heilkunde-Quickrolls frei.
const isBattlebuben = computed(() => htbahData.value?.battlebuben === true)

// --- Shop / Einkaufen beim NPC-Haendler ---
const shopOpen = ref(false)
// Nach einem Kauf: Charakter neu laden, damit Inventar + Geldbeutel SOFORT
// stimmen. Wichtig: auch den Cache aktualisieren — sonst ueberschreibt ein
// erneuter fetchChar (z.B. durch den Token-Reload nach 'token-updated') die
// frischen Daten wieder mit dem alten Stand, und das Item erscheint erst nach
// einem manuellen Refresh.
const onShopBought = async () => {
  if (!character.value) return
  try {
    const res = await $fetch<{ character: CharacterFull }>(`/api/characters/${character.value.id}`)
    character.value = res.character
    cacheByCharId.set(res.character.id, res.character)
  } catch {
    // Reload-Fehler ist nicht-kritisch — der Server hat den Kauf bereits verbucht.
  }
  emit('token-updated')
}
const dndData = computed<DnDCharacterData | null>(() =>
  isDnd.value && character.value ? (character.value.data as unknown as DnDCharacterData) : null,
)
const dsa5Data = computed<Dsa5CharacterData | null>(() =>
  isDsa5.value && character.value ? (character.value.data as unknown as Dsa5CharacterData) : null,
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
  selectedSpellId.value = ''
  selectedSpellLevelId.value = ''
})

// --- Waffen-Auswahl (nur HtbaH-Charaktere mit gepflegten Waffen) ---
const characterWeapons = computed<HtbahWeaponEntry[]>(() => {
  if (!htbahData.value) return []
  return (htbahData.value.weapons ?? []).filter(
    (w: HtbahWeaponEntry) => w.name?.trim() || w.damageFormula?.trim(),
  )
})
// Radix-Select (Nuxt UI 3) verbietet empty-string als Option-Value — daher
// dieser Sentinel als "nichts ausgewaehlt"-Marker. In den Watchern wird er
// wie '' behandelt.
const NONE_VALUE = '__none__'
const weaponOptions = computed(() => [
  { label: '— Waffe waehlen —', value: NONE_VALUE },
  ...characterWeapons.value.map((w: HtbahWeaponEntry) => {
    // Sonderregel-Suffix fuer schnellen visuellen Abgleich:
    // "Streitkolben (3d10+10, Schlag, RB-30)"
    const p = w.properties ?? {}
    const tags: string[] = []
    if (p.schlagwaffe) tags.push('Schlag')
    if (p.armorBreak) tags.push(`RB-${p.armorBreak}`)
    if (p.aufspiessen) tags.push('Aufspießen')
    if (p.huntingThreshold) tags.push(`Jagd≤${p.huntingThreshold}`)
    const tagStr = tags.length ? `, ${tags.join(', ')}` : ''
    return {
      label: `${w.name} (${w.damageFormula}${tagStr})`,
      value: w.id,
    }
  }),
])
const selectedWeaponId = ref<string>('')
const selectedWeapon = computed<HtbahWeaponEntry | null>(
  () =>
    characterWeapons.value.find((w: HtbahWeaponEntry) => w.id === selectedWeaponId.value) ??
    null,
)
// Wenn der Spieler eine Waffe waehlt, Formel + Label uebernehmen. Zusaetzlich
// die Trefferprobe vorbelegen (attackSkillId), wenn die Waffe einen Trefferskill
// gepflegt hat — damit der Spieler nicht zwei Mal das Dropdown anfassen muss.
watch(selectedWeaponId, (id: string) => {
  if (id === NONE_VALUE) {
    selectedWeaponId.value = ''
    return
  }
  if (!id) return
  const w = characterWeapons.value.find((x: HtbahWeaponEntry) => x.id === id)
  if (!w) return
  damageFormula.value = w.damageFormula
  damageLabel.value = w.name || 'Schaden'
  if (w.attackSkillId) {
    const skillRollId = `htbahSkill:${w.attackSkillId}:`
    if (rollOptions.value.some((o: RollTarget) => `${o.kind}:${o.id}:${o.source ?? ''}` === skillRollId)) {
      pickedRollId.value = skillRollId
    }
  }
  // Andere Auswahl zuruecksetzen, damit nicht aus Versehen Zauber-Mod + Waffe
  // gleichzeitig wirken.
  selectedSpellId.value = ''
  selectedSpellLevelId.value = ''
})

// --- Zauber- und Magie-Auswahl (HtbaH) ---
// Anders als Waffen ist ein Zauber zweistufig: erst Zauber, dann Wirk-Stufe.
// Die Stufe befuellt damageFormula/damageLabel UND setzt die Probe (pickedRollId
// auf den verknuepften Skill, rollMod auf den Stufen-Mod). Damit kann der
// Spieler in einem Rutsch erst die Probe und dann den Schaden wuerfeln.
const characterSpells = computed<HtbahSpellEntry[]>(() => {
  if (!htbahData.value) return []
  return (htbahData.value.spells ?? []).filter(
    (s: HtbahSpellEntry) => s.name?.trim() && s.levels?.length,
  )
})
const spellOptions = computed(() => [
  { label: '— Zauber waehlen —', value: NONE_VALUE },
  ...characterSpells.value.map((s: HtbahSpellEntry) => ({
    label: s.name,
    value: s.id,
  })),
])
const selectedSpellId = ref<string>('')
const selectedSpellLevelId = ref<string>('')
const selectedSpell = computed<HtbahSpellEntry | null>(
  () => characterSpells.value.find((s: HtbahSpellEntry) => s.id === selectedSpellId.value) ?? null,
)
const spellLevelOptions = computed(() => {
  const sp = selectedSpell.value
  if (!sp) return [{ label: '— erst Zauber waehlen —', value: NONE_VALUE }]
  return [
    { label: '— Stufe waehlen —', value: NONE_VALUE },
    ...sp.levels.map((l: HtbahSpellLevel) => {
      const modStr = l.modifier > 0 ? `+${l.modifier}` : l.modifier < 0 ? `${l.modifier}` : '±0'
      const dmgStr = l.damageFormula?.trim() ? ` · ${l.damageFormula}` : ''
      return { label: `${l.label || '(unbenannt)'} (${modStr}${dmgStr})`, value: l.id }
    }),
  ]
})
// Bei Zauber-Wechsel die Stufe leeren — der Spieler soll bewusst neu waehlen.
// Wenn Sentinel gewaehlt wurde, gleich auf '' zuruecksetzen, damit die
// nachgelagerte Logik wie gewohnt "kein Zauber gewaehlt" sieht.
watch(selectedSpellId, (id: string) => {
  selectedSpellLevelId.value = ''
  if (id === NONE_VALUE) selectedSpellId.value = ''
})
// Bei Stufen-Wahl: Schaden-Formel + Label setzen, Probe vorbelegen, Mod setzen
// und den Schaden/Heilung-Modus passend zur Stufe vorbelegen (Heilzauber
// landen damit direkt im Heil-Modus, sodass Ruestung nicht abgezogen wird).
watch(selectedSpellLevelId, (id: string) => {
  if (id === NONE_VALUE) {
    selectedSpellLevelId.value = ''
    return
  }
  if (!id) return
  const sp = selectedSpell.value
  if (!sp) return
  const lvl = sp.levels.find((l: HtbahSpellLevel) => l.id === id)
  if (!lvl) return
  damageFormula.value = lvl.damageFormula
  damageLabel.value = `${sp.name}${lvl.label ? ` – ${lvl.label}` : ''}`
  damageMode.value = lvl.kind === 'heal' ? 'heal' : 'damage'
  // Probe gegen den verknuepften Skill — finde das passende RollOption.
  if (sp.skillId) {
    const skillRollId = `htbahSkill:${sp.skillId}:`
    if (rollOptions.value.some((o: RollTarget) => `${o.kind}:${o.id}:${o.source ?? ''}` === skillRollId)) {
      pickedRollId.value = skillRollId
    }
  }
  rollMod.value = lvl.modifier || 0
  // Waffen-Auswahl raeumen, damit Damage-Felder nicht von dort ueberschrieben werden.
  selectedWeaponId.value = ''
})

// Ruestungs-Anzeige fuer das aktive (eigene) Token, rein informativ.
const activeArmor = computed(() => {
  if (!htbahData.value) return 0
  return htbahTotalArmor(htbahData.value)
})

// --- Universalkampfsystem-Schadensrechner (§3.2) ---
// Wenn isUniversalCombat aktiv ist und der Spieler den Modus waehlt,
// wird die Schadensformel `(Talent − Wurf) / (WaffenMod + RuestungsMod)` statt
// des klassischen NdM±X-Wurfs angewandt. Min 10 LP bei Treffer.
const universalOpen = ref(false)
const uniTalentValue = ref<number>(0)
const uniAttackRoll = ref<number>(50)
const uniWeaponKind = ref<HtbahUniversalWeaponKind>('handwaffe')
const uniArmorKind = ref<HtbahUniversalArmorKind>('keine')
const universalResult = computed(() =>
  htbahUniversalDamage({
    talentValue: uniTalentValue.value || 0,
    attackRoll: uniAttackRoll.value || 0,
    weaponKind: uniWeaponKind.value,
    armorKind: uniArmorKind.value,
  }),
)
// Ziel-Token fuer den Universalkampf-Schaden. 0 = nur rechnen, nicht anwenden.
// Die normalen Schaden-Wuerfler-Targets (damageTargetTokens) wiederverwenden —
// dort sind ja sowieso alle Tokens der Karte gelistet.
const uniTargetId = ref<number>(0)
const uniApplying = ref(false)
const uniApplyResult = ref<string | null>(null)
const uniApplyError = ref<string | null>(null)
const applyUniversalDamage = async () => {
  if (!character.value && !activeToken.value) return
  const amount = universalResult.value.damage
  if (amount <= 0) {
    uniApplyError.value = 'Kein Schaden zu verteilen — Wurf ueber Talent oder Mod = 0.'
    return
  }
  const target = damageTargetTokens.value.find((t: Token) => t.id === uniTargetId.value) ?? null
  if (!target) {
    uniApplyError.value = 'Bitte ein Ziel waehlen.'
    return
  }
  if (target.hp === null || target.hpMax === null || target.hpMax === undefined) {
    uniApplyError.value = `${target.name} hat keine HP gepflegt.`
    return
  }
  uniApplying.value = true
  uniApplyError.value = null
  uniApplyResult.value = null
  try {
    // Chat-Card mit dem Berechnungs-Pfad, damit der DM sieht, was angewandt wurde.
    await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount: 0,
        diceSides: 1,
        modifier: amount,
        label: `Universalkampf-Schaden → ${target.name} (T ${uniTalentValue.value} − W ${uniAttackRoll.value}) / Mod ${universalResult.value.combinedMod}`,
        system: 'htbah',
        characterId: character.value?.id,
        targetTokenId: target.id,
        damageKind: 'damage',
      },
    })
    const res = (await $fetch(
      `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${target.id}/apply-damage`,
      { method: 'POST', body: { amount, kind: 'damage' } },
    )) as { oldHp: number; hp: number; hpMax: number; applied: number; absorbed: number }
    target.hp = res.hp
    const armorPart = res.absorbed > 0 ? ` (Ruestung ${res.absorbed})` : ''
    uniApplyResult.value =
      `−${res.applied} HP an ${target.name}${armorPart} (${res.oldHp} → ${res.hp}/${res.hpMax}).`
    emit('token-updated')
    setTimeout(() => (uniApplyResult.value = null), 3500)
  } catch (e: unknown) {
    uniApplyError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Schaden konnte nicht angewandt werden.'
  } finally {
    uniApplying.value = false
  }
}

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

// Rechtsklick-Ziel von der Battle-Page uebernehmen: setzt das Ziel fuer
// Schaden/Angriff/Zauber in JEDEM System (damageTargetId + uniTargetId).
watch(
  () => props.targetTokenId,
  (id) => {
    if (!id) return
    const tok = damageTargetTokens.value.find((t) => t.id === id)
    if (!tok) return
    damageTargetId.value = id
    uniTargetId.value = id
  },
)

/* ==========================================================================
 *  CUSTOM-REGELWERK — Kampf-Block (Zauber/Waffen an Ziel anwenden, Probe)
 * ======================================================================== */
const isCustom = computed(() => character.value?.system === 'custom')
const customDef = ref<RuleSystemDefinition | null>(null)
const customData = computed<CustomCharacterData | null>(() =>
  isCustom.value && character.value ? (character.value.data as unknown as CustomCharacterData) : null,
)
const customMagic = computed(() => customDef.value?.modules?.magic ?? null)
const customCombat = computed(() => customDef.value?.modules?.combat ?? null)
const customResult = ref<string | null>(null)

// Definition laden, sobald ein Custom-Charakter mit ruleSystemId aktiv ist.
watch(
  () => (isCustom.value ? character.value?.ruleSystemId ?? null : null),
  async (rsId) => {
    customDef.value = null
    if (!rsId) return
    try {
      const res = await $fetch<{ ruleSystem: { definition: RuleSystemDefinition } }>(
        `/api/rule-systems/${rsId}`,
      )
      customDef.value = res.ruleSystem.definition
    } catch {
      customDef.value = null
    }
  },
  { immediate: true },
)

const dRoll = (size: number) => Math.floor(Math.random() * size) + 1
// Probe nach Systemmechanik. Liefert {success, text}.
const customCheck = (statVal: number, difficulty: number) => {
  const def = customDef.value!
  const m = def.dice.mechanic
  if (m === 'roll-under') {
    const roll = dRoll(def.dice.dieSize)
    const target = statVal - difficulty
    return { success: roll <= target, text: `1W${def.dice.dieSize}=${roll} ≤ ${target}` }
  }
  if (m === 'roll-over') {
    const roll = dRoll(def.dice.dieSize)
    const dc = 10 + difficulty
    return { success: roll + statVal >= dc, text: `1W${def.dice.dieSize}=${roll}+${statVal} vs ${dc}` }
  }
  const rolls = [dRoll(20), dRoll(20), dRoll(20)]
  const succ = rolls.filter((r) => r <= statVal).length
  return { success: succ >= 1, text: `3W20=[${rolls.join(',')}] → ${succ} Erfolge` }
}

// Whole-data-Patch fuer den eigenen Charakter (z.B. Mana abziehen). PUTtet die
// Daten und aktualisiert den lokalen Cache. HP-Aenderungen laufen NICHT hierueber
// (die macht apply-damage serverseitig).
const patchCustomData = async (mutate: (d: CustomCharacterData) => void) => {
  if (!character.value) return
  const next = JSON.parse(JSON.stringify(character.value.data)) as CustomCharacterData
  mutate(next)
  character.value = { ...character.value, data: next as unknown as Record<string, unknown> }
  cacheByCharId.set(character.value.id, character.value)
  try {
    await $fetch(`/api/characters/${character.value.id}`, { method: 'PUT', body: { data: next } })
  } catch {
    // nicht-kritisch fuer die Anzeige
  }
}

// Chat-Roll-Card posten (freier Wurf, Custom-System).
const postCustomRoll = async (label: string, amount: number, opts?: { targetTokenId?: number; damageKind?: 'damage' | 'heal' }) => {
  try {
    await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount: 0,
        diceSides: 1,
        modifier: amount,
        label,
        system: 'custom',
        characterId: character.value?.id,
        targetTokenId: opts?.targetTokenId,
        damageKind: opts?.damageKind,
      },
    })
  } catch {
    // Chat-Post nicht-kritisch
  }
}

// Effekt (Schaden/Heilung) auf ein Ziel-Token anwenden + Chat-Card.
const applyCustomEffect = async (target: Token, amount: number, kind: 'damage' | 'heal', label: string) => {
  if (amount <= 0) return
  await postCustomRoll(label, amount, { targetTokenId: target.id, damageKind: kind })
  if (target.hp === null || target.hpMax === null || target.hpMax === undefined) return
  try {
    const res = (await $fetch(
      `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${target.id}/apply-damage`,
      { method: 'POST', body: { amount, kind } },
    )) as { hp: number }
    target.hp = res.hp
    emit('token-updated')
  } catch {
    // ignore
  }
}

const selectedCustomTarget = computed<Token | null>(() =>
  damageTargetId.value ? damageTargetTokens.value.find((t) => t.id === damageTargetId.value) ?? null : null,
)
// Eigenes Token (fuer Selbst-Heilung als Default-Ziel).
const ownToken = computed<Token | null>(() =>
  character.value ? props.tokens.find((t) => t.characterId === character.value!.id) ?? null : null,
)

const customCastSpell = async (sp: RsSpellDef) => {
  const def = customDef.value
  const mag = customMagic.value
  const cd = customData.value
  if (!def || !mag || !cd || !character.value) return
  const mana = cd.resources.mana
  if (mana && mana.current < sp.cost) {
    customResult.value = `${sp.name}: nicht genug ${mag.resourceName}.`
    return
  }
  const statVal = resolveStatValue(cd, mag.castStat)
  const check = customCheck(statVal, sp.difficulty)
  // Mana abziehen (persistiert).
  if (sp.cost > 0) await patchCustomData((d) => {
    if (d.resources.mana) d.resources.mana.current = Math.max(0, d.resources.mana.current - sp.cost)
  })
  const costNote = sp.cost ? ` (−${sp.cost} ${mag.resourceName})` : ''
  if (!check.success) {
    await postCustomRoll(`${sp.name} — Probe misslungen${costNote}`, 0)
    customResult.value = `${sp.name}: ${check.text} → misslungen.${costNote}`
    return
  }
  if (sp.kind === 'utility') {
    await postCustomRoll(`${sp.name} — gewirkt${costNote}`, 0)
    customResult.value = `${sp.name}: ${check.text} → gelungen.${costNote}`
    return
  }
  const eff = rollFormula(sp.effectFormula, statContext(cd))
  // Heilung: Ziel = gewaehltes Ziel ODER eigenes Token. Schaden: gewaehltes Ziel.
  const target = sp.kind === 'heal' ? (selectedCustomTarget.value ?? ownToken.value) : selectedCustomTarget.value
  if (!target) {
    customResult.value = `${sp.name}: ${check.text} → ${eff.total} (${eff.detail}). Kein Ziel gewählt.${costNote}`
    return
  }
  await applyCustomEffect(target, eff.total, sp.kind === 'heal' ? 'heal' : 'damage', `${sp.name} → ${target.name}`)
  const verb = sp.kind === 'heal' ? `+${eff.total} HP` : `${eff.total} Schaden`
  customResult.value = `${sp.name}: ${check.text} → ${verb} an ${target.name} (${eff.detail}).${costNote}`
}

const customWeaponAttack = async (w: { name: string }) => {
  const def = customDef.value
  const cb = customCombat.value
  const cd = customData.value
  if (!def || !cb || !cd) return
  const statVal = resolveStatValue(cd, cb.attackStat)
  const check = customCheck(statVal, 0)
  await postCustomRoll(`${w.name} — Angriff: ${check.success ? 'Treffer' : 'daneben'}`, statVal)
  customResult.value = `${w.name} — Angriff: ${check.text} → ${check.success ? 'Treffer ✓' : 'daneben ✗'}`
}

const customWeaponDamage = async (w: { name: string; damageFormula: string; range?: number }) => {
  const cd = customData.value
  if (!cd) return
  const target = selectedCustomTarget.value
  const eff = rollFormula(w.damageFormula, statContext(cd))
  if (!target) {
    customResult.value = `${w.name} — Schaden: ${eff.total} (${eff.detail}). Kein Ziel gewählt.`
    return
  }
  // Reichweiten-Pruefung (Chebyshev-Felder). DM darf ausserhalb der Reichweite.
  const range = w.range && w.range > 0 ? w.range : 1
  const dist = distanceToToken(target)
  if (dist !== null && dist > range && !props.isDm) {
    customResult.value = `${w.name}: Ziel ${dist} Felder entfernt — Reichweite ${range}.`
    return
  }
  await applyCustomEffect(target, eff.total, 'damage', `${w.name} → ${target.name}`)
  customResult.value = `${w.name} — ${eff.total} Schaden an ${target.name} (${eff.detail}).`
}

const customProbeTargetKey = ref<string>('')
const customProbeDc = ref(10)
const customProbeTargets = computed(() => {
  const def = customDef.value
  const cd = customData.value
  if (!def || !cd) return [] as { label: string; value: string; val: number }[]
  const out: { label: string; value: string; val: number }[] = []
  for (const a of def.attributes) out.push({ label: `${a.label} (Attribut)`, value: `attr:${a.key}`, val: cd.attributes[a.key] ?? a.default })
  for (const s of def.skills) out.push({ label: `${s.label} (Fertigkeit)`, value: `skill:${s.key}`, val: cd.skills[s.key] ?? s.default })
  return out
})
const customProbe = async () => {
  const t = customProbeTargets.value.find((x) => x.value === customProbeTargetKey.value)
  if (!t) {
    customResult.value = 'Bitte ein Ziel der Probe wählen.'
    return
  }
  const check = customCheck(t.val, customDef.value?.dice.mechanic === 'roll-over' ? customProbeDc.value - 10 : 0)
  await postCustomRoll(`Probe ${t.label}: ${check.success ? 'Erfolg' : 'Misserfolg'}`, t.val)
  customResult.value = `Probe ${t.label}: ${check.text} → ${check.success ? 'Erfolg ✓' : 'Misserfolg ✗'}`
}
// Token-Haendler (NPC-Token mit aktiver Haendler-Konfig) auf der Karte — fuer
// den Shop. Versteckte Token sind im Snapshot schon ausgefiltert.
const tokenMerchants = computed(() =>
  damageTargetTokens.value
    .filter((t) => t.merchant?.active)
    .map((t) => ({
      tokenId: t.id,
      name: t.name,
      shopName: t.merchant?.shopName || t.name,
      items: t.merchant?.items ?? [],
      x: t.x,
      y: t.y,
    })),
)
// Distanz vom aktiven (eigenen) Token zum jeweiligen Ziel in Rasterzellen.
// Null = keine Berechnung moeglich (kein gridSize gepflegt oder Token fehlt).
const distanceToToken = (target: Token | null): number | null => {
  if (!target) return null
  const me = activeToken.value
  if (!me) return null
  const g = props.gridSize ?? 0
  if (!g) return null
  return chebyshevTiles({ x: me.x, y: me.y }, { x: target.x, y: target.y }, g)
}
const distanceLabel = (target: Token | null): string => {
  const d = distanceToToken(target)
  if (d === null) return ''
  if (d === 0) return ' · selbes Feld'
  if (d === 1) return ' · 1 Feld'
  return ` · ${d} Felder`
}
const damageTargetOptions = computed(() => [
  { label: '— kein Ziel (nur würfeln) —', value: 0 },
  ...damageTargetTokens.value.map((t: Token) => {
    const hpStr = t.hp !== null && t.hpMax ? ` · ${t.hp}/${t.hpMax}` : ''
    return { label: `${t.name}${hpStr}${distanceLabel(t)}`, value: t.id }
  }),
])

// — Nahkampf-Reichweite —
// HtbaH-Waffen-Kategorien fernkampf/wurf duerfen mit Distanz wuerfeln; alle
// anderen (stumpf/hieb/stich/sonstige) sind Nahkampf und brauchen das Ziel
// direkt benachbart (Chebyshev <= 1, also selbes Feld oder eines daneben).
// Ohne gewaehlte Waffe greift die Pruefung nicht — der Spieler wuerfelt
// dann eine freie Probe ohne Waffe.
const weaponIsMelee = computed<boolean>(() => {
  const w = selectedWeapon.value
  if (!w) return false
  const cat = w.category
  return cat !== 'fernkampf' && cat !== 'wurf'
})
const damageTargetToken = computed<Token | null>(() =>
  damageTargetId.value
    ? damageTargetTokens.value.find((t: Token) => t.id === damageTargetId.value) ?? null
    : null,
)
const meleeOutOfReach = computed<boolean>(() => {
  if (!weaponIsMelee.value) return false
  const dist = distanceToToken(damageTargetToken.value)
  if (dist === null) return false
  return dist > 1
})
const meleeBlocked = computed<boolean>(() => meleeOutOfReach.value && !props.isDm)

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
    // Waffen-Sonderregeln fuer den Schadenswurf:
    //  - schlagwaffe   → Server rerollt 1er einmal
    //  - armorBreak    → reduziert RW des Ziels in der Anzeige / im apply-damage
    //  - weaponCategory→ nur Chat-Anzeige
    //  - critical      → verdoppelt den Schaden (HTBaH §2.5/§10), nur wenn die
    //                    letzte Probe ein Krit war
    // Nur ziehen, wenn KEIN Heilmodus (sonst macht der Reroll keinen Sinn).
    const wpForDmg = !isHeal && selectedWeapon.value ? selectedWeapon.value.properties ?? {} : {}
    const isCritDamage = !isHeal && probeResultLast.value?.critical === true
    // Zustands-Schadensreduktion: Veraengstigt zieht −5 vom Schaden ab (§4.2).
    // Nur bei Schadenswuerfen — nicht bei Heilung — und nicht doppelt zaehlen.
    const dmgConditions = !isHeal && activeToken.value
      ? htbahConditionModsFromStatusText(activeToken.value.statusText)
      : null
    const dmgReduction = dmgConditions?.damageReduction ?? 0
    // Effektiver Modifier: Wuerfelformel-Mod minus Schadensreduktion (zieht ab).
    const effectiveMod = (parsed.mod ?? 0) - dmgReduction
    const res = (await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount: parsed.count,
        diceSides: parsed.sides,
        modifier: effectiveMod || undefined,
        label: dmgReduction > 0
          ? `${label} (Schaden −${dmgReduction} durch Zustand)`
          : label,
        system: sys,
        characterId: character.value?.id,
        tokenId: rollerTokenId,
        // Bei Ziel-Wahl: Server schlaegt Ruestung des Ziels nach und schreibt
        // targetArmor/finalDamage ins Payload, damit die RollCard im Chat den
        // tatsaechlichen Trefferschaden anzeigt.
        targetTokenId: target?.id,
        damageKind: isHeal ? 'heal' : 'damage',
        schlagwaffe: wpForDmg.schlagwaffe || undefined,
        armorBreak: wpForDmg.armorBreak || undefined,
        weaponCategory: !isHeal ? selectedWeapon.value?.category : undefined,
        critical: isCritDamage || undefined,
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
          // liefert oldHp/hp/hpMax/absorbed/applied/armorBreakUsed/aufspiessenArmorLoss
          // zurueck. Waffen-Sonderregeln werden mitgesendet, damit der
          // Server R-Brechend wirklich anwendet und Aufspiessen+Krit die
          // Ruestung dauerhaft beschaedigt.
          const wpForApply = !isHeal && selectedWeapon.value ? selectedWeapon.value.properties ?? {} : {}
          // Aufspiessen-Krit nur, wenn die LETZTE Probe (htbahSkill) ein Krit
          // war UND die Waffe Aufspiessen hat. Wird vom Probenwurf an
          // probeResultLast getrackt (s.u.).
          const aufspiessenCrit =
            !isHeal && !!wpForApply.aufspiessen && probeResultLast.value?.critical === true
          const res = (await $fetch(
            `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${target.id}/apply-damage`,
            {
              method: 'POST',
              body: {
                amount,
                kind: isHeal ? 'heal' : 'damage',
                armorBreak: wpForApply.armorBreak || undefined,
                aufspiessenCrit: aufspiessenCrit || undefined,
              },
            },
          )) as {
            oldHp: number
            hp: number
            hpMax: number
            absorbed: number
            applied: number
            armorBreakUsed?: number
            aufspiessenArmorLoss?: { slot: string | null; pieceId: string | null } | null
          }
          target.hp = res.hp
          const armorPart =
            res.absorbed > 0 ? ` (Rüstung absorbiert ${res.absorbed})` : ''
          const rbPart =
            res.armorBreakUsed && res.armorBreakUsed > 0
              ? ` · Rüstungsbrechend −${res.armorBreakUsed}`
              : ''
          const auPart = res.aufspiessenArmorLoss
            ? ` · Aufspießen: −1 RW dauerhaft`
            : ''
          damageApplyResult.value = isHeal
            ? `+${res.applied} HP an ${target.name} (${res.oldHp} → ${res.hp}/${res.hpMax}).`
            : `−${res.applied} HP an ${target.name}${armorPart}${rbPart}${auPart} (${res.oldHp} → ${res.hp}/${res.hpMax}).`
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
    // Krit-Flag aber AUFRAEUMEN, damit der naechste Schadenswurf nicht aus
    // Versehen wieder verdoppelt wird (HTBaH: Krit gilt nur fuer den EINEN
    // Treffer aus der Krit-Probe).
    if (!isHeal && probeResultLast.value?.critical) {
      probeResultLast.value = null
    }
    setTimeout(() => (damageSuccess.value = false), 2200)
  } catch (e: unknown) {
    damageError.value = (e as { statusMessage?: string }).statusMessage ?? 'Wurf fehlgeschlagen.'
  } finally {
    damageSending.value = false
  }
}

// --- Verwendbare Gegenstaende (Heiltrank, Erste-Hilfe-Paket, …) ---
// Liste nur fuer HtbaH-Charaktere mit gepflegten Items. Items mit
// quantity <= 0 werden nicht mehr angeboten.
const characterUsableItems = computed<HtbahUsableItem[]>(() => {
  if (!htbahData.value) return []
  return (htbahData.value.usableItems ?? []).filter(
    (i: HtbahUsableItem) => i.name?.trim() && i.quantity > 0,
  )
})
// Pro Item ein eigenes Ziel-Token-Ref (key = item.id), damit der Spieler
// pro Item separat Ziel waehlen kann.
const usableTargetByItem = ref<Record<string, number>>({})
// Default: erstes eigenes Token (oder das aktive Token).
const defaultUsableTargetId = computed<number>(() => activeToken.value?.id ?? 0)
const getItemTarget = (itemId: string): number =>
  usableTargetByItem.value[itemId] ?? defaultUsableTargetId.value
const setItemTarget = (itemId: string, tokenId: number) => {
  usableTargetByItem.value = { ...usableTargetByItem.value, [itemId]: tokenId }
}

const usingItemId = ref<string | null>(null)
const itemUseError = ref<string | null>(null)
const itemUseResult = ref<string | null>(null)

const useItem = async (item: HtbahUsableItem) => {
  if (!character.value || !htbahData.value) return
  const healAmount = Math.max(0, Math.floor(item.healAmount))
  const manaAmount = Math.max(0, Math.floor(item.manaAmount ?? 0))
  if (healAmount <= 0 && manaAmount <= 0) {
    itemUseError.value =
      'Weder Heilwert noch Mana-Wert gepflegt — bitte am Charakterbogen mind. einen Wert eintragen.'
    return
  }
  const targetId = getItemTarget(item.id)
  const target = damageTargetTokens.value.find((t: Token) => t.id === targetId) ?? null
  if (!target) {
    itemUseError.value = 'Bitte ein Ziel waehlen.'
    return
  }
  usingItemId.value = item.id
  itemUseError.value = null
  itemUseResult.value = null
  try {
    const resultLines: string[] = []

    // 1) Chat-Nachricht: ein einziger Eintrag fuer das Item, der Heilwert
    //    UND/ODER Mana-Wert kompakt nennt. modifier = healAmount (RollCard
    //    benutzt das fuer "Effekt: N"); Mana fliesst nur ins Label.
    const labelParts: string[] = [`Verwende ${item.name}`]
    if (healAmount > 0) labelParts.push(`✚${healAmount} HP`)
    if (manaAmount > 0) labelParts.push(`✦${manaAmount} Mana`)
    await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount: 0,
        diceSides: 1,
        modifier: healAmount || manaAmount,
        label: labelParts.join(' · '),
        system: 'htbah',
        characterId: character.value.id,
        targetTokenId: target.id,
        damageKind: 'heal',
      },
    })

    // 2a) HP heilen, wenn der Gegenstand einen Heilwert hat UND das Ziel
    //     HP gepflegt hat.
    if (healAmount > 0) {
      if (target.hp !== null && target.hpMax !== null && target.hpMax !== undefined) {
        const res = (await $fetch(
          `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${target.id}/apply-damage`,
          { method: 'POST', body: { amount: healAmount, kind: 'heal' } },
        )) as { oldHp: number; hp: number; hpMax: number; applied: number }
        target.hp = res.hp
        resultLines.push(
          `+${res.applied} HP an ${target.name} (${res.oldHp} → ${res.hp}/${res.hpMax})`,
        )
      } else {
        resultLines.push(`${healAmount} HP nicht angerechnet — ${target.name} hat keine HP gepflegt`)
      }
    }

    // 2b) Mana auffuellen, wenn der Gegenstand einen Mana-Wert hat. Server
    //     prueft selbst, ob das Ziel HtbaH-Charakter mit Magie ist; sonst
    //     wird `applied: 0` zurueckgegeben (kein harter Fehler).
    if (manaAmount > 0) {
      const res = (await $fetch(
        `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${target.id}/apply-mana`,
        { method: 'POST', body: { amount: manaAmount, kind: 'restore' } },
      )) as { applied: number; mana: number; manaMax: number; oldMana: number; charSystem: string | null }
      if (res.applied > 0) {
        resultLines.push(
          `+${res.applied} Mana an ${target.name} (${res.oldMana} → ${res.mana}/${res.manaMax})`,
        )
      } else {
        resultLines.push(
          `${manaAmount} Mana nicht angerechnet — ${target.name} hat kein aktives Magie-Modul`,
        )
      }
    }

    itemUseResult.value = resultLines.join(' · ')
    emit('token-updated')

    // 3) Anzahl am Charakter um 1 verringern.
    //
    // WICHTIG: Wenn das Ziel UNSER Charakter war, hat apply-damage /
    // apply-mana am Server bereits frische HP / Mana geschrieben. Unser
    // lokales `character.value` (und damit `htbahData.value`) ist aber noch
    // der Vor-Heilungs-Snapshot — wuerden wir den naiv mit nur quantity−1
    // zurueckschreiben, ueberschriebe der PUT die frischen Werte wieder.
    // Daher hier vor dem PUT einmal frisch laden, damit der Decrement auf
    // dem aktuellen Server-Stand sitzt.
    if (target.characterId === character.value.id && (healAmount > 0 || manaAmount > 0)) {
      const refreshed = await $fetch<{ character: CharacterFull }>(
        `/api/characters/${character.value.id}`,
      )
      character.value = refreshed.character
      cacheByCharId.set(character.value.id, refreshed.character)
    }
    const nextData: HtbahCharacterData = JSON.parse(JSON.stringify(htbahData.value))
    const list = nextData.usableItems ?? []
    const existing = list.find((x: HtbahUsableItem) => x.id === item.id)
    if (existing) {
      existing.quantity = Math.max(0, existing.quantity - 1)
      nextData.usableItems = list
      const putRes = (await $fetch(`/api/characters/${character.value.id}`, {
        method: 'PUT',
        body: { data: nextData },
      })) as { character: CharacterFull }
      if (putRes.character) {
        character.value = putRes.character
        cacheByCharId.set(character.value.id, putRes.character)
      }
    }

    setTimeout(() => (itemUseResult.value = null), 3500)
  } catch (e: unknown) {
    itemUseError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Gegenstand konnte nicht verwendet werden.'
  } finally {
    usingItemId.value = null
  }
}

const rollSending = ref(false)
const rollError = ref<string | null>(null)
const rollSuccess = ref(false)

// --- Initiative-Wurf (Spieler) ---
// SL gibt Initiative-Anfrage frei → `awaitingInitiativeFor` enthaelt die
// characterId des Spielers → roter Button erscheint, Klick wuerfelt
// server-seitig 1W10 + Handeln und schreibt das Ergebnis in den
// Initiative-Tracker des SL.
const initShowButton = computed(() => {
  if (!isHtbah.value) return false
  const charId = character.value?.id
  if (!charId) return false
  return (props.awaitingInitiativeFor ?? []).includes(charId)
})
const initRolling = ref(false)
const initError = ref<string | null>(null)
const initLastResult = ref<{ total: number; die: number; bonus: number } | null>(null)
const rollInitiative = async () => {
  if (!character.value || !isHtbah.value) return
  initRolling.value = true
  initError.value = null
  try {
    // Stangenwaffe (+10 Initiative, §5.2.1): nur wenn der Spieler aktuell eine
    // Stangenwaffe als „ausgeruestet" markiert hat.
    const stangenwaffe = !!selectedWeapon.value?.properties?.stangenwaffe
    const res = (await $fetch(`/api/groups/${props.groupId}/initiative/roll`, {
      method: 'POST',
      body: {
        characterId: character.value.id,
        stangenwaffe: stangenwaffe || undefined,
      },
    })) as { rolled: number; die: number; handelnBonus: number; stangenwaffeBonus?: number }
    initLastResult.value = {
      total: res.rolled,
      die: res.die,
      bonus: res.handelnBonus + (res.stangenwaffeBonus ?? 0),
    }
  } catch (e: unknown) {
    initError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Initiative-Wurf fehlgeschlagen.'
  } finally {
    initRolling.value = false
  }
}

// --- Parade/Ausweichen-Wurf (Spieler) ---
// Regelwerk §2.4: Einmal pro Runde, Wurf auf Handeln ODER passende Fertigkeit
// (Ausweichen, Parieren, Blocken). Der Button oeffnet ein Popup mit allen
// passenden Skills sowie der Handeln-Begabungsprobe als Fallback.
const paradeOpen = ref(false)
const paradeOptions = computed<Array<{ id: string; label: string; kind: 'talent' | 'skill' }>>(() => {
  if (!isHtbah.value || !htbahData.value) return []
  const out: Array<{ id: string; label: string; kind: 'talent' | 'skill' }> = []
  // Handeln-Begabung immer als Default.
  out.push({
    id: 'handeln',
    label: `Handeln (Begabung · ${htbahTalentValue(htbahData.value, 'handeln')})`,
    kind: 'talent',
  })
  // Skills, deren Name nach Parade/Ausweichen/Block/Parier riecht.
  const re = /pari|ausweich|block|parade/i
  for (const s of htbahData.value.skills) {
    if (!s.name?.trim() || !re.test(s.name)) continue
    out.push({
      id: s.id,
      label: `${s.name} (FW ${htbahSkillTotal(htbahData.value, s)})`,
      kind: 'skill',
    })
  }
  return out
})
const paradeRolling = ref(false)
const paradeError = ref<string | null>(null)

// --- Kampfmanoever (§4.1) ---
// Setzt rollMod + Notiz vor — der Spieler klickt danach nur noch „Wuerfeln".
const maneuverOpen = ref(false)
interface Maneuver {
  id: string
  label: string
  modifier: number
  note: string
}
const HTBAH_MANEUVERS: Maneuver[] = [
  { id: 'sturmangriff', label: 'Sturmangriff', modifier: -20, note: 'Sturmangriff: 3× Bewegung, dann Angriff (−20)' },
  { id: 'vorbeilaufen', label: 'Angriff im Vorbeilaufen', modifier: -10, note: 'Angriff im Vorbeilaufen (−10) — Gegner bekommt Gelegenheitsangriff' },
  { id: 'entwaffnen', label: 'Entwaffnen', modifier: 0, note: 'Entwaffnen — bei Erfolg Waffe fallen; Krit = Waffe übernommen' },
  { id: 'zufall', label: 'Zu Fall bringen', modifier: 0, note: 'Zu Fall bringen — bei Erfolg Ziel liegend; Krit = +1W10 Schaden' },
  { id: 'ringen', label: 'Ringkampf', modifier: 10, note: 'Ringkampf (+10 wenn beidhändig) — beide werden Ringend' },
  { id: 'zerstoeren', label: 'Gegenstand zerstören', modifier: 0, note: 'Gegenstand zerstören — Schaden geht aufs Objekt; Krit = sofort zerstört' },
]
// Battlebuben: Zwei-Waffen-Kampf. Haupthand −20, Nebenhand −40.
const HTBAH_BB_MANEUVERS: Maneuver[] = [
  { id: 'bb-haupthand', label: `Zwei Waffen — Haupthand (${HTBAH_BB_DUAL_WIELD.mainHand})`, modifier: HTBAH_BB_DUAL_WIELD.mainHand, note: `Zwei-Waffen-Kampf: Angriff mit der Haupthand (${HTBAH_BB_DUAL_WIELD.mainHand})` },
  { id: 'bb-nebenhand', label: `Zwei Waffen — Nebenhand (${HTBAH_BB_DUAL_WIELD.offHand})`, modifier: HTBAH_BB_DUAL_WIELD.offHand, note: `Zwei-Waffen-Kampf: folgender Angriff mit der Nebenhand (${HTBAH_BB_DUAL_WIELD.offHand})` },
]
// Im Battlebuben-Modus stehen die Zwei-Waffen-Manoever zusaetzlich bereit.
const maneuvers = computed<Maneuver[]>(() =>
  isBattlebuben.value ? [...HTBAH_MANEUVERS, ...HTBAH_BB_MANEUVERS] : HTBAH_MANEUVERS,
)
const applyManeuver = (m: Maneuver) => {
  rollMod.value = m.modifier
  rollNote.value = m.note
  maneuverOpen.value = false
}

// --- Battlebuben: Regeneration & Heilkunde (freie Wuerfe in den Chat) ---
const regenOpen = ref(false)
const regenRolling = ref(false)
type RegenKind = keyof typeof HTBAH_BB_REGEN
const rollRegen = async (kind: RegenKind) => {
  if (!isBattlebuben.value || !character.value) return
  const r = HTBAH_BB_REGEN[kind]
  regenRolling.value = true
  try {
    await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount: r.count,
        diceSides: r.sides,
        label: `Battlebuben — ${r.label}`,
        system: 'htbah',
        characterId: character.value.id,
      },
    })
    regenOpen.value = false
  } catch {
    // Chat-Eintrag nicht-kritisch.
  } finally {
    regenRolling.value = false
  }
}

// --- Magie-Modul (§8) — Komplexitaetswurf-Quick-Cast ---
const hasMagic = computed(
  () => isHtbah.value && !!htbahData.value?.magicState?.active,
)
const magicModule = computed(() => htbahData.value?.magicState?.module ?? 'zauberei')
const mana = computed(() => htbahData.value?.magicState?.mana ?? 0)
const arkanum = computed(() => htbahData.value?.magicState?.arkanum ?? 0)
const manaMax = computed(() => htbahManaMax(arkanum.value))
const sonnenKonzentration = computed(
  () => htbahData.value?.magicState?.sonnenKonzentration ?? 70,
)
const seeleVerbraucht = computed(
  () => htbahData.value?.magicState?.seeleVerbraucht ?? 0,
)
// Regel der Drei + Universalkampf-Flags
const isRdd = computed(() => isHtbah.value && !!htbahData.value?.rdd?.active)
const rddState = computed(() => htbahData.value?.rdd ?? null)
const isUniversalCombat = computed(
  () => isHtbah.value && htbahData.value?.combatModule === 'universal',
)

// --- Battlebuben-Magie — Quick-Cast ---
const isBattlebubenMagic = computed(
  () => hasMagic.value && magicModule.value === 'battlebuben',
)
const bbArkanumCurrent = computed(() => htbahData.value?.magicState?.bbArkanumCurrent ?? 0)
const bbArkanumMax = computed(() => htbahData.value?.magicState?.bbArkanumMax ?? 0)
// Gelernte Battlebuben-Zauber (Katalog-Eintraege), nach Stil + Level sortiert.
const bbKnownSpells = computed<BattlebubenSpell[]>(() => {
  const keys = htbahData.value?.magicState?.bbKnownSpellKeys ?? []
  return keys
    .map((k: string) => BATTLEBUBEN_SPELL_BY_KEY[k])
    .filter((sp: BattlebubenSpell | undefined): sp is BattlebubenSpell => !!sp)
    .sort(
      (a: BattlebubenSpell, b: BattlebubenSpell) =>
        a.stil.localeCompare(b.stil) || a.level - b.level || a.name.localeCompare(b.name),
    )
})
const bbSelectedKey = ref<string>('')
const bbSpellOptions = computed(() =>
  bbKnownSpells.value.map((sp: BattlebubenSpell) => {
    const meta = battlebubenSpellMeta(sp)
    return {
      label: `${BATTLEBUBEN_STIL_LABELS[sp.stil]} · L${sp.level} · ${sp.name} (${meta.arkanum} Ark.)`,
      value: sp.key,
    }
  }),
)
const bbSelectedSpell = computed<BattlebubenSpell | null>(
  () => BATTLEBUBEN_SPELL_BY_KEY[bbSelectedKey.value] ?? null,
)
const bbSelectedMeta = computed(() =>
  bbSelectedSpell.value ? battlebubenSpellMeta(bbSelectedSpell.value) : null,
)
const bbCastSending = ref(false)
const bbCastError = ref<string | null>(null)
const bbLastResult = ref<{
  success: boolean
  critical: boolean
  fumble: boolean
  qsLabel: string
  roll: number
  target: number
  effectParts: BattlebubenEffectPart[]
  selfDamage: number
  arkanum: number
  arkanumMax: number
} | null>(null)
// Reset bei Charakter-Wechsel.
watch(selectedTokenId, () => {
  bbSelectedKey.value = ''
  bbLastResult.value = null
  bbCastError.value = null
})
const castBattlebubenSpell = async () => {
  if (!character.value || !isBattlebubenMagic.value) return
  const spell = bbSelectedSpell.value
  if (!spell) {
    bbCastError.value = 'Kein Zauber gewählt.'
    return
  }
  bbCastSending.value = true
  bbCastError.value = null
  try {
    const res = (await $fetch(`/api/groups/${props.groupId}/magic/cast-bb`, {
      method: 'POST',
      body: { characterId: character.value.id, spellKey: spell.key },
    })) as {
      success: boolean
      critical: boolean
      fumble: boolean
      qsLabel: string
      roll: number
      target: number
      effectParts: BattlebubenEffectPart[]
      selfDamage: number
      arkanum: number
      arkanumMax: number
    }
    bbLastResult.value = res
    // Charakter neu laden — Arkanum-Pool (+ ggf. LP) wurden serverseitig geaendert.
    const updated = await $fetch<{ character: CharacterFull }>(
      `/api/characters/${character.value.id}`,
    )
    character.value = updated.character
  } catch (e: unknown) {
    bbCastError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Wirken fehlgeschlagen.'
  } finally {
    bbCastSending.value = false
  }
}

const castOpen = ref(false)
const castSpellName = ref('')
const castSpellLevel = ref<1 | 2 | 3 | 4 | 5>(1)
const castLehre = ref('')
// Gelernte Spruechen (aus magicState.knownSpellKeys) als Auswahloptionen
// fuer den Quick-Cast. Wenn keine Sprueche gelernt sind, faellt das Popup
// auf den freien Eingabemodus zurueck (castSpellName).
type HtbahCatalogEntry = (typeof HTBAH_SPELL_BY_KEY)[string]
const knownSpellOptions = computed<HtbahCatalogEntry[]>(() => {
  const keys = htbahData.value?.magicState?.knownSpellKeys ?? []
  return keys
    .map((k: string) => HTBAH_SPELL_BY_KEY[k])
    .filter((s: HtbahCatalogEntry | undefined): s is HtbahCatalogEntry => !!s)
})
const selectedKnownKey = ref<string>('')
watch(selectedKnownKey, (key: string) => {
  if (!key) return
  const spell = HTBAH_SPELL_BY_KEY[key]
  if (!spell) return
  castSpellName.value = spell.name
  castSpellLevel.value = spell.stufe
  castLehre.value = spell.lehre
})
const castSending = ref(false)
const castError = ref<string | null>(null)
const castLastResult = ref<{
  rolls: [number, number, number]
  sum: number
  threshold: number
  success: boolean
  critSuccess: boolean
  critFumble: boolean
  manaCost: number
  manaAfter: number
} | null>(null)

// --- Ziele + Schaden/Heilung beim Zauber-Wirken ---
// Bei mehreren Zielen wird pro Ziel die HP angepasst. Wenn der Spieler
// "pro Ziel separat würfeln" aktiviert, rollt jeder Treffer einzeln (z.B.
// Sturm-Lichtbogen, der pro Sprung anders skaliert). Sonst gilt ein Wurf
// fuer alle (klassische AoE wie "3W10 auf alle im 5 m Radius").
const castTargetIds = ref<number[]>([])
const castDamageFormula = ref<string>('')
const castDamageMode = ref<'damage' | 'heal'>('damage')
const castDamagePerTarget = ref<boolean>(false)
const castDamageApplyResults = ref<string[]>([])
// Reset bei Tab-Wechsel — sonst trägt der nächste Charakter Ziele aus dem
// vorigen Turn mit.
watch(selectedTokenId, () => {
  castTargetIds.value = []
  castDamageFormula.value = ''
  castDamageMode.value = 'damage'
  castDamagePerTarget.value = false
  castDamageApplyResults.value = []
  castLastResult.value = null
})
// Auto-Fuell: Wenn ein Katalog-Spruch gewaehlt ist, extrahiere das erste
// "NW10±X"-Muster aus der Effekt-Beschreibung. Heilzauber (Lehre Genesung)
// landen direkt im Heil-Modus. Frei eintippen bleibt moeglich.
watch(selectedKnownKey, (key: string) => {
  if (!key || key === '__free__') {
    return
  }
  const spell = HTBAH_SPELL_BY_KEY[key]
  if (!spell) return
  const m = spell.effect.match(/(\d+)\s*[wW]\s*(\d+)\s*([+-]\s*\d+)?/)
  castDamageFormula.value = m
    ? `${m[1]}W${m[2]}${m[3] ? m[3].replace(/\s+/g, '') : ''}`
    : ''
  castDamageMode.value = spell.lehre === 'genesung' ? 'heal' : 'damage'
})
// Damage-Formel-Parser fuer den Cast-Popup. Schon bekannter Regex aus dem
// unteren Schaden-Wuerfler — duplikat-frei zu halten, aber bewusst lokal,
// damit das Komplexwurf-Popup auch ohne ausgefuellten Damage-Roller laeuft.
const castDamageParsed = computed<{ count: number; sides: number; mod: number } | null>(() => {
  const m = castDamageFormula.value.trim().match(/^(\d+)\s*[dwDW]\s*(\d+)\s*([+-]\s*\d+)?$/)
  if (!m) return null
  const count = parseInt(m[1]!, 10)
  const sides = parseInt(m[2]!, 10)
  const mod = m[3] ? parseInt(m[3].replace(/\s+/g, ''), 10) : 0
  if (count < 1 || count > 20) return null
  if (sides < 2 || sides > 1000) return null
  return { count, sides, mod }
})
const castTargetOptions = computed(() =>
  damageTargetTokens.value.map((t: Token) => {
    const hpStr = t.hp !== null && t.hpMax ? ` · ${t.hp}/${t.hpMax}` : ''
    return { label: `${t.name}${hpStr}${distanceLabel(t)}`, value: t.id }
  }),
)
// — Spruch-Reichweite —
// Katalog-Spruechen kennen einen Reichweitentext ("Berührung", "50 m",
// "Sicht"). Wir parsen ihn in Tiles und pruefen pro ausgewaehltem Ziel.
// Bei freier Spruch-Eingabe (kein knownSpell gewaehlt) gibt es keine
// automatische Pruefung — der Spieler soll dann frei wirken koennen.
const castSpellRangeTiles = computed<number | null>(() => {
  const key = selectedKnownKey.value
  if (!key || key === '__free__') return null
  const spell = HTBAH_SPELL_BY_KEY[key]
  if (!spell) return null
  return parseHtbahRangeTiles(spell.range)
})
const castOutOfRangeTargets = computed<Token[]>(() => {
  const range = castSpellRangeTiles.value
  if (range === null) return []
  const out: Token[] = []
  for (const id of castTargetIds.value) {
    const t = damageTargetTokens.value.find((x: Token) => x.id === id)
    if (!t) continue
    const dist = distanceToToken(t)
    if (dist === null) continue
    if (dist > range) out.push(t)
  }
  return out
})
const castReachBlocked = computed<boolean>(
  () => castOutOfRangeTargets.value.length > 0 && !props.isDm,
)
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1
}
function rollFormula(p: { count: number; sides: number; mod: number }): {
  dice: number[]
  total: number
} {
  const dice: number[] = []
  for (let i = 0; i < p.count; i++) dice.push(rollDie(p.sides))
  const total = dice.reduce((a, b) => a + b, 0) + p.mod
  return { dice, total: Math.max(0, total) }
}

// Seelensplittermagie (§8.13.3) — Auto-Vision-Wurf vor jedem Cast.
// Regel: W100 ≤ seeleVerbraucht% = Schreckens-/Todesvision. Wird vor dem
// Komplexwurf serverlos gewuerfelt; wenn er ausloest, posten wir eine
// rote Chat-Card und merken das Ergebnis fuer die UI. Der Cast laeuft
// trotzdem (Spieler entscheidet im nachhinein, ob die Vision den
// Spielzug abbricht — RAW gibt nur den Trigger vor, nicht die Konsequenz).
const isSeelensplitter = computed(
  () => hasMagic.value && magicModule.value === 'seelensplitter',
)
const lastVisionResult = ref<{ roll: number; threshold: number; triggered: boolean } | null>(null)
const rollSeelensplitterVision = async (): Promise<{ triggered: boolean }> => {
  if (!isSeelensplitter.value || !character.value) return { triggered: false }
  const threshold = seeleVerbraucht.value
  const roll = Math.floor(Math.random() * 100) + 1
  const triggered = roll <= threshold
  lastVisionResult.value = { roll, threshold, triggered }
  // Chat-Card: ein freier 1W100 mit explizitem Label, damit der DM sieht,
  // ob die Vision wirklich ausgeloest hat. modifier=0, kein Schaden.
  try {
    await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body: {
        kind: 'free',
        diceCount: 1,
        diceSides: 100,
        label: triggered
          ? `💀 Seelensplitter-Vision AUSGELÖST (W100=${roll} ≤ ${threshold}%)`
          : `Seelensplitter-Vision-Check (W100=${roll} > ${threshold}% — bestanden)`,
        system: 'htbah',
        characterId: character.value.id,
      },
    })
  } catch {
    // Chat-Eintrag scheitert nicht-kritisch — der lokale Indikator reicht.
  }
  return { triggered }
}

const detectMagicSending = ref(false)
const detectMagic = async () => {
  if (!character.value || !hasMagic.value) return
  detectMagicSending.value = true
  try {
    await $fetch(`/api/groups/${props.groupId}/magic/detect`, {
      method: 'POST',
      body: { characterId: character.value.id },
    })
  } catch (e: unknown) {
    castError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Magie-Erkennen fehlgeschlagen.'
  } finally {
    detectMagicSending.value = false
  }
}

const dispelMagicSending = ref(false)
const dispelMagic = async () => {
  if (!character.value || !hasMagic.value) return
  if (mana.value < 1) {
    castError.value = 'Nicht genug Mana (1 benötigt).'
    return
  }
  dispelMagicSending.value = true
  try {
    await $fetch(`/api/groups/${props.groupId}/magic/dispel`, {
      method: 'POST',
      body: { characterId: character.value.id },
    })
    // Char neu laden — Mana wurde abgezogen.
    if (character.value) {
      const updated = await $fetch<{ character: CharacterFull }>(
        `/api/characters/${character.value.id}`,
      )
      character.value = updated.character
    }
  } catch (e: unknown) {
    castError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Magie-Bannen fehlgeschlagen.'
  } finally {
    dispelMagicSending.value = false
  }
}

const castSpell = async () => {
  if (!character.value || !hasMagic.value) return
  if (!castSpellName.value.trim()) {
    castError.value = 'Spruchname fehlt.'
    return
  }
  castSending.value = true
  castError.value = null
  castDamageApplyResults.value = []
  try {
    // Seelensplittermagie: vor dem Komplexwurf den Vision-Check rollen.
    // Triggert eine Schreckens-/Todesvision (Chat-Card), aber der Cast
    // laeuft trotzdem — die DM-Konsequenz traegt der Spielleiter manuell ein.
    if (isSeelensplitter.value) {
      await rollSeelensplitterVision()
    }
    const res = (await $fetch(`/api/groups/${props.groupId}/magic/cast`, {
      method: 'POST',
      body: {
        characterId: character.value.id,
        spellName: castSpellName.value.trim(),
        spellLevel: castSpellLevel.value,
        lehre: castLehre.value.trim() || undefined,
      },
    })) as {
      result: {
        rolls: [number, number, number]
        sum: number
        threshold: number
        success: boolean
        critSuccess: boolean
        critFumble: boolean
        manaCost: number
      }
      mana: number
      manaMax: number
    }
    castLastResult.value = {
      rolls: res.result.rolls,
      sum: res.result.sum,
      threshold: res.result.threshold,
      success: res.result.success,
      critSuccess: res.result.critSuccess,
      critFumble: res.result.critFumble,
      manaCost: res.result.manaCost,
      manaAfter: res.mana,
    }
    // Charakter neu laden, damit der angezeigte Mana-Wert direkt aktualisiert.
    if (character.value) {
      const updated = await $fetch<{ character: CharacterFull }>(
        `/api/characters/${character.value.id}`,
      )
      character.value = updated.character
    }

    // — Schaden/Heilung an gewaehlte Ziele anwenden —
    // Greift nur bei Erfolg (inkl. Krit-Erfolg) und wenn eine gueltige
    // NdM±X-Formel + mind. ein Ziel vorhanden sind. Bei mehreren Zielen wird
    // pro Token entweder dieselbe Summe (Standard, klassisches AoE) oder ein
    // eigener Wurf (toggle "pro Ziel würfeln") verwendet. Jeder Treffer
    // postet eine eigene Chat-Roll-Card und ruft apply-damage auf, damit
    // Ruestung/Heilung serverseitig korrekt verrechnet werden.
    const dmgParsed = castDamageParsed.value
    if (
      (res.result.success || res.result.critSuccess) &&
      dmgParsed &&
      castTargetIds.value.length > 0
    ) {
      const isHeal = castDamageMode.value === 'heal'
      const sys = 'htbah' as const
      // Bei "ein Wurf für alle" einmal rollen — dasselbe Wuerfel-Array geht
      // in jede RollCard, damit der Chat-Eintrag identisch und nachvollziehbar
      // ist (Spieler sehen: "Erdwall 3W10 = 17 — Ziel A: 17, Ziel B: 17").
      let sharedRoll: { dice: number[]; total: number } | null = null
      if (!castDamagePerTarget.value) sharedRoll = rollFormula(dmgParsed)
      const results: string[] = []
      for (const tId of castTargetIds.value) {
        const target = damageTargetTokens.value.find((t: Token) => t.id === tId)
        if (!target) continue
        const r = sharedRoll ?? rollFormula(dmgParsed)
        const targetSuffix = ` → ${target.name}`
        const label = `${castSpellName.value.trim()}${targetSuffix}`
        try {
          // Wurf in den Chat schreiben — kein neuer Server-Wurf, sondern die
          // hier rollten Wuerfel als "free roll" weiterreichen. diceCount=0
          // signalisiert dem Roll-Endpunkt: bitte keine eigenen Wuerfel
          // rollen, nur das uebergebene Ergebnis publizieren. Wenn das Backend
          // diesen Sonderfall nicht kennt, wird der Wurf trotzdem korrekt
          // dargestellt (die Summe steht im Label).
          await $fetch(`/api/groups/${props.groupId}/rolls`, {
            method: 'POST',
            body: {
              kind: 'free',
              diceCount: dmgParsed.count,
              diceSides: dmgParsed.sides,
              modifier: dmgParsed.mod || undefined,
              label,
              system: sys,
              characterId: character.value?.id,
              targetTokenId: target.id,
              damageKind: isHeal ? 'heal' : 'damage',
            },
          })
        } catch {
          // Chat-Eintrag scheitert nicht-kritisch — HP-Anwendung trotzdem
          // versuchen, damit der Spielzug nicht in der Luft haengen bleibt.
        }
        if (target.hp === null || target.hpMax === null || target.hpMax === undefined) {
          results.push(`${target.name}: Wurf ${r.total} — keine HP gepflegt`)
          continue
        }
        try {
          const apply = (await $fetch(
            `/api/groups/${props.groupId}/maps/${props.mapId}/tokens/${target.id}/apply-damage`,
            {
              method: 'POST',
              body: { amount: r.total, kind: isHeal ? 'heal' : 'damage' },
            },
          )) as {
            oldHp: number
            hp: number
            hpMax: number
            absorbed: number
            applied: number
          }
          target.hp = apply.hp
          const armorPart = apply.absorbed > 0 ? ` (Rüstung ${apply.absorbed})` : ''
          results.push(
            isHeal
              ? `${target.name}: +${apply.applied} HP (${apply.oldHp}→${apply.hp}/${apply.hpMax})`
              : `${target.name}: −${apply.applied} HP${armorPart} (${apply.oldHp}→${apply.hp}/${apply.hpMax})`,
          )
        } catch (err: unknown) {
          results.push(
            `${target.name}: ${(err as { statusMessage?: string }).statusMessage ?? 'HP-Update fehlgeschlagen'}`,
          )
        }
      }
      castDamageApplyResults.value = results
      emit('token-updated')
    }
  } catch (e: unknown) {
    castError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Zauberwurf fehlgeschlagen.'
  } finally {
    castSending.value = false
  }
}
const paradeRoll = async (id: string, kind: 'talent' | 'skill') => {
  if (!character.value || !isHtbah.value) return
  paradeRolling.value = true
  paradeError.value = null
  try {
    // Mod-Komponenten:
    //  - Rüstungs-Parade-Bonus (§6.2.3): +RW
    //  - Schwert-Sonderregel (§5.2.1): +5 wenn gerade eine Schwert-Waffe gewählt ist
    const armorBonus = htbahData.value ? htbahArmorParadeBonus(htbahData.value) : 0
    const schwertBonus = selectedWeapon.value?.properties?.schwert ? 5 : 0
    const totalMod = armorBonus + schwertBonus
    const noteParts = ['Parade/Ausweichen']
    if (armorBonus) noteParts.push(`Rüstung +${armorBonus}`)
    if (schwertBonus) noteParts.push(`Schwert +5`)
    const finalNote = noteParts.join(' · ')
    const body =
      kind === 'talent'
        ? {
            kind: 'htbahTalent' as const,
            characterId: character.value.id,
            talent: id as HtbahTalent,
            modifier: totalMod || undefined,
            note: finalNote,
          }
        : {
            kind: 'htbahSkill' as const,
            characterId: character.value.id,
            skillId: id,
            modifier: totalMod || undefined,
            note: finalNote,
          }
    await $fetch(`/api/groups/${props.groupId}/rolls`, { method: 'POST', body })
    paradeOpen.value = false
  } catch (e: unknown) {
    paradeError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Parade-Wurf fehlgeschlagen.'
  } finally {
    paradeRolling.value = false
  }
}
/**
 * Letztes Probe-Ergebnis (Krit ja/nein) — wird beim htbahSkill-Wurf gesetzt
 * und vom Schadensanwender ausgewertet, damit "Aufspießen + Krit"
 * automatisch −1 RW dauerhaft am Ziel anrichtet.
 */
const probeResultLast = ref<{ critical: boolean } | null>(null)
watch(selectedTokenId, () => {
  probeResultLast.value = null
})

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
    let body: Record<string, unknown> = {}
    switch (opt.kind) {
      case 'htbahSkill': {
        // Wenn der Spieler eine Waffe gewaehlt hat: Sonderregeln durchreichen.
        // Aufspiessen wirkt direkt im Krit-Bereich, Jagdwaffe nur, wenn das
        // Damage-Ziel gepflegt ist (Server berechnet RW-Schwelle).
        const w = selectedWeapon.value
        const wp = w?.properties ?? {}
        // Trefferwurf-Modifikator aus der Waffe (Flink/Genau − Grob/Schwer).
        // Wird HIER addiert, weil der Server das nicht aus der weaponId allein
        // rekonstruieren koennte (Properties leben am Char-Daten-JSON).
        const weaponAttack = htbahWeaponAttackBonus(w)
        // Zustands-Modifikatoren (§4.2 — Liegend/Blind/Veraengstigt/Verwirrt …)
        // werden aus den statusText-IDs des EIGENEN Tokens berechnet (Selbst-
        // Modifikator wirkt auf den Wurf der Figur) und ggf. aus dem Ziel
        // (targetVsAttack — Bonus auf Trefferwurf gegen liegendes / festgehaltenes Ziel).
        const selfMods = activeToken.value
          ? htbahConditionModsFromStatusText(activeToken.value.statusText)
          : null
        // selfAttack wirkt nur, wenn es ein Trefferwurf ist (Waffe ausgewaehlt).
        // selfMod wirkt auf JEDEN Skill-Wurf.
        const conditionSelfBonus = (selfMods?.selfMod ?? 0) + (w ? (selfMods?.selfAttack ?? 0) : 0)
        // Ziel-bezogener Modifikator (z.B. Liegend +20) nur bei Waffen-Trefferwurf
        // gegen ein gepflegtes Ziel.
        const targetTok = damageTargetId.value
          ? damageTargetTokens.value.find((t: Token) => t.id === damageTargetId.value) ?? null
          : null
        const targetMods = targetTok && w
          ? htbahConditionModsFromStatusText(targetTok.statusText)
          : null
        const conditionTargetBonus = targetMods?.targetVsAttack ?? 0
        const combinedModWithWeapon =
          (modifier ?? 0) + weaponAttack + conditionSelfBonus + conditionTargetBonus
        const noteParts: string[] = []
        if (note) noteParts.push(note)
        if (weaponAttack) noteParts.push(`Waffe ${weaponAttack > 0 ? '+' : ''}${weaponAttack}`)
        if (selfMods?.notes.length && (selfMods.selfMod !== 0 || (w && selfMods.selfAttack !== 0))) {
          noteParts.push(...selfMods.notes)
        }
        if (conditionTargetBonus !== 0 && targetMods) {
          // Markiere Ziel-Conditions sichtbar im Note-Feld
          noteParts.push(...targetMods.notes.map((n) => `Ziel: ${n}`))
        }
        const noteWithMods = noteParts.length ? noteParts.join(' · ') : undefined
        body = {
          kind: 'htbahSkill',
          characterId,
          skillId: opt.id,
          modifier: combinedModWithWeapon || undefined,
          note: noteWithMods,
          aufspiessen: wp.aufspiessen || undefined,
          huntingThreshold: wp.huntingThreshold || undefined,
          targetTokenId: damageTargetId.value || undefined,
        }
        break
      }
      case 'htbahTalent': {
        // Zustands-Modifikator auf JEDEN Wurf (§4.2 Verwirrt/Veraengstigt-Auswirkung).
        const selfMods = activeToken.value
          ? htbahConditionModsFromStatusText(activeToken.value.statusText)
          : null
        const conditionSelf = selfMods?.selfMod ?? 0
        const combinedMod = (modifier ?? 0) + conditionSelf
        const noteParts: string[] = []
        if (note) noteParts.push(note)
        if (conditionSelf !== 0 && selfMods?.notes.length) noteParts.push(...selfMods.notes)
        body = {
          kind: 'htbahTalent',
          characterId,
          talent: opt.id as HtbahTalent,
          modifier: combinedMod || undefined,
          note: noteParts.length ? noteParts.join(' · ') : undefined,
        }
        break
      }
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
    const res = (await $fetch(`/api/groups/${props.groupId}/rolls`, {
      method: 'POST',
      body,
    })) as { message?: { payload?: { critical?: boolean } | null } }
    // Probe-Krit tracken — wird vom Schadensanwender ausgewertet, wenn die
    // Waffe "Aufspießen" hat (dann beschaedigt der Krit die Ziel-Ruestung
    // dauerhaft um −1 RW).
    if (opt.kind === 'htbahSkill') {
      probeResultLast.value = { critical: !!res.message?.payload?.critical }
    }
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
    const oldCur = (nextData.currency as unknown as DnDCharacterData['currency']) ?? {
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
            v-if="activeToken.hpMax && !isRdd"
            class="mt-1 h-2 rounded bg-black/15 overflow-hidden"
          >
            <div
              class="h-full transition-all"
              :style="{ width: hpPercent + '%', background: hpColor }"
            />
          </div>
          <!-- Regel-der-Drei-Skalen statt LP-Bar -->
          <div v-if="isRdd && rddState" class="mt-1 space-y-0.5">
            <div
              v-for="scale in HTBAH_RDD_SCALES"
              :key="scale"
              class="flex items-center gap-2 text-[10px]"
            >
              <span class="w-24 truncate font-semibold">{{ HTBAH_RDD_SCALE_LABELS[scale] }}</span>
              <span class="font-mono">{{ rddState.current[scale] }}/{{ rddState.max[scale] }}</span>
              <div class="flex-1 h-1.5 rounded bg-black/15 overflow-hidden">
                <div
                  class="h-full transition-all"
                  :style="{
                    width: rddState.max[scale] > 0
                      ? Math.min(100, Math.round((rddState.current[scale] / rddState.max[scale]) * 100)) + '%'
                      : '0%',
                    background: scale === 'lebenspunkte' ? '#dc2626'
                      : scale === 'geistigeGesundheit' ? '#7c3aed'
                      : '#0284c7',
                  }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== CUSTOM-REGELWERK: Kampf-Block ===== -->
      <template v-if="isCustom">
        <div v-if="!customDef" class="text-xs text-ink-400 italic">Regelwerk wird geladen …</div>
        <template v-else>
          <!-- Ziel-Auswahl (für Schaden/Heilung an Token) -->
          <UFormField label="Ziel (für Schaden/Heilung)">
            <USelect
              v-model="damageTargetId"
              :items="[{ label: '— kein Ziel —', value: 0 }, ...damageTargetTokens.filter((t) => t.hpMax).map((t) => ({ label: `${t.name} (${t.hp}/${t.hpMax})`, value: t.id }))]"
              value-key="value"
              size="sm"
            />
          </UFormField>

          <!-- Magie -->
          <div v-if="customMagic && customData?.resources.mana" class="rounded border border-parchment-700/30 bg-white/40 p-2">
            <div class="flex items-center justify-between mb-1">
              <span class="font-serif text-sm flex items-center gap-1">
                <UIcon name="i-lucide-sparkles" class="size-3.5 text-[var(--color-accent)]" /> Magie
              </span>
              <span class="text-xs text-ink-400">{{ customMagic.resourceName }} {{ customData.resources.mana.current }}/{{ customData.resources.mana.max }}</span>
            </div>
            <div v-if="!customMagic.spells.length" class="text-[11px] text-ink-300 italic">Keine Zauber im Katalog.</div>
            <div v-else class="space-y-1">
              <div v-for="sp in customMagic.spells" :key="sp.id" class="flex items-center gap-2 text-xs">
                <span class="flex-1 truncate">{{ sp.name }} <span class="text-ink-300">· {{ sp.cost }} {{ customMagic.resourceName }}</span></span>
                <UButton
                  size="xs"
                  color="primary"
                  icon="i-lucide-wand-2"
                  :disabled="!!customData.resources.mana && customData.resources.mana.current < sp.cost"
                  @click="customCastSpell(sp)"
                >
                  Zaubern
                </UButton>
              </div>
            </div>
          </div>

          <!-- Kampf / Waffen -->
          <div v-if="customCombat" class="rounded border border-parchment-700/30 bg-white/40 p-2">
            <div class="font-serif text-sm flex items-center gap-1 mb-1">
              <UIcon name="i-lucide-swords" class="size-3.5 text-[var(--color-accent)]" /> Kampf
            </div>
            <div v-if="!customData?.weapons || !customData.weapons.length" class="text-[11px] text-ink-300 italic">
              Keine Waffen — leg welche auf dem Charakterbogen an.
            </div>
            <div v-else class="space-y-1">
              <div v-for="w in customData.weapons" :key="w.id" class="flex items-center gap-1.5 text-xs">
                <span class="flex-1 truncate">{{ w.name }} <span class="text-ink-300">· {{ w.damageFormula }} · {{ (w.range && w.range > 0) ? w.range : 1 }} Feld</span></span>
                <UButton size="xs" variant="outline" icon="i-lucide-dices" @click="customWeaponAttack(w)">Angriff</UButton>
                <UButton size="xs" color="error" variant="soft" icon="i-lucide-swords" @click="customWeaponDamage(w)">Schaden</UButton>
              </div>
            </div>
          </div>

          <!-- Probe -->
          <div class="rounded border border-parchment-700/30 bg-white/40 p-2">
            <div class="font-serif text-sm mb-1">Probe</div>
            <div class="flex items-end gap-2 flex-wrap">
              <USelect v-model="customProbeTargetKey" :items="customProbeTargets.map((t) => ({ label: t.label, value: t.value }))" value-key="value" size="xs" class="w-44" />
              <UInput v-if="customDef.dice.mechanic === 'roll-over'" v-model.number="customProbeDc" type="number" size="xs" class="w-16" />
              <UButton size="xs" color="primary" icon="i-lucide-dices" @click="customProbe">Würfeln</UButton>
            </div>
          </div>

          <p v-if="customResult" class="font-mono text-xs bg-[var(--color-accent-soft)] border border-[var(--color-accent)]/30 rounded px-2 py-1.5">
            {{ customResult }}
          </p>
        </template>
      </template>

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

      <!-- HP-Editor + schnell Schaden/Heilung -->
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

      <!-- Skill-/Begabungs-Würfler (HtbaH, D&D 5e/2024, DSA 5) — Talent-Proben -->
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
        <!-- DC-Presets (nur HtbaH) — setzen rollMod auf den Regelwerk-Wert
             fuer Erschwernis-Stufen. So muss der Spieler nicht jedes Mal die
             genaue Zahl raten. -->
        <div v-if="isHtbah" class="flex flex-wrap gap-1">
          <span class="text-[10px] uppercase tracking-widest text-ink-300 mr-1 self-center">
            Schwierigkeit:
          </span>
          <UButton
            v-for="preset in HTBAH_DC_PRESETS"
            :key="preset.id"
            size="xs"
            :variant="rollMod === preset.modifier ? 'solid' : 'outline'"
            :title="`${preset.label} (Mod ${preset.modifier > 0 ? '+' : ''}${preset.modifier})`"
            @click="rollMod = preset.modifier"
          >
            {{ preset.label }} {{ preset.modifier > 0 ? '+' : '' }}{{ preset.modifier }}
          </UButton>
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
            :disabled="!pickedRollOption || meleeBlocked"
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

      <!-- Quick-Actions: Initiative (nur wenn SL angefordert hat) und
           Parade/Ausweichen. Nur fuer HtbaH-Charaktere relevant. -->
      <div
        v-if="isHtbah && character"
        class="flex flex-wrap gap-2"
      >
        <UButton
          v-if="initShowButton"
          color="error"
          icon="i-lucide-dices"
          size="sm"
          :loading="initRolling"
          @click="rollInitiative"
        >
          Initiative würfeln!
        </UButton>
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-shield"
          size="sm"
          title="Parade/Ausweichen (Regelwerk §2.4)"
          @click="paradeOpen = !paradeOpen"
        >
          Parade/Ausweichen
        </UButton>
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-swords"
          size="sm"
          title="Kampfmanöver (Regelwerk §4.1) — setzt Modifier + Notiz vor"
          @click="maneuverOpen = !maneuverOpen"
        >
          Manöver
        </UButton>
        <UButton
          color="warning"
          variant="soft"
          icon="i-lucide-store"
          size="sm"
          title="Beim NPC-Händler einkaufen — Kosten werden vom Geld abgezogen, Gegenstand wandert ins Inventar"
          @click="shopOpen = true"
        >
          Einkaufen
        </UButton>
        <UButton
          v-if="isBattlebuben"
          color="success"
          variant="soft"
          icon="i-lucide-heart-pulse"
          size="sm"
          title="Battlebuben: natürliche Regeneration & Heilkunde würfeln"
          @click="regenOpen = !regenOpen"
        >
          Regeneration
        </UButton>
        <UButton
          v-if="hasMagic"
          color="primary"
          variant="soft"
          icon="i-lucide-sparkles"
          size="sm"
          :title="isBattlebubenMagic
            ? `Battlebuben-Magie — W100-Probe · Arkanum ${bbArkanumCurrent}/${bbArkanumMax}`
            : `Zauberei (§8) — Komplexitätswurf · Mana ${mana}/${manaMax}`"
          @click="castOpen = !castOpen"
        >
          Zaubern
          <span class="ml-1 font-mono text-[10px] opacity-80">
            <template v-if="isBattlebubenMagic">{{ bbArkanumCurrent }}/{{ bbArkanumMax }}</template>
            <template v-else>{{ mana }}/{{ manaMax }}</template>
          </span>
        </UButton>
        <div
          v-if="initLastResult"
          class="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 self-center"
        >
          Init: {{ initLastResult.die }} + {{ initLastResult.bonus }} = <strong>{{ initLastResult.total }}</strong>
        </div>
        <div v-if="initError" class="text-xs text-red-700 self-center">{{ initError }}</div>
      </div>

      <!-- Shop-Modal: Einkaufen beim NPC-Haendler (kauft fuer den aktiven
           Charakter; Geld wird abgezogen, Gegenstand wandert ins Inventar). -->
      <ShopModal
        v-if="character"
        v-model:open="shopOpen"
        :group-id="groupId"
        :buyer-character-id="character.id"
        :map-id="mapId"
        :grid-size="gridSize ?? 0"
        :tokens="damageTargetTokens"
        :token-merchants="tokenMerchants"
        @bought="onShopBought"
      />

      <!-- Parade-Auswahl-Popup: Handeln-Begabung + alle Skills, die nach Parade
           riechen. Direkt unter den Quick-Actions, damit der Klickfluss kurz ist. -->
      <div
        v-if="paradeOpen && isHtbah"
        class="p-2 rounded border border-parchment-700/30 bg-white/60 space-y-1"
      >
        <div class="text-[10px] uppercase tracking-widest text-ink-300 mb-1">
          Parade/Ausweichen — Womit?
        </div>
        <div
          v-for="opt in paradeOptions"
          :key="opt.id"
        >
          <UButton
            block
            size="xs"
            variant="outline"
            :loading="paradeRolling"
            @click="paradeRoll(opt.id, opt.kind)"
          >
            {{ opt.label }}
          </UButton>
        </div>
        <p v-if="!paradeOptions.length" class="text-[10px] text-ink-300 italic">
          Keine Skills/Begabungen verfuegbar.
        </p>
        <p v-if="paradeError" class="text-xs text-red-700">{{ paradeError }}</p>
        <p v-if="isBattlebuben" class="text-[10px] text-amber-700">
          Battlebuben: höhere QS gewinnt die Aktion (bei Gleichstand die Parade).
          Kritischer Erfolg = direkter Konterangriff mit 50 % Schaden.
        </p>
        <p v-else class="text-[10px] text-ink-300/80">
          Erfolg = kein Schaden. Krit. Angriffe und Schusswaffen sind nicht parierbar.
        </p>
      </div>

      <!-- Battlebuben: Regeneration & Heilkunde — postet einen freien Wurf
           (1W10 / 2W10 / +1W10 / 1W10+QS) in den Gruppen-Chat. -->
      <div
        v-if="regenOpen && isBattlebuben"
        class="p-2 rounded border border-emerald-300 bg-emerald-50/60 space-y-1"
      >
        <div class="text-[10px] uppercase tracking-widest text-emerald-700 mb-1">
          Regeneration & Heilkunde
        </div>
        <UButton block size="xs" variant="outline" :loading="regenRolling" @click="rollRegen('rest3h')">
          {{ HTBAH_BB_REGEN.rest3h.label }}
        </UButton>
        <UButton block size="xs" variant="outline" :loading="regenRolling" @click="rollRegen('rest6h')">
          {{ HTBAH_BB_REGEN.rest6h.label }}
        </UButton>
        <UButton block size="xs" variant="outline" :loading="regenRolling" @click="rollRegen('meals')">
          {{ HTBAH_BB_REGEN.meals.label }}
        </UButton>
        <UButton block size="xs" variant="outline" :loading="regenRolling" @click="rollRegen('heilkunde')">
          {{ HTBAH_BB_REGEN.heilkunde.label }}
        </UButton>
        <p class="text-[10px] text-ink-300/80">
          Heilkunde: erreichte QS manuell zum 1W10 addieren. Heilung danach im HP-Feld eintragen.
        </p>
      </div>

      <!-- Kampfmanoever-Popup: setzt Modifier + Notiz vor, Spieler klickt dann
           den normalen Wuerfeln-Button. -->
      <div
        v-if="maneuverOpen && isHtbah"
        class="p-2 rounded border border-parchment-700/30 bg-white/60 space-y-1"
      >
        <div class="text-[10px] uppercase tracking-widest text-ink-300 mb-1">
          Kampfmanöver — welches?
        </div>
        <div
          v-for="m in maneuvers"
          :key="m.id"
        >
          <UButton
            block
            size="xs"
            variant="outline"
            @click="applyManeuver(m)"
          >
            {{ m.label }}
            <span class="ml-auto text-[10px] opacity-70">
              {{ m.modifier > 0 ? '+' : '' }}{{ m.modifier !== 0 ? m.modifier : '±0' }}
            </span>
          </UButton>
        </div>
        <p class="text-[10px] text-ink-300/80 mt-1">
          Setzt Modifier + Notiz für deinen nächsten Wurf vor.
        </p>
      </div>

      <!-- Schaden-/Heilungs-Wuerfler: freier NdM+X-Wurf, optional gegen ein
           Ziel-Token. Wenn ein Ziel gewaehlt ist, wird das Ergebnis direkt von
           seinen HP abgezogen (Schaden) oder addiert (Heilung). -->
      <div class="space-y-2 border-t border-parchment-700/30 pt-3">
        <!-- Universalkampf-Toggle (§3): nur fuer HtbaH-Charaktere mit aktivem Modul -->
        <div v-if="isUniversalCombat" class="flex items-center justify-between gap-2">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">
            Universalkampf (§3)
          </div>
          <UButton
            size="xs"
            :variant="universalOpen ? 'solid' : 'outline'"
            :color="universalOpen ? 'primary' : 'neutral'"
            icon="i-lucide-calculator"
            title="Universalkampf-Schadensrechner ein/ausblenden"
            @click="universalOpen = !universalOpen"
          >
            Schaden = (T − W) / Mod
          </UButton>
        </div>
        <!-- Universalkampf-Rechner: Talent + Wurf + Waffe + Ruestung → Schaden -->
        <div
          v-if="isUniversalCombat && universalOpen"
          class="p-2 rounded border border-amber-300 bg-amber-50/60 space-y-2"
        >
          <div class="text-[10px] text-amber-900">
            Formel: <code class="font-mono">(Talent − Wurf) / (WaffenMod + RüstungsMod)</code> ·
            Min 10 LP bei Treffer · Max kombinierter Mod 4
          </div>
          <div class="grid grid-cols-4 gap-2">
            <UFormField label="Talent">
              <UInput v-model.number="uniTalentValue" type="number" size="xs" />
            </UFormField>
            <UFormField label="Wurf">
              <UInput v-model.number="uniAttackRoll" type="number" size="xs" />
            </UFormField>
            <UFormField label="Waffe">
              <USelect
                v-model="uniWeaponKind"
                :items="[
                  { label: 'Schusswaffe (1)', value: 'schusswaffe' },
                  { label: 'Handwaffe (2)', value: 'handwaffe' },
                  { label: 'Waffenlos (3)', value: 'waffenlos' },
                ]"
                value-key="value"
                size="xs"
              />
            </UFormField>
            <UFormField label="Rüstung">
              <USelect
                v-model="uniArmorKind"
                :items="[
                  { label: 'Keine (0)', value: 'keine' },
                  { label: 'Leicht (1)', value: 'leicht' },
                  { label: 'Schwer (2)', value: 'schwer' },
                ]"
                value-key="value"
                size="xs"
              />
            </UFormField>
          </div>
          <div
            class="text-center p-2 rounded font-mono text-base"
            :class="universalResult.damage > 0
              ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
              : 'bg-amber-100 text-amber-900 border border-amber-300'"
          >
            <template v-if="universalResult.damage > 0">
              Schaden: <strong>{{ universalResult.damage }}</strong>
              <span class="text-[10px] opacity-75 ml-2">
                Mod {{ universalResult.combinedMod }}
              </span>
            </template>
            <template v-else>
              Kein Treffer (Wurf {{ uniAttackRoll }} &gt; Talent {{ uniTalentValue }})
            </template>
          </div>
          <!-- Ziel + Anwenden: schreibt die berechneten HP direkt am Token ab,
               postet einen Chat-Eintrag mit der Berechnung. -->
          <div class="grid grid-cols-12 gap-2 items-end">
            <UFormField label="Ziel" class="col-span-7">
              <USelect
                v-model="uniTargetId"
                :items="damageTargetOptions"
                value-key="value"
                size="sm"
                class="w-full"
              />
            </UFormField>
            <UButton
              class="col-span-5"
              size="sm"
              color="error"
              icon="i-lucide-swords"
              block
              :loading="uniApplying"
              :disabled="universalResult.damage <= 0 || !uniTargetId || uniApplying"
              title="Berechneten Schaden ans Ziel-Token anwenden"
              @click="applyUniversalDamage"
            >
              Schaden anwenden
            </UButton>
          </div>
          <p v-if="uniApplyError" class="text-xs text-red-700">{{ uniApplyError }}</p>
          <p v-if="uniApplyResult" class="text-xs text-emerald-700">{{ uniApplyResult }}</p>
        </div>

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
        <div v-if="characterWeapons.length">
          <UFormField label="Waffe">
            <USelect
              v-model="selectedWeaponId"
              :items="weaponOptions"
              value-key="value"
              size="sm"
              class="w-full"
            />
          </UFormField>
          <p class="mt-1 text-[11px] text-ink-300 italic">
            Auswahl fuellt Wuerfel + Bezeichnung automatisch.
          </p>
        </div>
        <!-- Zauber + Stufe (nur HtbaH-Charaktere mit Zaubern). Stufe befuellt
             damageFormula/-Label und stellt zugleich Probe-Skill + Mod ein,
             sodass der Spieler oben „Würfeln" (Probe) und unten „Würfeln"
             (Schaden) ohne weitere Einstellungen klicken kann. -->
        <div v-if="characterSpells.length">
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            <UFormField label="Zauber" class="sm:col-span-6">
              <USelect
                v-model="selectedSpellId"
                :items="spellOptions"
                value-key="value"
                size="sm"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Stufe" class="sm:col-span-6">
              <USelect
                v-model="selectedSpellLevelId"
                :items="spellLevelOptions"
                value-key="value"
                size="sm"
                class="w-full"
                :disabled="!selectedSpellId"
              />
            </UFormField>
          </div>
          <p class="mt-1 text-[11px] text-ink-300 italic">
            Probe und Schadensformel werden automatisch befüllt.
          </p>
        </div>
        <!-- Modus + Ziel -->
        <div>
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
            <UFormField label="Ziel" class="sm:col-span-8">
              <USelect
                v-model="damageTargetId"
                :items="damageTargetOptions"
                value-key="value"
                size="sm"
                class="w-full"
              />
            </UFormField>
          </div>
          <p class="mt-1 text-[11px] text-ink-300 italic">
            Wähle den Charakter/NPC, dem der Wurf angerechnet wird.
          </p>
          <!-- Nahkampf-Reichweite: bei Nahkampfwaffe muss das Ziel direkt
               benachbart sein (Chebyshev ≤ 1). Spieler werden geblockt,
               der DM darf ausserhalb Reichweite wuerfeln. -->
          <p
            v-if="meleeOutOfReach"
            class="mt-1 text-[11px] font-semibold"
            :class="meleeBlocked ? 'text-red-700' : 'text-amber-700'"
          >
            ⚠ Nahkampf-Reichweite überschritten —
            {{ damageTargetToken?.name }} ist {{ distanceToToken(damageTargetToken) }} Felder entfernt
            (max. 1 Feld).
            <span v-if="!meleeBlocked" class="font-normal italic">DM darf trotzdem.</span>
            <span v-else class="font-normal italic">Bewege dich näher oder wähle eine Fernkampfwaffe.</span>
          </p>
        </div>
        <!-- Formel + Bezeichnung + Wuerfel-Button -->
        <div>
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
            <UFormField label="Würfel" class="sm:col-span-4">
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
              :disabled="!damageParsed || damageSending || (damageMode === 'damage' && meleeBlocked)"
              :loading="damageSending"
              class="sm:col-span-4 roll-cta"
              size="lg"
              block
              @click="rollDamage"
            >
              Würfeln
            </UButton>
          </div>
        </div>
        <!-- Krit-verdopplungs-Hinweis: zeigt an, dass die letzte Probe ein Krit
             war und der naechste Schadenswurf entsprechend verdoppelt wird
             (HTBaH §2.5/§10). Verschwindet bei Heilmodus. -->
        <p
          v-if="probeResultLast?.critical && damageMode === 'damage'"
          class="text-xs font-semibold text-emerald-700"
        >
          ✨ Kritischer Treffer aktiv — Schadenswurf wird ×2 verdoppelt.
        </p>
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

      <!-- Magie-Quick-Cast-Popup: Spruchname + Stufe → Komplexitaetswurf
           (server wuerfelt 3W10 + Arkanum, prueft gegen Stufen-Schwelle,
           zieht Mana ab). -->
      <div
        v-if="castOpen && hasMagic && magicModule === 'battlebuben'"
        class="p-2 rounded border border-emerald-300 bg-emerald-50 space-y-2"
      >
        <div class="text-[10px] uppercase tracking-widest text-emerald-700 mb-1 flex items-center justify-between">
          <span>Battlebuben-Magie wirken</span>
          <span class="font-mono normal-case tracking-normal">
            Arkanum {{ bbArkanumCurrent }}/{{ bbArkanumMax }}
          </span>
        </div>
        <div v-if="!bbKnownSpells.length" class="text-[11px] text-ink-400 italic">
          Noch keine Zauber gelernt. Im Charakterbogen unter „Magie" → Battlebuben-Magie Zauber lernen
          und je Stil einen Probe-Skill binden.
        </div>
        <template v-else>
          <UFormField label="Zauber">
            <USelect
              v-model="bbSelectedKey"
              :items="bbSpellOptions"
              value-key="value"
              size="sm"
              placeholder="— Zauber wählen —"
            />
          </UFormField>
          <div
            v-if="bbSelectedSpell && bbSelectedMeta"
            class="text-[11px] p-1.5 rounded bg-white/70 border border-emerald-200 space-y-1"
          >
            <div class="font-mono text-[10px] text-emerald-800">
              +{{ bbSelectedMeta.schwierigkeit }} Schwierigkeit ·
              {{ bbSelectedMeta.arkanum }} Arkanum<template v-if="bbSelectedMeta.fehlschlag"> · Fehlschlag {{ bbSelectedMeta.fehlschlag }}</template>
            </div>
            <div class="text-ink-500">{{ bbSelectedSpell.effect }}</div>
            <div v-if="bbSelectedSpell.extra" class="text-ink-400 italic">{{ bbSelectedSpell.extra }}</div>
          </div>
          <UButton
            block
            color="primary"
            icon="i-lucide-dices"
            :loading="bbCastSending"
            :disabled="!bbSelectedSpell || bbArkanumCurrent < (bbSelectedMeta?.arkanum ?? 0)"
            @click="castBattlebubenSpell"
          >
            Wirken (W100-Probe)
          </UButton>
          <div
            v-if="bbSelectedMeta && bbArkanumCurrent < bbSelectedMeta.arkanum"
            class="text-xs text-amber-700"
          >
            ⚠ Nicht genug Arkanum ({{ bbArkanumCurrent }}/{{ bbSelectedMeta.arkanum }} benötigt).
          </div>
          <p v-if="bbCastError" class="text-xs text-red-700">{{ bbCastError }}</p>
          <!-- Ergebnis des letzten Battlebuben-Casts -->
          <div
            v-if="bbLastResult"
            class="text-xs p-2 rounded border"
            :class="bbLastResult.fumble
              ? 'bg-red-100 text-red-900 border-red-400'
              : bbLastResult.success
                ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                : 'bg-amber-50 text-amber-900 border-amber-200'"
          >
            <div class="font-semibold">
              <template v-if="bbLastResult.fumble">💥 Kritischer Patzer</template>
              <template v-else-if="bbLastResult.critical">⚡ Kritischer Erfolg ({{ bbLastResult.qsLabel }})</template>
              <template v-else-if="bbLastResult.success">✓ Erfolg ({{ bbLastResult.qsLabel }})</template>
              <template v-else>✗ Misserfolg</template>
              — W100 {{ bbLastResult.roll }} vs {{ bbLastResult.target }}
            </div>
            <ul v-if="bbLastResult.effectParts.length" class="mt-0.5 space-y-0.5">
              <li v-for="(p, i) in bbLastResult.effectParts" :key="i">
                <strong>{{ p.label }}: {{ p.value }}</strong>
                <span class="opacity-70">({{ p.detail }})</span>
              </li>
            </ul>
            <div v-if="bbLastResult.selfDamage > 0" class="mt-0.5 text-red-800">
              Fehlschlag-Schaden 1W8 = {{ bbLastResult.selfDamage }} (auf eigene LP angerechnet)
            </div>
            <div class="mt-0.5 font-mono text-[10px] opacity-80">
              Arkanum {{ bbLastResult.arkanum }}/{{ bbLastResult.arkanumMax }}
            </div>
          </div>
        </template>
      </div>

      <div
        v-if="castOpen && hasMagic && magicModule !== 'battlebuben'"
        class="p-2 rounded border border-purple-300 bg-purple-50 space-y-2"
      >
        <div class="text-[10px] uppercase tracking-widest text-purple-700 mb-1 flex items-center justify-between">
          <span>
            <template v-if="magicModule === 'zauberei'">Zauber wirken — Komplexitätswurf (§8.5)</template>
            <template v-else-if="magicModule === 'sonnen'">Sonnen-Magie (§8.13.2)</template>
            <template v-else-if="magicModule === 'fuenfstufen'">Fünfstufenmagie (§8.13.1)</template>
            <template v-else-if="magicModule === 'seelensplitter'">Seelensplittermagie (§8.13.3)</template>
            <template v-else>Magie</template>
          </span>
          <span class="font-mono normal-case tracking-normal">
            <template v-if="magicModule === 'sonnen' || magicModule === 'zauberei'">
              Arkanum {{ arkanum }} · Mana {{ mana }}/{{ manaMax }}
            </template>
            <template v-else-if="magicModule === 'fuenfstufen'">
              Magie-Punkte
            </template>
            <template v-else-if="magicModule === 'seelensplitter'">
              Seele {{ seeleVerbraucht }}%
            </template>
          </span>
        </div>
        <!-- Modulspezifischer Hinweis-Block -->
        <div
          v-if="magicModule === 'sonnen'"
          class="text-[10px] p-1.5 rounded bg-amber-100 border border-amber-300 text-amber-900"
        >
          ☀ Konzentration: <strong>{{ sonnenKonzentration }}/100</strong> ·
          Aufladerunden = Stufe ÷ 2 + 1 · pro Unterbrechung −10 Konzentration
        </div>
        <div
          v-else-if="magicModule === 'fuenfstufen'"
          class="text-[10px] p-1.5 rounded bg-purple-100 border border-purple-300 text-purple-900"
        >
          📜 Sprüche werden aus dem Kontingent verbraucht (Vorbereiten beim Rasten, 1 h/Spruch).
          Pflege den Kontingent-Stand im Charakterbogen.
        </div>
        <div
          v-else-if="magicModule === 'seelensplitter'"
          class="text-[10px] p-1.5 rounded bg-red-100 border border-red-300 text-red-900"
        >
          💀 Vor JEDER Probe: W100 ≤ {{ seeleVerbraucht }}% = Schreckens-/Todesvision.
          Mind. 1 % Seele pro Zauber. Charakter ab &gt; 99 % vermutet tot.
        </div>
        <!-- Wenn der Spieler Sprueche aus dem Katalog gelernt hat: Dropdown.
             Andernfalls: freie Eingabe. -->
        <UFormField
          v-if="knownSpellOptions.length"
          label="Gelernter Spruch"
        >
          <USelect
            v-model="selectedKnownKey"
            :items="[
              { label: '— freie Eingabe —', value: '__free__' },
              ...knownSpellOptions.map((s) => ({
                label: `${['I','II','III','IV','V'][s.stufe - 1]} · ${s.name} (${s.manaCost} Mana)`,
                value: s.key,
              })),
            ]"
            value-key="value"
            size="sm"
          />
        </UFormField>
        <UFormField label="Spruchname">
          <UInput
            v-model="castSpellName"
            placeholder="z.B. Heilende Hände, Kochendes Blut, Erdwall"
            size="sm"
            :maxlength="60"
          />
        </UFormField>
        <div class="grid grid-cols-2 gap-2">
          <UFormField label="Stufe">
            <USelect
              v-model="castSpellLevel"
              :items="[
                { label: 'I (Schwelle 14, 1 Mana)', value: 1 },
                { label: 'II (16, 2 Mana)', value: 2 },
                { label: 'III (18, 3 Mana)', value: 3 },
                { label: 'IV (20, 4 Mana)', value: 4 },
                { label: 'V (22, 5 Mana)', value: 5 },
              ]"
              value-key="value"
              size="sm"
            />
          </UFormField>
          <UFormField label="Lehre (optional)">
            <UInput
              v-model="castLehre"
              placeholder="z.B. Genesung, Sturm"
              size="sm"
              :maxlength="40"
            />
          </UFormField>
        </div>
        <!-- Ziele + Schaden/Heilung. Optional — leer lassen, wenn der Spruch
             keinen direkten Schaden macht (Schutz, Trugbild, Beherrschung …). -->
        <div class="space-y-2 p-2 rounded border border-purple-200 bg-white/60">
          <div class="text-[10px] uppercase tracking-widest text-purple-700">
            Ziele &amp; Wirkung (optional)
          </div>
          <UFormField label="Ziele (Mehrfachauswahl)">
            <USelectMenu
              v-model="castTargetIds"
              :items="castTargetOptions"
              value-key="value"
              multiple
              size="sm"
              placeholder="— Ziele wählen —"
              class="w-full"
            />
          </UFormField>
          <div class="grid grid-cols-12 gap-2 items-end">
            <UFormField label="Modus" class="col-span-4">
              <USelect
                v-model="castDamageMode"
                :items="[
                  { label: '⚔ Schaden', value: 'damage' },
                  { label: '✚ Heilung', value: 'heal' },
                ]"
                value-key="value"
                size="sm"
              />
            </UFormField>
            <UFormField label="Würfel pro Treffer" class="col-span-8">
              <UInput
                v-model="castDamageFormula"
                placeholder="z.B. 3W10, 6W10+5"
                size="sm"
              />
            </UFormField>
          </div>
          <label
            v-if="castTargetIds.length > 1"
            class="flex items-center gap-2 text-[11px] text-ink-400 cursor-pointer"
          >
            <input
              v-model="castDamagePerTarget"
              type="checkbox"
              class="accent-purple-600"
            >
            Pro Ziel separat würfeln (statt 1 Wurf für alle)
          </label>
          <p
            v-if="castDamageFormula && !castDamageParsed"
            class="text-[11px] text-amber-700"
          >
            Format: NdM±X — z.B. <code>3W10</code>, <code>6W10+5</code>
          </p>
          <p
            v-else-if="castDamageParsed && castTargetIds.length"
            class="text-[11px] text-ink-300 italic"
          >
            Bei Erfolg: {{ castDamagePerTarget && castTargetIds.length > 1 ? 'pro Ziel' : '1 Wurf für alle' }}
            · {{ castTargetIds.length }} Ziel{{ castTargetIds.length === 1 ? '' : 'e' }}
            · {{ castDamageMode === 'heal' ? 'Heilung' : 'Schaden' }} wird automatisch angerechnet.
          </p>
        </div>
        <!-- Reichweiten-Warnung pro Ziel (nur bei Katalog-Spruechen mit
             parsbarer Range). Spieler werden geblockt, der DM darf trotzdem. -->
        <p
          v-if="castOutOfRangeTargets.length"
          class="text-[11px] font-semibold"
          :class="castReachBlocked ? 'text-red-700' : 'text-amber-700'"
        >
          ⚠ Außer Reichweite ({{ castSpellRangeTiles === Number.POSITIVE_INFINITY ? '∞' : castSpellRangeTiles }} Felder):
          {{ castOutOfRangeTargets.map((t) => `${t.name} (${distanceToToken(t)})`).join(', ') }}
          <span v-if="!castReachBlocked" class="font-normal italic">— DM darf trotzdem.</span>
        </p>
        <UButton
          block
          color="primary"
          icon="i-lucide-dices"
          :loading="castSending"
          :disabled="!castSpellName.trim() || mana < HTBAH_SPELL_MANA_COST[castSpellLevel] || castReachBlocked"
          @click="castSpell"
        >
          Wirken (3W10 + {{ arkanum }})
        </UButton>
        <div
          v-if="mana < HTBAH_SPELL_MANA_COST[castSpellLevel]"
          class="text-xs text-amber-700"
        >
          ⚠ Nicht genug Mana ({{ mana }}/{{ HTBAH_SPELL_MANA_COST[castSpellLevel] }} benötigt).
        </div>
        <!-- Seelensplitter-Vision-Indikator: zeigt das Ergebnis des
             automatisch ausgeloesten W100 ≤ Seele-Wurfs vor dem letzten Cast. -->
        <div
          v-if="isSeelensplitter && lastVisionResult"
          class="text-xs p-2 rounded border"
          :class="lastVisionResult.triggered
            ? 'bg-red-100 text-red-900 border-red-400'
            : 'bg-emerald-50 text-emerald-800 border-emerald-200'"
        >
          <template v-if="lastVisionResult.triggered">
            💀 <strong>Schreckens-/Todesvision ausgelöst!</strong>
            W100 = {{ lastVisionResult.roll }} ≤ {{ lastVisionResult.threshold }}% Seele
            — DM beschreibt die Vision.
          </template>
          <template v-else>
            Vision-Check bestanden (W100 = {{ lastVisionResult.roll }}
            &gt; {{ lastVisionResult.threshold }}%).
          </template>
        </div>
        <div
          v-if="castLastResult"
          class="text-xs p-2 rounded"
          :class="castLastResult.critSuccess
            ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
            : castLastResult.critFumble
              ? 'bg-red-100 text-red-900 border border-red-300'
              : castLastResult.success
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-amber-50 text-amber-800 border border-amber-200'"
        >
          <div class="font-semibold">
            <template v-if="castLastResult.critSuccess">⚡ Krit. Erfolg — Mana gespart!</template>
            <template v-else-if="castLastResult.critFumble">💥 Krit. Misserfolg — Mana weg, kein Effekt</template>
            <template v-else-if="castLastResult.success">✓ Erfolg</template>
            <template v-else>✗ Misserfolg</template>
          </div>
          <div class="font-mono mt-1">
            {{ castLastResult.rolls.join(' + ') }} + {{ arkanum }} = {{ castLastResult.sum }}
            (Schwelle {{ castLastResult.threshold }})
          </div>
          <div class="mt-1 opacity-80">
            Mana: <strong>{{ castLastResult.manaAfter }}/{{ manaMax }}</strong>
            <template v-if="castLastResult.manaCost > 0"> (−{{ castLastResult.manaCost }})</template>
          </div>
        </div>
        <!-- Schaden/Heilungs-Anwendung pro Ziel (Ergebnis des letzten Wurfs). -->
        <div
          v-if="castDamageApplyResults.length"
          class="text-xs p-2 rounded border space-y-0.5"
          :class="castDamageMode === 'heal'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-red-50 border-red-200 text-red-900'"
        >
          <div class="font-semibold text-[10px] uppercase tracking-widest">
            {{ castDamageMode === 'heal' ? 'Heilung angewandt' : 'Schaden angewandt' }}
          </div>
          <div v-for="(line, i) in castDamageApplyResults" :key="i" class="font-mono">
            {{ line }}
          </div>
        </div>
        <p v-if="castError" class="text-xs text-red-700">{{ castError }}</p>
        <p class="text-[10px] text-ink-300/80">
          2+ Einser = krit. Misserfolg · 2+ Zehner = krit. Erfolg (kein Mana)
        </p>

        <!-- Magie erkennen + Magie bannen — separate Quick-Wuerfe (§8.7/§8.8) -->
        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-parchment-700/30">
          <UButton
            size="xs"
            variant="outline"
            color="primary"
            icon="i-lucide-search"
            :loading="detectMagicSending"
            title="Magie erkennen (1W10 + Arkanum ≥ 7, kostet kein Mana)"
            @click="detectMagic"
          >
            Magie erkennen
          </UButton>
          <UButton
            size="xs"
            variant="outline"
            color="primary"
            icon="i-lucide-shield-off"
            :loading="dispelMagicSending"
            :disabled="mana < 1"
            title="Magie bannen (1W10 + Arkanum gegen Ziel-Wurf, kostet 1 Mana)"
            @click="dispelMagic"
          >
            Magie bannen (1 Mana)
          </UButton>
        </div>
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

      <!-- Verwendbare Gegenstände: Heiltrank, Erste-Hilfe-Paket o.aE. — pro
           Eintrag Ziel-Dropdown + Verwenden-Knopf. Klick: heilt Ziel, postet
           Chat-Nachricht, reduziert Anzahl. -->
      <div
        v-if="characterUsableItems.length"
        class="space-y-2 border-t border-parchment-700/30 pt-3"
      >
        <div class="text-[10px] uppercase tracking-widest text-ink-300">
          Verwendbare Gegenstände
        </div>
        <div
          v-for="item in characterUsableItems"
          :key="item.id"
          class="grid grid-cols-12 gap-2 items-end"
        >
          <div class="col-span-4 flex items-center gap-2 min-w-0">
            <span
              v-if="item.healAmount > 0"
              class="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
              :style="{
                background: '#10b98122',
                color: '#065f46',
                border: '1px solid #10b981',
              }"
              :title="`Heilt ${item.healAmount} HP`"
            >
              ✚{{ item.healAmount }}
            </span>
            <span
              v-if="(item.manaAmount ?? 0) > 0"
              class="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
              :style="{
                background: '#7c3aed22',
                color: '#4c1d95',
                border: '1px solid #7c3aed',
              }"
              :title="`Gibt ${item.manaAmount} Mana — nur bei aktivem Magie-Modul`"
            >
              ✦{{ item.manaAmount }}
            </span>
            <span
              class="text-[10px] tabular-nums px-1.5 py-0.5 rounded font-semibold"
              :style="{
                background: '#f5deb322',
                color: '#7c2d12',
                border: '1px solid #f59e0b',
              }"
              :title="`${item.quantity} dabei`"
            >
              {{ item.quantity }}×
            </span>
            <span class="text-xs font-semibold truncate" :title="item.name">
              {{ item.name }}
            </span>
          </div>
          <UFormField label="Ziel" class="col-span-5">
            <USelect
              :model-value="getItemTarget(item.id)"
              :items="damageTargetTokens.map((t) => ({
                label: t.id === activeToken?.id
                  ? `Auf mich (${t.name})`
                  : `${t.name}${t.hp !== null && t.hpMax ? ' · ' + t.hp + '/' + t.hpMax : ''}`,
                value: t.id,
              }))"
              value-key="value"
              size="sm"
              class="w-full"
              @update:model-value="setItemTarget(item.id, Number($event))"
            />
          </UFormField>
          <UButton
            class="col-span-3"
            color="success"
            icon="i-lucide-heart-pulse"
            size="sm"
            block
            :loading="usingItemId === item.id"
            :disabled="usingItemId !== null"
            @click="useItem(item)"
          >
            Verwenden
          </UButton>
        </div>
        <p v-if="itemUseError" class="text-xs text-red-700">{{ itemUseError }}</p>
        <p v-if="itemUseResult" class="text-xs text-emerald-700">{{ itemUseResult }}</p>
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
