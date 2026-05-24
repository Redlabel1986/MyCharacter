<script setup lang="ts">
import {
  HTBAH_TALENTS,
  HTBAH_TALENT_LABELS,
  HTBAH_SKILL_CAP,
  HTBAH_ARMOR_SLOTS,
  HTBAH_ARMOR_SLOT_LABELS,
  HTBAH_ARMOR_TAGS,
  HTBAH_ARMOR_TAG_LABELS,
  HTBAH_WEAPON_CATEGORIES,
  HTBAH_WEAPON_CATEGORY_LABELS,
  HTBAH_DC_PRESETS,
  HTBAH_SPELL_LEHREN,
  HTBAH_ARKANUM_MAX,
  HTBAH_RDD_SCALES,
  HTBAH_RDD_SCALE_LABELS,
  HTBAH_MAGIC_MODULES,
  HTBAH_MAGIC_MODULE_LABELS,
  htbahRddBaseValue,
  htbahRddPointsBudget,
  htbahRddMaxSpread,
  htbahRddSleepRegen,
  htbahRddActiveHealing,
  htbahFsKontingent,
  htbahFsUsedSlots,
  htbahManaMax,
  htbahSkillTotal,
  htbahTalentValue,
  htbahInsightMax,
  htbahCalcSpentPoints,
  htbahPointsRemaining,
  htbahPoolTotal,
  htbahInitiativeBonus,
  htbahStatus,
  htbahRollProbe,
  htbahCritThreshold,
  htbahCritThresholdAufspiessen,
  htbahFumbleThreshold,
  htbahQualityLabel,
  normalizeHtbahPurse,
  createBlankHtbah,
  htbahTotalArmor,
  htbahArmorParadeBonus,
  htbahArmorInitPenalty,
  htbahArmorAthleticsPenalty,
  type HtbahCharacterData,
  type HtbahTalent,
  type HtbahSkill,
  type HtbahMagicState,
  type HtbahMagicModuleId,
  type HtbahSpellLehreId,
  type HtbahRddState,
  type HtbahRddScale,
  type HtbahRddWound,
  type HtbahPerk,
  type HtbahPurse,
  type HtbahArmorPiece,
  type HtbahArmorSlot,
  type HtbahArmorTag,
  type HtbahWeaponEntry,
  type HtbahWeaponCategory,
  type HtbahWeaponProperties,
  type HtbahSpellEntry,
  type HtbahSpellLevel,
  type HtbahUsableItem,
} from '~~/shared/engines/htbah'
import { htbahSpellsByLehre } from '~~/shared/engines/htbah-spell-catalog'
import type { GameSystem } from '~~/shared/systems'
import SheetSection from '~/components/ui/SheetSection.vue'
import StatBlock from '~/components/ui/StatBlock.vue'

const props = defineProps<{
  data: Record<string, unknown>
  system: GameSystem
  /** Charakter-ID. Wenn gesetzt, kann „An Gruppe wuerfeln" benutzt werden. */
  characterId?: number
}>()
const emit = defineEmits<{ (e: 'update:data', v: Record<string, unknown>): void }>()

// Mit Blank mergen — schützt alte Charaktere und ignoriert deprecated Felder.
const sheet = computed<HtbahCharacterData>(() => {
  const blank = createBlankHtbah('')
  const incoming = (props.data ?? {}) as Partial<HtbahCharacterData> & {
    inspiration?: number
    level?: number
    skillCap?: number
    identity?: Partial<HtbahCharacterData['identity']> & {
      advantages?: unknown
      disadvantages?: unknown
    }
  }
  // Identity: deprecated string-Felder (advantages/disadvantages) ausfiltern.
  const { advantages: _legacyAdv, disadvantages: _legacyDis, ...incomingIdentity } =
    incoming.identity ?? {}
  return {
    ...blank,
    identity: { ...blank.identity, ...incomingIdentity },
    hp: { ...blank.hp, ...(incoming.hp ?? {}) },
    pointsPool: { ...blank.pointsPool, ...(incoming.pointsPool ?? {}) },
    talents: {
      handeln: {
        insightCurrent: incoming.talents?.handeln?.insightCurrent ?? 0,
      },
      wissen: {
        insightCurrent: incoming.talents?.wissen?.insightCurrent ?? 0,
      },
      soziales: {
        insightCurrent: incoming.talents?.soziales?.insightCurrent ?? 0,
      },
    },
    skills: (incoming.skills ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      talent: s.talent,
      spentPoints: s.spentPoints || 0,
      modifier: s.modifier || 0,
      dayBonus: s.dayBonus || 0,
      nightBonus: s.nightBonus || 0,
      note: s.note || '',
    })),
    advantages: incoming.advantages ?? [],
    disadvantages: incoming.disadvantages ?? [],
    backstory: { ...blank.backstory, ...(incoming.backstory ?? {}) },
    inventory: incoming.inventory ?? '',
    beute: incoming.beute ?? '',
    armor: Array.isArray(incoming.armor) ? incoming.armor : [],
    weapons: Array.isArray(incoming.weapons) ? incoming.weapons : [],
    usableItems: Array.isArray(incoming.usableItems)
      ? incoming.usableItems.map((i) => ({
          id: i.id,
          name: i.name ?? '',
          healAmount: Math.max(0, Math.floor(Number(i.healAmount ?? 0))),
          quantity: Math.max(0, Math.floor(Number(i.quantity ?? 0))),
          note: i.note ?? '',
        }))
      : [],
    spells: Array.isArray(incoming.spells)
      ? incoming.spells.map((s) => ({
          id: s.id,
          name: s.name ?? '',
          skillId: s.skillId ?? '',
          levels: Array.isArray(s.levels)
            ? s.levels.map((l) => ({
                id: l.id,
                label: l.label ?? '',
                kind: l.kind === 'heal' ? 'heal' : 'damage',
                modifier: Number(l.modifier ?? 0),
                damageFormula: l.damageFormula ?? '',
                note: l.note ?? '',
              }))
            : [],
          note: s.note ?? '',
        }))
      : [],
    purse: {
      copper: Number(incoming.purse?.copper ?? 0),
      silver: Number(incoming.purse?.silver ?? 0),
      gold: Number(incoming.purse?.gold ?? 0),
    },
    magic: incoming.magic ?? '',
    magicState: incoming.magicState
      ? {
          active: !!incoming.magicState.active,
          module: (HTBAH_MAGIC_MODULES as readonly string[]).includes(
            String(incoming.magicState.module ?? 'zauberei'),
          )
            ? (incoming.magicState.module as HtbahMagicModuleId)
            : 'zauberei',
          mana: Math.max(0, Math.floor(Number(incoming.magicState.mana ?? 0))),
          arkanum: Math.max(
            0,
            Math.min(HTBAH_ARKANUM_MAX, Math.floor(Number(incoming.magicState.arkanum ?? 0))),
          ),
          lehren: Array.isArray(incoming.magicState.lehren)
            ? (incoming.magicState.lehren as HtbahSpellLehreId[])
            : [],
          knownSpellKeys: Array.isArray(incoming.magicState.knownSpellKeys)
            ? incoming.magicState.knownSpellKeys.filter((k): k is string => typeof k === 'string')
            : [],
          fsMagiePunkte: Math.max(0, Math.floor(Number(incoming.magicState.fsMagiePunkte ?? 0))),
          fsVorbereitet: Array.isArray(incoming.magicState.fsVorbereitet)
            ? incoming.magicState.fsVorbereitet.map((v: { name?: unknown; stufe?: unknown; charges?: unknown }) => ({
                name: String(v.name ?? ''),
                stufe: Math.max(1, Math.min(5, Math.floor(Number(v.stufe ?? 1)))) as 1 | 2 | 3 | 4 | 5,
                charges: Math.max(0, Math.floor(Number(v.charges ?? 0))),
              }))
            : [],
          sonnenKonzentration: Math.max(0, Math.min(100, Math.floor(Number(incoming.magicState.sonnenKonzentration ?? 70)))),
          seeleVerbraucht: Math.max(0, Math.min(100, Math.floor(Number(incoming.magicState.seeleVerbraucht ?? 0)))),
        }
      : undefined,
    rdd: incoming.rdd
      ? {
          active: !!incoming.rdd.active,
          mortality: Math.max(1, Math.min(10, Math.floor(Number(incoming.rdd.mortality ?? 4)))),
          current: {
            lebenspunkte: Math.max(0, Math.floor(Number(incoming.rdd.current?.lebenspunkte ?? 0))),
            geistigeGesundheit: Math.max(0, Math.floor(Number(incoming.rdd.current?.geistigeGesundheit ?? 0))),
            prestige: Math.max(0, Math.floor(Number(incoming.rdd.current?.prestige ?? 0))),
          },
          max: {
            lebenspunkte: Math.max(0, Math.floor(Number(incoming.rdd.max?.lebenspunkte ?? 0))),
            geistigeGesundheit: Math.max(0, Math.floor(Number(incoming.rdd.max?.geistigeGesundheit ?? 0))),
            prestige: Math.max(0, Math.floor(Number(incoming.rdd.max?.prestige ?? 0))),
          },
          wounds: Array.isArray(incoming.rdd.wounds)
            ? incoming.rdd.wounds.map((w: { id?: unknown; scale?: unknown; amount?: unknown; kind?: unknown; note?: unknown; inflictedAt?: unknown }) => ({
                id: String(w.id ?? crypto.randomUUID()),
                scale: ((HTBAH_RDD_SCALES as readonly string[]).includes(String(w.scale))
                  ? w.scale
                  : 'lebenspunkte') as HtbahRddScale,
                amount: Math.max(0, Math.floor(Number(w.amount ?? 1))),
                kind: w.kind === 'permanent' ? 'permanent' : 'temporary',
                note: typeof w.note === 'string' ? w.note : '',
                inflictedAt: typeof w.inflictedAt === 'string' ? w.inflictedAt : new Date().toISOString(),
              }))
            : [],
        }
      : undefined,
    combatModule: incoming.combatModule === 'universal' ? 'universal' : 'standard',
    notes: incoming.notes ?? '',
  }
})

const update = (n: HtbahCharacterData) =>
  emit('update:data', n as unknown as Record<string, unknown>)
const clone = () => JSON.parse(JSON.stringify(sheet.value)) as HtbahCharacterData

const setIdentity = <K extends keyof HtbahCharacterData['identity']>(k: K, v: string) => {
  const n = clone(); n.identity[k] = v; update(n)
}
const setHp = <K extends keyof HtbahCharacterData['hp']>(k: K, v: number) => {
  const n = clone(); n.hp[k] = v; update(n)
}
const setPoolTotal = (v: number) => { const n = clone(); n.pointsPool.total = v; update(n) }
const setRacePoints = (v: number) => { const n = clone(); n.pointsPool.racePoints = v; update(n) }
const setBackstoryText = (v: string) => { const n = clone(); n.backstory.text = v; update(n) }
const setBackstoryPoints = (v: number) => { const n = clone(); n.backstory.points = v; update(n) }

const addPerk = (kind: 'advantages' | 'disadvantages') => {
  const n = clone()
  n[kind].push({ id: crypto.randomUUID(), name: '', cost: 0, note: '' })
  update(n)
}
const updatePerk = (
  kind: 'advantages' | 'disadvantages',
  idx: number,
  patch: Partial<HtbahPerk>,
) => {
  const n = clone()
  const current = n[kind][idx]
  if (!current) return
  n[kind][idx] = { ...current, ...patch }
  update(n)
}
const removePerk = (kind: 'advantages' | 'disadvantages', idx: number) => {
  const n = clone(); n[kind].splice(idx, 1); update(n)
}
const setInsightCurrent = (t: HtbahTalent, v: number) => {
  const n = clone(); n.talents[t].insightCurrent = v; update(n)
}
const setText = <K extends 'inventory' | 'notes' | 'beute' | 'magic'>(k: K, v: string) => {
  const n = clone(); n[k] = v; update(n)
}
// Geldbeutel: erst die Rohzahl uebernehmen, beim Verlassen des Felds
// normalisieren (100 Kupfer -> 1 Silber, 100 Silber -> 1 Gold). So bleibt
// "150" beim Tippen sichtbar und wird erst nach Blur in 50/1 zerlegt.
const setPurseRaw = <K extends keyof HtbahPurse>(k: K, v: number) => {
  const n = clone()
  n.purse = { ...n.purse, [k]: Number.isFinite(v) ? Math.floor(v) : 0 }
  update(n)
}
const applyPurseNormalize = () => {
  const n = clone()
  n.purse = normalizeHtbahPurse(n.purse)
  update(n)
}
// --- Ruestung ---
// Wird beim Schadenswurf vom eingehenden Schaden abgezogen. Summe siehe
// htbahTotalArmor(); im Bogen pflegt der Spieler beliebig viele Teile.
const totalArmor = computed(() => htbahTotalArmor(sheet.value))
// Sentinel-Wert fuer "nichts ausgewaehlt" — Radix-Select (Nuxt UI 3) verbietet
// empty-string als Option-Value, also nutzen wir einen non-empty Sentinel und
// uebersetzen ihn in den Setter-Handlern wieder zu undefined / Default.
const NONE_VALUE = '__none__'
const armorSlotOptions = HTBAH_ARMOR_SLOTS.map((s) => ({
  label: HTBAH_ARMOR_SLOT_LABELS[s],
  value: s,
}))
const armorTagOptions = [
  { label: '— Klasse —', value: NONE_VALUE },
  ...HTBAH_ARMOR_TAGS.map((t) => ({ label: HTBAH_ARMOR_TAG_LABELS[t], value: t })),
]
const weaponCategoryOptions = HTBAH_WEAPON_CATEGORIES.map((c) => ({
  label: HTBAH_WEAPON_CATEGORY_LABELS[c],
  value: c,
}))
const attackSkillOptions = computed(() => [
  { label: '— Trefferwurf-Skill (optional) —', value: NONE_VALUE },
  ...sheet.value.skills
    .filter((s: HtbahSkill) => s.name?.trim())
    .map((s: HtbahSkill) => ({
      label: `${s.name} (${HTBAH_TALENT_LABELS[s.talent]} · FW ${htbahSkillTotal(sheet.value, s)})`,
      value: s.id,
    })),
])
const addArmor = () => {
  const n = clone()
  if (!n.armor) n.armor = []
  n.armor.push({ id: crypto.randomUUID(), name: '', value: 0, slot: 'other' })
  update(n)
}
const updateArmor = (idx: number, patch: Partial<HtbahArmorPiece>) => {
  const n = clone()
  const list = n.armor ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.armor = list
  update(n)
}
const removeArmor = (idx: number) => {
  const n = clone()
  const list = n.armor ?? []
  list.splice(idx, 1)
  n.armor = list
  update(n)
}
// Vue-Template kann TS-Casts nicht — daher diese duennen Wrapper im Script,
// die die Slot/Tag-Werte typsicher zuruecksetzen. NONE_VALUE wird als "keine
// Auswahl" interpretiert (Radix verbietet empty-string als Select-Value).
const setArmorSlot = (idx: number, raw: unknown) => {
  const v = String(raw)
  const slot = (HTBAH_ARMOR_SLOTS as readonly string[]).includes(v)
    ? (v as HtbahArmorSlot)
    : 'other'
  updateArmor(idx, { slot })
}
const setArmorTag = (idx: number, raw: unknown) => {
  const v = String(raw)
  if (v === NONE_VALUE) {
    updateArmor(idx, { tag: undefined })
    return
  }
  const tag = (HTBAH_ARMOR_TAGS as readonly string[]).includes(v)
    ? (v as HtbahArmorTag)
    : undefined
  updateArmor(idx, { tag })
}
const setWeaponCategory = (idx: number, raw: unknown) => {
  const v = String(raw)
  const category = (HTBAH_WEAPON_CATEGORIES as readonly string[]).includes(v)
    ? (v as HtbahWeaponCategory)
    : 'sonstige'
  updateWeapon(idx, { category })
}
const setWeaponAttackSkill = (idx: number, raw: unknown) => {
  const v = String(raw ?? '')
  updateWeapon(idx, { attackSkillId: v && v !== NONE_VALUE ? v : undefined })
}

// --- Waffen ---
const addWeapon = () => {
  const n = clone()
  if (!n.weapons) n.weapons = []
  n.weapons.push({
    id: crypto.randomUUID(),
    name: '',
    damageFormula: '',
    category: 'sonstige',
    properties: {},
  })
  update(n)
}
const updateWeapon = (idx: number, patch: Partial<HtbahWeaponEntry>) => {
  const n = clone()
  const list = n.weapons ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.weapons = list
  update(n)
}
const updateWeaponProps = (idx: number, patch: Partial<HtbahWeaponProperties>) => {
  const n = clone()
  const list = n.weapons ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = {
    ...current,
    properties: { ...(current.properties ?? {}), ...patch },
  }
  n.weapons = list
  update(n)
}
const removeWeapon = (idx: number) => {
  const n = clone()
  const list = n.weapons ?? []
  list.splice(idx, 1)
  n.weapons = list
  update(n)
}

// --- Verwendbare Gegenstaende (Heiltrank, Erste-Hilfe-Paket, …) ---
const addUsableItem = () => {
  const n = clone()
  if (!n.usableItems) n.usableItems = []
  n.usableItems.push({
    id: crypto.randomUUID(),
    name: '',
    healAmount: 0,
    quantity: 1,
    note: '',
  })
  update(n)
}
const updateUsableItem = (idx: number, patch: Partial<HtbahUsableItem>) => {
  const n = clone()
  const list = n.usableItems ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.usableItems = list
  update(n)
}
const removeUsableItem = (idx: number) => {
  const n = clone()
  const list = n.usableItems ?? []
  list.splice(idx, 1)
  n.usableItems = list
  update(n)
}

// --- Zauber & Magie-Faehigkeiten ---
// Jeder Zauber referenziert einen Skill (Probe). Die Stufen modifizieren die
// Probe (modifier) und liefern die Schadensformel. Im Mini-Charsheet wird der
// gewaehlte Zauber + Stufe in Probe-Skill, Probe-Mod und Damage-Formel uebertragen.
const addSpell = () => {
  const n = clone()
  if (!n.spells) n.spells = []
  n.spells.push({
    id: crypto.randomUUID(),
    name: '',
    skillId: '',
    levels: [
      { id: crypto.randomUUID(), label: 'Stufe 1', modifier: 0, damageFormula: '' },
    ],
    note: '',
  })
  update(n)
}
const updateSpell = (idx: number, patch: Partial<HtbahSpellEntry>) => {
  const n = clone()
  const list = n.spells ?? []
  const current = list[idx]
  if (!current) return
  list[idx] = { ...current, ...patch }
  n.spells = list
  update(n)
}
const removeSpell = (idx: number) => {
  const n = clone()
  const list = n.spells ?? []
  list.splice(idx, 1)
  n.spells = list
  update(n)
}
const addSpellLevel = (spellIdx: number) => {
  const n = clone()
  const list = n.spells ?? []
  const spell = list[spellIdx]
  if (!spell) return
  const nextNum = (spell.levels?.length ?? 0) + 1
  spell.levels = [
    ...(spell.levels ?? []),
    {
      id: crypto.randomUUID(),
      label: `Stufe ${nextNum}`,
      modifier: 0,
      damageFormula: '',
    },
  ]
  n.spells = list
  update(n)
}
const updateSpellLevel = (
  spellIdx: number,
  levelIdx: number,
  patch: Partial<HtbahSpellLevel>,
) => {
  const n = clone()
  const list = n.spells ?? []
  const spell = list[spellIdx]
  if (!spell) return
  const lvl = spell.levels?.[levelIdx]
  if (!lvl) return
  spell.levels[levelIdx] = { ...lvl, ...patch }
  n.spells = list
  update(n)
}
const removeSpellLevel = (spellIdx: number, levelIdx: number) => {
  const n = clone()
  const list = n.spells ?? []
  const spell = list[spellIdx]
  if (!spell || !spell.levels) return
  spell.levels.splice(levelIdx, 1)
  n.spells = list
  update(n)
}

// --- Magie-Modul ("Zauberei", §8) ---
// Auto-Default + Mutationen. Wenn der Spieler das Modul deaktiviert lassen
// will, bleibt `magicState` undefined und die UI zeigt nur einen Aktivieren-
// Button.
const ensureMagicState = (n: HtbahCharacterData): HtbahMagicState => {
  if (!n.magicState) {
    n.magicState = { active: true, mana: 0, arkanum: 0, lehren: [], knownSpellKeys: [] }
  }
  if (!n.magicState.knownSpellKeys) n.magicState.knownSpellKeys = []
  return n.magicState
}
// --- Regel der Drei (§7.2) ---
const ensureRdd = (n: HtbahCharacterData): HtbahRddState => {
  if (!n.rdd) {
    // Default-State: Mortality 4 (HtbaH-Standard), Skalen auf Basiswert.
    n.rdd = {
      active: true,
      mortality: 4,
      max: {
        lebenspunkte: htbahRddBaseValue(n, 'lebenspunkte'),
        geistigeGesundheit: htbahRddBaseValue(n, 'geistigeGesundheit'),
        prestige: htbahRddBaseValue(n, 'prestige'),
      },
      current: {
        lebenspunkte: htbahRddBaseValue(n, 'lebenspunkte'),
        geistigeGesundheit: htbahRddBaseValue(n, 'geistigeGesundheit'),
        prestige: htbahRddBaseValue(n, 'prestige'),
      },
      wounds: [],
    }
  }
  return n.rdd
}
const toggleRdd = () => {
  const n = clone()
  if (!n.rdd) {
    ensureRdd(n)
  } else {
    n.rdd.active = !n.rdd.active
  }
  update(n)
}
const setRddMortality = (v: number) => {
  const n = clone()
  const r = ensureRdd(n)
  r.mortality = Math.max(1, Math.min(10, Math.floor(v || 4)))
  update(n)
}
const setRddCurrent = (scale: HtbahRddScale, v: number) => {
  const n = clone()
  const r = ensureRdd(n)
  r.current[scale] = Math.max(0, Math.min(r.max[scale], Math.floor(v || 0)))
  update(n)
}
const setRddMax = (scale: HtbahRddScale, v: number) => {
  const n = clone()
  const r = ensureRdd(n)
  r.max[scale] = Math.max(0, Math.floor(v || 0))
  // Current auf neuen Max clampen.
  r.current[scale] = Math.min(r.current[scale], r.max[scale])
  update(n)
}
const restoreRddScale = (scale: HtbahRddScale) => {
  const n = clone()
  const r = ensureRdd(n)
  r.current[scale] = r.max[scale]
  update(n)
}
const restoreRddAll = () => {
  const n = clone()
  const r = ensureRdd(n)
  r.current.lebenspunkte = r.max.lebenspunkte
  r.current.geistigeGesundheit = r.max.geistigeGesundheit
  r.current.prestige = r.max.prestige
  update(n)
}
const addRddWound = (scale: HtbahRddScale, kind: 'temporary' | 'permanent') => {
  const n = clone()
  const r = ensureRdd(n)
  r.wounds.push({
    id: crypto.randomUUID(),
    scale,
    amount: 1,
    kind,
    note: '',
    inflictedAt: new Date().toISOString(),
  })
  update(n)
}
const updateRddWound = (id: string, patch: Partial<HtbahRddWound>) => {
  const n = clone()
  const r = ensureRdd(n)
  const idx = r.wounds.findIndex((w) => w.id === id)
  if (idx < 0) return
  r.wounds[idx] = { ...r.wounds[idx]!, ...patch }
  update(n)
}
const removeRddWound = (id: string) => {
  const n = clone()
  const r = ensureRdd(n)
  r.wounds = r.wounds.filter((w) => w.id !== id)
  update(n)
}
const setRddWoundScale = (id: string, raw: unknown) => {
  const v = String(raw)
  const scale = (HTBAH_RDD_SCALES as readonly string[]).includes(v)
    ? (v as HtbahRddScale)
    : 'lebenspunkte'
  updateRddWound(id, { scale })
}

// --- Kampf-Modul ---
const setCombatModule = (v: 'standard' | 'universal') => {
  const n = clone()
  n.combatModule = v
  update(n)
}

// --- Magie-Modul-Switching ---
const setMagicModule = (raw: unknown) => {
  const v = String(raw)
  const module: HtbahMagicModuleId = (HTBAH_MAGIC_MODULES as readonly string[]).includes(v)
    ? (v as HtbahMagicModuleId)
    : 'zauberei'
  const n = clone()
  const ms = ensureMagicState(n)
  ms.module = module
  update(n)
}
const setMagicMagiePunkte = (v: number) => {
  const n = clone()
  const ms = ensureMagicState(n)
  ms.fsMagiePunkte = Math.max(0, Math.floor(v || 0))
  update(n)
}
const addFsPrepared = () => {
  const n = clone()
  const ms = ensureMagicState(n)
  if (!ms.fsVorbereitet) ms.fsVorbereitet = []
  ms.fsVorbereitet.push({ name: '', stufe: 1, charges: 1 })
  update(n)
}
const updateFsPrepared = (
  idx: number,
  patch: Partial<{ name: string; stufe: 1 | 2 | 3 | 4 | 5; charges: number }>,
) => {
  const n = clone()
  const ms = ensureMagicState(n)
  const list = ms.fsVorbereitet ?? []
  if (!list[idx]) return
  list[idx] = { ...list[idx]!, ...patch }
  ms.fsVorbereitet = list
  update(n)
}
const removeFsPrepared = (idx: number) => {
  const n = clone()
  const ms = ensureMagicState(n)
  const list = ms.fsVorbereitet ?? []
  list.splice(idx, 1)
  ms.fsVorbereitet = list
  update(n)
}
const setFsPreparedStufe = (idx: number, raw: unknown) => {
  const stufe = Math.max(1, Math.min(5, Math.floor(Number(raw) || 1))) as 1 | 2 | 3 | 4 | 5
  updateFsPrepared(idx, { stufe })
}
const setSonnenKonzentration = (v: number) => {
  const n = clone()
  const ms = ensureMagicState(n)
  ms.sonnenKonzentration = Math.max(0, Math.min(100, Math.floor(v || 0)))
  update(n)
}
const setSeeleVerbraucht = (v: number) => {
  const n = clone()
  const ms = ensureMagicState(n)
  ms.seeleVerbraucht = Math.max(0, Math.min(100, Math.floor(v || 0)))
  update(n)
}

const toggleKnownSpell = (spellKey: string) => {
  const n = clone()
  const ms = ensureMagicState(n)
  const list = ms.knownSpellKeys ?? []
  const idx = list.indexOf(spellKey)
  if (idx >= 0) {
    list.splice(idx, 1)
  } else if (list.length < HTBAH_ARKANUM_MAX) {
    list.push(spellKey)
  }
  ms.knownSpellKeys = list
  // Arkanum auto-sync = Anzahl gelernter Spruechen, max 5.
  ms.arkanum = Math.min(HTBAH_ARKANUM_MAX, list.length)
  // Mana max auf neuen Wert clampen.
  ms.mana = Math.min(ms.mana, htbahManaMax(ms.arkanum))
  update(n)
}
const toggleMagicModule = () => {
  const n = clone()
  if (!n.magicState) {
    n.magicState = { active: true, mana: 0, arkanum: 0, lehren: [] }
  } else {
    n.magicState.active = !n.magicState.active
  }
  update(n)
}
const setMagicArkanum = (v: number) => {
  const n = clone()
  const ms = ensureMagicState(n)
  ms.arkanum = Math.max(0, Math.min(HTBAH_ARKANUM_MAX, Math.floor(v || 0)))
  // Mana auf neuen Max-Wert clampen.
  ms.mana = Math.min(ms.mana, htbahManaMax(ms.arkanum))
  update(n)
}
const setMagicMana = (v: number) => {
  const n = clone()
  const ms = ensureMagicState(n)
  ms.mana = Math.max(0, Math.min(htbahManaMax(ms.arkanum), Math.floor(v || 0)))
  update(n)
}
const toggleMagicLehre = (id: HtbahSpellLehreId) => {
  const n = clone()
  const ms = ensureMagicState(n)
  const idx = ms.lehren.indexOf(id)
  if (idx >= 0) {
    ms.lehren.splice(idx, 1)
  } else if (ms.lehren.length < 3) {
    // Regelwerk: max 3 Lehren
    ms.lehren.push(id)
  }
  update(n)
}
const restoreMagicMana = () => {
  const n = clone()
  const ms = ensureMagicState(n)
  ms.mana = htbahManaMax(ms.arkanum)
  update(n)
}

// Skill-Auswahl-Optionen fuer das Zauber-"Probe-gegen"-Dropdown.
const spellSkillOptions = computed(() => [
  { label: '— Skill waehlen —', value: NONE_VALUE },
  ...sheet.value.skills
    .filter((s: HtbahSkill) => s.name?.trim())
    .map((s: HtbahSkill) => ({
      label: `${s.name} (${HTBAH_TALENT_LABELS[s.talent]} · FW ${htbahSkillTotal(sheet.value, s)})`,
      value: s.id,
    })),
])

const refreshAllInsights = () => {
  const n = clone()
  for (const t of HTBAH_TALENTS) {
    n.talents[t].insightCurrent = htbahInsightMax(n, t)
  }
  update(n)
}

const addSkill = (talent: HtbahTalent) => {
  const n = clone()
  n.skills.push({
    id: crypto.randomUUID(),
    name: '',
    talent,
    spentPoints: 0,
    modifier: 0,
    dayBonus: 0,
    nightBonus: 0,
    note: '',
  })
  update(n)
}
const updateSkill = (idx: number, patch: Partial<HtbahSkill>) => {
  const n = clone()
  const existing = n.skills[idx]
  if (!existing) return
  n.skills[idx] = { ...existing, ...patch }
  update(n)
}
const removeSkill = (idx: number) => { const n = clone(); n.skills.splice(idx, 1); update(n) }

const skillsByTalent = computed(() => {
  const map: Record<HtbahTalent, Array<{ idx: number; skill: HtbahSkill }>> = {
    handeln: [], wissen: [], soziales: [],
  }
  sheet.value.skills.forEach((skill, idx) => {
    if (map[skill.talent]) map[skill.talent].push({ idx, skill })
  })
  return map
})

const remaining = computed(() => htbahPointsRemaining(sheet.value))
const effectivePool = computed(() => htbahPoolTotal(sheet.value))
const status = computed(() => htbahStatus(sheet.value.hp))
const statusLabel = computed(() => {
  switch (status.value) {
    case 'tot': return 'Tot'
    case 'bewusstlos': return 'Bewusstlos'
    default: return 'Normal'
  }
})

// — Probe würfeln —
const probeTargetId = ref<string | undefined>(undefined)
const probeRoll = ref<number | null>(null)

interface ProbeOption { label: string; value: string; group?: string }
const probeOptions = computed<ProbeOption[]>(() => {
  const items: ProbeOption[] = []
  for (const t of HTBAH_TALENTS) {
    const val = htbahTalentValue(sheet.value, t)
    items.push({ label: `${HTBAH_TALENT_LABELS[t]} (${val})`, value: `talent:${t}` })
  }
  for (const s of sheet.value.skills) {
    if (!s.name.trim()) continue
    const total = htbahSkillTotal(sheet.value, s)
    items.push({
      label: `${s.name} — ${HTBAH_TALENT_LABELS[s.talent]} (${total})`,
      value: `skill:${s.id}`,
    })
  }
  return items
})

const probeTarget = computed<{ value: number; label: string; isTalentOnly: boolean } | null>(() => {
  if (!probeTargetId.value) return null
  const [type, id] = probeTargetId.value.split(':')
  if (type === 'talent') {
    const tal = id as HtbahTalent
    return {
      value: htbahTalentValue(sheet.value, tal),
      label: `${HTBAH_TALENT_LABELS[tal]} (Begabungsprobe)`,
      isTalentOnly: true,
    }
  }
  if (type === 'skill') {
    const skill = sheet.value.skills.find((s) => s.id === id)
    if (!skill) return null
    return {
      value: htbahSkillTotal(sheet.value, skill),
      label: skill.name || '(unbenannt)',
      isTalentOnly: false,
    }
  }
  return null
})

const probeResult = computed(() => {
  if (!probeTarget.value || probeRoll.value === null) return null
  if (probeRoll.value < 1 || probeRoll.value > 100) return null
  return htbahRollProbe({
    roll: probeRoll.value,
    target: probeTarget.value.value,
    isTalentOnly: probeTarget.value.isTalentOnly,
  })
})

const resultText = computed(() => {
  if (!probeResult.value) return ''
  if (probeResult.value.fumble) return 'Kritischer Patzer'
  if (probeResult.value.critical) return 'Kritischer Erfolg'
  if (probeResult.value.success) return 'Erfolg'
  return 'Misserfolg'
})

// Qualitaetsstufe + Marge nur bei Erfolg (Marge = Zielwert − Wurf).
// Stufe-Schwellen: 0-19 → 1, 20-29 → 2, ..., 60-69 → 6, 70+ → Maximaler Erfolg.
const qualityText = computed(() => {
  if (!probeResult.value || !probeResult.value.success) return ''
  if (probeResult.value.qualityStep === undefined) return ''
  if (!probeTarget.value || probeRoll.value === null) return ''
  const margin = probeTarget.value.value - probeRoll.value
  return `${htbahQualityLabel(probeResult.value.qualityStep)} · um ${margin} unterboten`
})

const resultClass = computed(() => {
  if (!probeResult.value) return ''
  if (probeResult.value.fumble) return 'bg-red-700 text-white border-red-900'
  if (probeResult.value.critical) return 'bg-emerald-600 text-white border-emerald-800'
  if (probeResult.value.success) return 'bg-emerald-100 text-emerald-900 border-emerald-300'
  return 'bg-amber-100 text-amber-900 border-amber-300'
})

const resultIcon = computed(() => {
  if (!probeResult.value) return ''
  if (probeResult.value.fumble) return 'i-lucide-skull'
  if (probeResult.value.critical) return 'i-lucide-sparkles'
  if (probeResult.value.success) return 'i-lucide-check'
  return 'i-lucide-x'
})

const rollDice = () => {
  probeRoll.value = Math.floor(Math.random() * 100) + 1
}
const resetProbe = () => {
  probeRoll.value = null
}

// — An Gruppe wuerfeln —
interface GroupListItem { id: number; name: string }
const groupsForRoll = ref<GroupListItem[]>([])
const selectedGroupId = ref<number | null>(null)
const rollModifier = ref<number>(0)
const rollNote = ref<string>('')
const groupRollSending = ref(false)
const groupRollError = ref<string | null>(null)
const groupRollSuccess = ref(false)

const loadGroups = async () => {
  if (!props.characterId) return
  try {
    const res = await $fetch<{ groups: GroupListItem[] }>('/api/groups')
    groupsForRoll.value = res.groups ?? []
    if (!selectedGroupId.value && groupsForRoll.value[0]) {
      selectedGroupId.value = groupsForRoll.value[0].id
    }
  } catch {
    // still — Spieler ist evtl. in keiner Gruppe
  }
}
onMounted(loadGroups)

const groupOptions = computed(() =>
  groupsForRoll.value.map((g) => ({ label: g.name, value: g.id })),
)

const postRollToGroup = async () => {
  if (!props.characterId || !selectedGroupId.value || !probeTargetId.value) return
  groupRollSending.value = true
  groupRollError.value = null
  groupRollSuccess.value = false
  try {
    const [type, id] = probeTargetId.value.split(':')
    const body =
      type === 'skill'
        ? {
            kind: 'htbahSkill' as const,
            characterId: props.characterId,
            skillId: id,
            modifier: rollModifier.value || undefined,
            note: rollNote.value.trim() || undefined,
          }
        : {
            kind: 'htbahTalent' as const,
            characterId: props.characterId,
            talent: id as HtbahTalent,
            modifier: rollModifier.value || undefined,
            note: rollNote.value.trim() || undefined,
          }
    await $fetch(`/api/groups/${selectedGroupId.value}/rolls`, {
      method: 'POST',
      body,
    })
    groupRollSuccess.value = true
    rollNote.value = ''
    setTimeout(() => (groupRollSuccess.value = false), 2500)
  } catch (e: unknown) {
    groupRollError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Wurf konnte nicht gepostet werden.'
  } finally {
    groupRollSending.value = false
  }
}
</script>

<template>
  <div class="grid lg:grid-cols-3 gap-5">
    <SheetSection title="Held*in" class="lg:col-span-2">
      <div class="grid sm:grid-cols-3 gap-3">
        <UFormField label="Geschlecht"><UInput :model-value="sheet.identity.sex" @update:model-value="setIdentity('sex', String($event))" /></UFormField>
        <UFormField label="Alter"><UInput :model-value="sheet.identity.age" @update:model-value="setIdentity('age', String($event))" /></UFormField>
        <UFormField label="Statur"><UInput :model-value="sheet.identity.height" @update:model-value="setIdentity('height', String($event))" /></UFormField>
        <UFormField label="Religion"><UInput :model-value="sheet.identity.religion" @update:model-value="setIdentity('religion', String($event))" /></UFormField>
        <UFormField label="Beruf"><UInput :model-value="sheet.identity.occupation" @update:model-value="setIdentity('occupation', String($event))" /></UFormField>
        <UFormField label="Familienstand"><UInput :model-value="sheet.identity.maritalStatus" @update:model-value="setIdentity('maritalStatus', String($event))" /></UFormField>
        <UFormField label="Aussehen" class="sm:col-span-3"><UTextarea autoresize :rows="2" class="w-full" :model-value="sheet.identity.appearance" @update:model-value="setIdentity('appearance', String($event))" /></UFormField>
        <UFormField label="Stimme"><UInput :model-value="sheet.identity.voice" @update:model-value="setIdentity('voice', String($event))" /></UFormField>
        <UFormField label="Kleidung" class="sm:col-span-2"><UTextarea autoresize :rows="2" class="w-full" :model-value="sheet.identity.clothing" @update:model-value="setIdentity('clothing', String($event))" /></UFormField>
        <UFormField label="Vorlieben" class="sm:col-span-3"><UTextarea autoresize :rows="2" class="w-full" :model-value="sheet.identity.likes" @update:model-value="setIdentity('likes', String($event))" /></UFormField>
      </div>
    </SheetSection>

    <SheetSection title="Status">
      <div
        class="grid gap-2"
        :class="sheet.magicState?.active ? 'grid-cols-3' : 'grid-cols-2'"
      >
        <StatBlock label="LP" :value="`${sheet.hp.current}/${sheet.hp.max}`" />
        <StatBlock
          label="Initiative"
          :value="`${htbahInitiativeBonus(sheet) >= 0 ? '+' : ''}${htbahInitiativeBonus(sheet)}`"
          sublabel="W10 + Handeln − RW/10"
        />
        <!-- Mana: Aktueller / Max-Wert (max = htbahManaMax(arkanum)). Wird
             nur angezeigt, wenn das Magie-Modul aktiviert ist — sonst ist
             der Wert irrelevant. -->
        <StatBlock
          v-if="sheet.magicState?.active"
          label="Mana"
          :value="`${sheet.magicState.mana}/${htbahManaMax(sheet.magicState.arkanum)}`"
          :sublabel="`Arkanum ${sheet.magicState.arkanum}`"
        />
      </div>
      <div
        class="mt-2 text-center text-xs uppercase tracking-widest font-semibold py-1 rounded"
        :class="status === 'tot' ? 'bg-red-700 text-white'
          : status === 'bewusstlos' ? 'bg-amber-200 text-amber-900'
          : 'bg-green-100 text-green-800'"
      >
        {{ statusLabel }}
      </div>

      <div class="grid grid-cols-2 gap-2 mt-3">
        <UFormField label="LP aktuell">
          <UInput type="number" :model-value="sheet.hp.current" @update:model-value="setHp('current', Number($event))" />
        </UFormField>
        <UFormField label="LP max">
          <UInput type="number" :model-value="sheet.hp.max" @update:model-value="setHp('max', Number($event))" />
        </UFormField>
      </div>

      <!-- Mana-Editor: nur sichtbar, wenn das Magie-Modul aktiv ist. Auffüllen-
           Button setzt Mana auf htbahManaMax(arkanum) — ohne Rasten/Tagessperre,
           damit Mit-Spieler den Wert pflegen können ohne in den Magie-Tab
           abzutauchen. -->
      <div
        v-if="sheet.magicState?.active"
        class="grid grid-cols-12 gap-2 mt-3 items-end"
      >
        <UFormField label="Mana aktuell" class="col-span-5">
          <UInput
            type="number"
            min="0"
            :max="htbahManaMax(sheet.magicState.arkanum)"
            :model-value="sheet.magicState.mana"
            @update:model-value="setMagicMana(Number($event))"
          />
        </UFormField>
        <UFormField label="Mana max" class="col-span-3">
          <UInput
            type="number"
            :model-value="htbahManaMax(sheet.magicState.arkanum)"
            disabled
          />
        </UFormField>
        <UButton
          size="sm"
          color="primary"
          variant="soft"
          icon="i-lucide-sparkles"
          class="col-span-4"
          block
          :disabled="sheet.magicState.mana >= htbahManaMax(sheet.magicState.arkanum)"
          title="Mana auf Maximum auffüllen (Arkanum × 2)"
          @click="restoreMagicMana"
        >
          Auffüllen
        </UButton>
      </div>
      <p
        v-if="!sheet.rdd?.active"
        class="text-[10px] text-ink-300 mt-1"
      >
        &lt; 10 LP = bewusstlos · 0 LP = tot · &gt; 60 Schaden in einem Treffer = sofort bewusstlos
      </p>

      <!-- Alternative Module: Regel der Drei + Kampf-Modul-Switcher -->
      <div class="accent-rule my-3" />
      <div class="text-xs uppercase tracking-widest text-ink-300 mb-2">Alternative Module</div>
      <div class="grid grid-cols-2 gap-2">
        <UButton
          size="xs"
          :variant="sheet.rdd?.active ? 'solid' : 'outline'"
          :color="sheet.rdd?.active ? 'primary' : 'neutral'"
          :icon="sheet.rdd?.active ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'"
          title="Regel der Drei (§7.2) — drei Skalen statt LP"
          @click="toggleRdd"
        >
          Regel der Drei
        </UButton>
        <UButton
          size="xs"
          :variant="sheet.combatModule === 'universal' ? 'solid' : 'outline'"
          :color="sheet.combatModule === 'universal' ? 'primary' : 'neutral'"
          :icon="sheet.combatModule === 'universal' ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'"
          title="Universalkampfsystem (§3) — Schadensformel statt W10-Wurf"
          @click="setCombatModule(sheet.combatModule === 'universal' ? 'standard' : 'universal')"
        >
          Universalkampf
        </UButton>
      </div>

      <!-- Regel-der-Drei-Skalen (§7.2.1) -->
      <div v-if="sheet.rdd?.active" class="mt-3 space-y-2 border border-blue-200 rounded p-2 bg-blue-50/40">
        <div class="text-xs uppercase tracking-widest text-blue-900 flex items-baseline justify-between">
          <span>Drei Skalen (Regel der Drei)</span>
          <span class="text-[10px] normal-case tracking-normal opacity-75">
            1 RdD-LP ≈ 9 Standard-LP
          </span>
        </div>
        <div class="grid grid-cols-3 gap-1 items-end">
          <UFormField label="Mortalität (1–10)">
            <UInput
              type="number"
              min="1"
              max="10"
              :model-value="sheet.rdd.mortality"
              @update:model-value="setRddMortality(Number($event))"
            />
          </UFormField>
          <div class="col-span-2 text-[10px] text-ink-300 space-y-0.5 pb-1">
            <div>Punkte: <strong>{{ htbahRddPointsBudget(sheet.rdd.mortality) }}</strong></div>
            <div>Max-Abstand: <strong>{{ htbahRddMaxSpread(sheet.rdd.mortality) }}</strong></div>
            <div>Schlaf-Regen: <strong>{{ htbahRddSleepRegen(sheet.rdd) }}</strong> · Aktive Heilung: {{ htbahRddActiveHealing(sheet.rdd).wenig }}/{{ htbahRddActiveHealing(sheet.rdd).mittel }}/{{ htbahRddActiveHealing(sheet.rdd).viel }}</div>
          </div>
        </div>
        <div
          v-for="scale in HTBAH_RDD_SCALES"
          :key="scale"
          class="grid grid-cols-12 gap-1 items-center"
        >
          <div class="col-span-4 text-xs font-semibold">{{ HTBAH_RDD_SCALE_LABELS[scale] }}</div>
          <UInput
            class="col-span-3"
            size="xs"
            type="number"
            min="0"
            :model-value="sheet.rdd.current[scale]"
            placeholder="aktuell"
            @update:model-value="setRddCurrent(scale, Number($event))"
          />
          <div class="col-span-1 text-center text-[10px] text-ink-300">/</div>
          <UInput
            class="col-span-3"
            size="xs"
            type="number"
            min="0"
            :model-value="sheet.rdd.max[scale]"
            placeholder="max"
            @update:model-value="setRddMax(scale, Number($event))"
          />
          <UButton
            class="col-span-1"
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :title="`${HTBAH_RDD_SCALE_LABELS[scale]} auf Maximum auffüllen`"
            @click="restoreRddScale(scale)"
          />
        </div>
        <div class="flex gap-2">
          <UButton size="xs" variant="soft" icon="i-lucide-refresh-cw" @click="restoreRddAll">
            Alle Skalen auffüllen
          </UButton>
        </div>

        <!-- Wunden-Liste -->
        <div class="mt-2 pt-2 border-t border-blue-200/60">
          <div class="text-[10px] uppercase tracking-widest text-blue-900 mb-1 flex items-baseline justify-between">
            <span>Wunden ({{ sheet.rdd.wounds.length }})</span>
            <span class="text-[9px] normal-case tracking-normal opacity-75">
              temporär heilt in W10/2 h · dauerhaft nur durch Behandlung
            </span>
          </div>
          <div
            v-for="w in sheet.rdd.wounds"
            :key="w.id"
            class="grid grid-cols-12 gap-1 items-center mb-1"
          >
            <USelect
              class="col-span-3"
              size="xs"
              :model-value="w.scale"
              :items="HTBAH_RDD_SCALES.map((s) => ({ label: HTBAH_RDD_SCALE_LABELS[s], value: s }))"
              value-key="value"
              @update:model-value="setRddWoundScale(w.id, $event)"
            />
            <USelect
              class="col-span-2"
              size="xs"
              :model-value="w.kind"
              :items="[
                { label: 'temp.', value: 'temporary' },
                { label: 'dauerh.', value: 'permanent' },
              ]"
              value-key="value"
              @update:model-value="updateRddWound(w.id, { kind: $event === 'permanent' ? 'permanent' : 'temporary' })"
            />
            <UInput
              class="col-span-2"
              size="xs"
              type="number"
              min="0"
              :model-value="w.amount"
              @update:model-value="updateRddWound(w.id, { amount: Math.max(0, Math.floor(Number($event) || 0)) })"
            />
            <UInput
              class="col-span-4"
              size="xs"
              :model-value="w.note ?? ''"
              placeholder="Notiz"
              @update:model-value="updateRddWound(w.id, { note: String($event) })"
            />
            <UButton
              class="col-span-1"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-x"
              @click="removeRddWound(w.id)"
            />
          </div>
          <div class="flex gap-1">
            <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addRddWound('lebenspunkte', 'temporary')">
              Temp. Wunde
            </UButton>
            <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addRddWound('lebenspunkte', 'permanent')">
              Dauerh. Wunde
            </UButton>
          </div>
        </div>
      </div>

      <!-- Ruestungs-Nebenwirkungen (Regelwerk §6.2.3 — erweitertes Modul):
           Parade +RW, Init −RW/10, Athletik −RW/2. Wird nur eingeblendet, wenn
           der Charakter überhaupt Rüstung trägt. -->
      <div v-if="totalArmor > 0" class="mt-3 p-2 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900 space-y-0.5">
        <div class="font-semibold uppercase tracking-widest text-[10px]">
          🛡 Rüstungs-Effekte (Σ RW {{ totalArmor }})
        </div>
        <div class="flex justify-between">
          <span>Parade:</span>
          <span class="font-mono">+{{ htbahArmorParadeBonus(sheet) }}</span>
        </div>
        <div class="flex justify-between">
          <span>Initiative:</span>
          <span class="font-mono">{{ htbahArmorInitPenalty(sheet) }}</span>
        </div>
        <div class="flex justify-between">
          <span>Athletik / Bewegung:</span>
          <span class="font-mono">{{ htbahArmorAthleticsPenalty(sheet) }}</span>
        </div>
        <p class="text-[9px] opacity-75 pt-0.5">
          Init wird automatisch verrechnet. Parade/Athletik manuell als Mod beim Wurf eintragen.
        </p>
      </div>

      <div class="accent-rule my-3" />
      <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Punkte-Pool</div>
      <div class="grid grid-cols-2 gap-2">
        <UFormField label="Basis">
          <UInput type="number" :model-value="sheet.pointsPool.total" @update:model-value="setPoolTotal(Number($event))" />
        </UFormField>
        <UFormField label="Volkspunkte">
          <UInput type="number" :model-value="sheet.pointsPool.racePoints" @update:model-value="setRacePoints(Number($event))" />
        </UFormField>
      </div>
      <div class="grid grid-cols-3 gap-2 mt-2">
        <StatBlock label="Effektiv" :value="effectivePool" />
        <StatBlock label="Vergeben" :value="htbahCalcSpentPoints(sheet)" />
        <StatBlock label="Übrig" :value="remaining" />
      </div>
      <p class="text-[10px] text-ink-300 mt-1">
        Effektiv = Basis + Volkspunkte + Σ Nachteile − Σ Vorteile + Vorgeschichte-Bonus.
      </p>

      <div class="accent-rule my-3" />
      <UButton size="xs" variant="outline" block @click="refreshAllInsights">
        Geistesblitzpunkte auffrischen
      </UButton>
      <p class="text-[10px] text-ink-300 mt-1">
        GBP regenerieren am Anfang jedes Abenteuers.
      </p>
    </SheetSection>

    <SheetSection
      v-for="talent in HTBAH_TALENTS"
      :key="talent"
      :title="HTBAH_TALENT_LABELS[talent]"
      class="lg:col-span-1"
    >
      <div class="grid grid-cols-2 gap-2 items-end">
        <div class="stat-block px-2 py-2 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">Begabungswert</div>
          <div class="font-serif text-3xl">{{ htbahTalentValue(sheet, talent) }}</div>
          <div class="text-[10px] text-ink-300">aus Skill-Punkten</div>
        </div>
        <div class="stat-block px-2 py-2 text-center">
          <div class="text-[10px] uppercase tracking-widest text-ink-300">Geistesblitze</div>
          <div class="font-serif text-2xl">
            {{ sheet.talents[talent].insightCurrent }}/{{ htbahInsightMax(sheet, talent) }}
          </div>
        </div>
      </div>
      <UFormField label="GBP aktuell" class="mt-2">
        <UInput
          type="number"
          :model-value="sheet.talents[talent].insightCurrent"
          @update:model-value="setInsightCurrent(talent, Number($event))"
        />
      </UFormField>

      <div class="accent-rule my-3" />
      <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">Fähigkeiten</div>
      <div class="hidden sm:grid grid-cols-12 gap-1 text-[10px] text-ink-300 px-1 mb-1">
        <div class="col-span-4">Name</div>
        <div class="col-span-2 text-center">Punkte</div>
        <div class="col-span-1 text-center">+Beg.</div>
        <div
          class="col-span-2 text-center"
          title="Allgemeiner Modifikator. Wird immer zur Probe addiert (Vor- oder Nachteil aus Eigenschaften, Wunden o.Ä.)."
        >Mod</div>
        <div class="col-span-2 text-center">Total</div>
        <div class="col-span-1"></div>
      </div>
      <div class="space-y-2">
        <div
          v-for="entry in skillsByTalent[talent]"
          :key="entry.skill.id"
          class="space-y-1"
        >
          <div class="grid grid-cols-12 gap-1 items-center">
            <UInput
              class="col-span-4"
              :model-value="entry.skill.name"
              placeholder="Name"
              @update:model-value="updateSkill(entry.idx, { name: String($event) })"
            />
            <UInput
              type="number"
              class="col-span-2"
              :model-value="entry.skill.spentPoints"
              @update:model-value="updateSkill(entry.idx, { spentPoints: Number($event) })"
            />
            <div class="col-span-1 text-center text-sm text-ink-400">
              {{ htbahTalentValue(sheet, talent) }}
            </div>
            <UInput
              type="number"
              class="col-span-2"
              :model-value="entry.skill.modifier"
              placeholder="±"
              @update:model-value="updateSkill(entry.idx, { modifier: Number($event) })"
            />
            <div
              class="col-span-2 text-center font-serif text-base"
              :class="(entry.skill.spentPoints + htbahTalentValue(sheet, talent)) > HTBAH_SKILL_CAP ? 'text-amber-700' : ''"
              :title="(entry.skill.spentPoints + htbahTalentValue(sheet, talent)) > HTBAH_SKILL_CAP ? 'Über Regelwerk-Richtwert von 100 — bewusst erlaubt' : ''"
            >
              {{ htbahSkillTotal(sheet, entry.skill) }}
            </div>
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              class="col-span-1"
              @click="removeSkill(entry.idx)"
            />
          </div>
          <div class="grid grid-cols-12 gap-1 items-center">
            <div class="col-span-3 flex items-center gap-1">
              <UIcon name="i-lucide-sun" class="size-3.5 text-amber-600 shrink-0" />
              <UInput
                size="xs"
                type="number"
                placeholder="Tag ±"
                :model-value="entry.skill.dayBonus"
                title="Bonus/Malus nur bei Tag (Morgen + Mittag) — wird automatisch zur Probe addiert, wenn die Karte tagsüber ist."
                @update:model-value="updateSkill(entry.idx, { dayBonus: Number($event) || 0 })"
              />
            </div>
            <div class="col-span-3 flex items-center gap-1">
              <UIcon name="i-lucide-moon" class="size-3.5 text-indigo-500 shrink-0" />
              <UInput
                size="xs"
                type="number"
                placeholder="Nacht ±"
                :model-value="entry.skill.nightBonus"
                title="Bonus/Malus nur bei Nacht (Abend + Nacht) — wird automatisch zur Probe addiert, wenn die Karte abends/nachts ist."
                @update:model-value="updateSkill(entry.idx, { nightBonus: Number($event) || 0 })"
              />
            </div>
            <UInput
              class="col-span-6"
              size="xs"
              placeholder="Notiz (z.B. Nachteil X reduziert um 10)"
              :model-value="entry.skill.note"
              @update:model-value="updateSkill(entry.idx, { note: String($event) })"
            />
          </div>
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addSkill(talent)">
        Fähigkeit
      </UButton>
    </SheetSection>

    <SheetSection title="Vorteile (kosten Punkte)" class="lg:col-span-1">
      <div class="hidden sm:grid grid-cols-12 gap-1 text-[10px] text-ink-300 px-1 mb-1">
        <div class="col-span-7">Name</div>
        <div class="col-span-3 text-center">Kosten</div>
        <div class="col-span-2"></div>
      </div>
      <div class="space-y-2">
        <div
          v-for="(perk, idx) in sheet.advantages"
          :key="perk.id"
          class="space-y-1"
        >
          <div class="grid grid-cols-12 gap-1 items-center">
            <UInput
              class="col-span-7"
              placeholder="Name"
              :model-value="perk.name"
              @update:model-value="updatePerk('advantages', idx, { name: String($event) })"
            />
            <UInput
              type="number"
              class="col-span-3"
              :model-value="perk.cost"
              @update:model-value="updatePerk('advantages', idx, { cost: Number($event) })"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              class="col-span-2"
              @click="removePerk('advantages', idx)"
            />
          </div>
          <UInput
            placeholder="Notiz (optional)"
            :model-value="perk.note"
            @update:model-value="updatePerk('advantages', idx, { note: String($event) })"
          />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addPerk('advantages')">
        Vorteil
      </UButton>
      <p class="text-[10px] text-ink-300 mt-2">
        Kosten werden vom Pool abgezogen.
      </p>
    </SheetSection>

    <SheetSection title="Nachteile (bringen Punkte)" class="lg:col-span-1">
      <div class="hidden sm:grid grid-cols-12 gap-1 text-[10px] text-ink-300 px-1 mb-1">
        <div class="col-span-7">Name</div>
        <div class="col-span-3 text-center">Punkte</div>
        <div class="col-span-2"></div>
      </div>
      <div class="space-y-2">
        <div
          v-for="(perk, idx) in sheet.disadvantages"
          :key="perk.id"
          class="space-y-1"
        >
          <div class="grid grid-cols-12 gap-1 items-center">
            <UInput
              class="col-span-7"
              placeholder="Name"
              :model-value="perk.name"
              @update:model-value="updatePerk('disadvantages', idx, { name: String($event) })"
            />
            <UInput
              type="number"
              class="col-span-3"
              :model-value="perk.cost"
              @update:model-value="updatePerk('disadvantages', idx, { cost: Number($event) })"
            />
            <UButton
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              class="col-span-2"
              @click="removePerk('disadvantages', idx)"
            />
          </div>
          <UInput
            placeholder="Notiz (optional)"
            :model-value="perk.note"
            @update:model-value="updatePerk('disadvantages', idx, { note: String($event) })"
          />
        </div>
      </div>
      <UButton size="xs" variant="ghost" icon="i-lucide-plus" class="mt-2" @click="addPerk('disadvantages')">
        Nachteil
      </UButton>
      <p class="text-[10px] text-ink-300 mt-2">
        Punkte werden auf den Pool addiert.
      </p>
    </SheetSection>

    <SheetSection title="Vorgeschichte" class="lg:col-span-1">
      <UFormField label="Bonus-Punkte">
        <UInput
          type="number"
          :model-value="sheet.backstory.points"
          @update:model-value="setBackstoryPoints(Number($event))"
        />
      </UFormField>
      <p class="text-[10px] text-ink-300 mt-1">
        Optional — werden zum Pool addiert.
      </p>
      <UFormField label="Text" class="mt-3">
        <UTextarea
          rows="9"
          placeholder="Herkunft, prägende Ereignisse, Motivation…"
          :model-value="sheet.backstory.text"
          class="w-full"
          @update:model-value="setBackstoryText(String($event))"
        />
      </UFormField>
    </SheetSection>

    <SheetSection title="Probe würfeln" class="lg:col-span-3">
      <div class="grid sm:grid-cols-12 gap-3 items-end">
        <UFormField label="Fähigkeit / Begabung" class="sm:col-span-6">
          <USelect
            v-model="probeTargetId"
            :items="probeOptions"
            value-key="value"
            placeholder="Was wird geprüft?"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Wurf (1–100)" class="sm:col-span-2">
          <UInput
            v-model.number="probeRoll"
            type="number"
            min="1"
            max="100"
            placeholder="—"
          />
        </UFormField>
        <UButton
          color="primary"
          icon="i-lucide-dices"
          class="sm:col-span-2"
          :disabled="!probeTargetId"
          @click="rollDice"
        >
          W100 würfeln
        </UButton>
        <UButton
          variant="ghost"
          icon="i-lucide-rotate-ccw"
          class="sm:col-span-2"
          :disabled="probeRoll === null"
          @click="resetProbe"
        >
          Zurücksetzen
        </UButton>
      </div>

      <div
        v-if="probeTarget && probeResult"
        :class="resultClass"
        class="mt-4 p-4 rounded-lg border-2 text-center transition"
      >
        <div class="flex items-center justify-center gap-3">
          <UIcon :name="resultIcon" class="size-8" />
          <div class="font-serif text-3xl">{{ resultText }}</div>
        </div>
        <div v-if="qualityText" class="font-serif text-lg mt-1">
          {{ qualityText }}
        </div>
        <div class="text-sm mt-2 opacity-90">
          <strong>{{ probeTarget.label }}</strong> · Zielwert {{ probeTarget.value }} · Wurf {{ probeRoll }}
        </div>
        <div class="text-xs mt-1 opacity-75">
          Krit-Erfolg ≤ {{ probeTarget.isTalentOnly ? '— (kein Krit bei reiner Begabungsprobe)' : htbahCritThreshold(probeTarget.value) }}
          ·
          Krit-Patzer ≥ {{ htbahFumbleThreshold(probeTarget.value) }}
        </div>
      </div>
      <p v-else class="text-xs text-ink-300 mt-3 text-center">
        Wähle eine Fähigkeit oder Begabung und gib das Würfelergebnis ein (oder klick auf <em>W100 würfeln</em>).
      </p>

      <!-- An Gruppe wuerfeln -->
      <div
        v-if="characterId && groupsForRoll.length"
        class="mt-4 pt-4 border-t border-parchment-700/20"
      >
        <div class="text-xs uppercase tracking-widest text-ink-300 mb-2">
          An Gruppen-Chat würfeln (Server würfelt, Ergebnis im Chat)
        </div>
        <div class="grid sm:grid-cols-12 gap-3 items-end">
          <UFormField label="Gruppe" class="sm:col-span-4">
            <USelect
              v-model="selectedGroupId"
              :items="groupOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Mod. (situativ)"
            class="sm:col-span-2"
            help="±10 = Erleichterung/Erschwernis"
          >
            <UInput
              v-model.number="rollModifier"
              type="number"
              min="-100"
              max="100"
            />
          </UFormField>
          <UFormField label="Notiz (optional)" class="sm:col-span-4">
            <UInput
              v-model="rollNote"
              placeholder="z.B. „klettert die Wand hoch"
              :maxlength="200"
            />
          </UFormField>
          <UButton
            color="primary"
            icon="i-lucide-send"
            class="sm:col-span-2"
            :disabled="!probeTargetId || !selectedGroupId"
            :loading="groupRollSending"
            @click="postRollToGroup"
          >
            An Gruppe
          </UButton>
        </div>
        <div v-if="groupRollError" class="text-xs text-red-700 mt-2">
          {{ groupRollError }}
        </div>
        <div v-if="groupRollSuccess" class="text-xs text-emerald-700 mt-2">
          ✓ Wurf an Gruppe gesendet.
        </div>
      </div>
      <p
        v-else-if="characterId && !groupsForRoll.length"
        class="text-[10px] text-ink-300 mt-3 text-center"
      >
        Du bist in keiner Gruppe — tritt einer Gruppe bei, um Würfe an einen Chat zu schicken.
      </p>
    </SheetSection>

    <SheetSection title="Kampfbogen — Rüstung & Waffen" class="lg:col-span-3">
      <!-- Regel-Spickzettel (klappbar). Bewusst kompakt: Spieler/SL haben die
           wichtigsten Sonderregeln direkt griffbereit, ohne den Bogen zu
           sprengen. -->
      <details class="mb-3 border border-parchment-700/30 rounded p-2 bg-white/30">
        <summary class="cursor-pointer text-xs uppercase tracking-widest text-ink-300">
          📖 Regeln: Waffen vs. Rüstung
        </summary>
        <div class="text-xs text-ink-300 mt-2 space-y-2 leading-relaxed">
          <p>
            <strong>Rüstung (RW)</strong>: Summe aller Schutzwerte wird beim
            Schadenswurf vom Schaden abgezogen (erweitertes Modul, 0–50).
            Mehrere Teile pro Slot sind erlaubt — der RW summiert sich.
          </p>
          <p>
            <strong>Stumpfwaffen</strong> (Hammer, Keule, Streitkolben):
            „Schlagwaffe" — jeder 1er beim Schadenswurf darf einmal neu
            gewürfelt werden. Schwere Stumpfwaffen haben oft zusätzlich
            <em>Rüstungsbrechend</em> (Streitkolben −30, Morgenstern −30).
          </p>
          <p>
            <strong>Hiebwaffen</strong> (Schwert, Axt, Säbel): Allrounder,
            meist ohne Sonderregel. Untertyp <em>Jagdwaffe</em>: +15 auf den
            Trefferwurf gegen Gegner mit RW ≤ Schwelle (typ. ≤ 15).
          </p>
          <p>
            <strong>Stichwaffen</strong> (Speer, Degen, Rapier, Stechschwert):
            <em>Rüstungsbrechend</em> (Stechschwert −15, Panzerstecher −30)
            ODER <em>Aufspießen</em> (Krit-Bereich ≤ 20 % statt 10 % des FW;
            Krit beschädigt die Rüstung dauerhaft um −1 RW).
          </p>
          <p class="text-ink-300/70">
            Beispiele: Streitkolben 3d10+10 (Schlag, RB-30) · Stechschwert
            4d10+3 (RB-15) · Degen 4d10 (Aufspießen) · Falchion 3d10+10
            (Jagdwaffe ≤ RW 15) · Langschwert 3d10+8 (Hieb, keine SR).
          </p>
        </div>
      </details>

      <div class="grid lg:grid-cols-2 gap-5">
        <!-- ===================== RÜSTUNG ===================== -->
        <div class="space-y-2">
          <div class="flex items-baseline justify-between gap-2">
            <div class="text-xs uppercase tracking-widest text-ink-300">
              Rüstung
              <span class="text-[10px] normal-case tracking-normal text-ink-300/70">
                · Summe wird vom Schaden abgezogen
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="text-xs px-2 py-0.5 rounded font-mono font-semibold"
                :style="{
                  background: totalArmor > 0 ? '#1e3a8a22' : 'transparent',
                  color: totalArmor > 0 ? '#1e3a8a' : 'var(--color-ink-300)',
                  border: totalArmor > 0 ? '1px solid #1e3a8a' : 'none',
                }"
                :title="'Gesamt-Rüstung: ' + totalArmor + ' HP'"
              >
                Σ RW {{ totalArmor }}
              </span>
              <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addArmor">
                Teil
              </UButton>
            </div>
          </div>
          <p
            v-if="!(sheet.armor && sheet.armor.length)"
            class="text-xs text-ink-300 italic"
          >
            Noch keine Rüstung eingetragen.
          </p>
          <div
            v-for="(piece, idx) in (sheet.armor ?? [])"
            :key="piece.id"
            class="border border-parchment-700/20 rounded p-2 bg-white/30 space-y-1"
          >
            <div class="grid grid-cols-12 gap-2 items-center">
              <UInput
                class="col-span-6"
                :model-value="piece.name"
                placeholder="z.B. Plattenharnisch, Helm, Schild"
                :maxlength="60"
                @update:model-value="updateArmor(idx, { name: String($event) })"
              />
              <UInput
                class="col-span-2"
                type="number"
                min="0"
                :model-value="piece.value"
                placeholder="RW"
                title="Schutzwert in RW-Punkten (0–50 fürs erweiterte Modul)"
                @update:model-value="updateArmor(idx, { value: Number($event) })"
              />
              <UInput
                class="col-span-3"
                :model-value="piece.note ?? ''"
                placeholder="Notiz"
                :maxlength="80"
                @update:model-value="updateArmor(idx, { note: String($event) })"
              />
              <UButton
                class="col-span-1"
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-x"
                @click="removeArmor(idx)"
              />
            </div>
            <div class="grid grid-cols-12 gap-2 items-center">
              <USelect
                class="col-span-6"
                :model-value="piece.slot ?? 'other'"
                :items="armorSlotOptions"
                value-key="value"
                size="sm"
                @update:model-value="setArmorSlot(idx, $event)"
              />
              <USelect
                class="col-span-6"
                :model-value="piece.tag ?? NONE_VALUE"
                :items="armorTagOptions"
                value-key="value"
                size="sm"
                @update:model-value="setArmorTag(idx, $event)"
              />
            </div>
          </div>
        </div>

        <!-- ===================== WAFFEN ===================== -->
        <div class="space-y-2">
          <div class="flex items-baseline justify-between gap-2">
            <div class="text-xs uppercase tracking-widest text-ink-300">
              Waffen
              <span class="text-[10px] normal-case tracking-normal text-ink-300/70">
                · NdM±X (z.B. 4d10, 1d10+3)
              </span>
            </div>
            <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addWeapon">
              Waffe
            </UButton>
          </div>
          <p
            v-if="!(sheet.weapons && sheet.weapons.length)"
            class="text-xs text-ink-300 italic"
          >
            Noch keine Waffe eingetragen.
          </p>
          <div
            v-for="(w, idx) in (sheet.weapons ?? [])"
            :key="w.id"
            class="border border-parchment-700/20 rounded p-2 bg-white/30 space-y-1"
          >
            <!-- Zeile 1: Name + Schadensformel + Löschen -->
            <div class="grid grid-cols-12 gap-2 items-center">
              <UInput
                class="col-span-7"
                :model-value="w.name"
                placeholder="z.B. Stechschwert, Streitkolben, Langbogen"
                :maxlength="60"
                @update:model-value="updateWeapon(idx, { name: String($event) })"
              />
              <UInput
                class="col-span-4"
                :model-value="w.damageFormula"
                placeholder="4d10+3"
                :maxlength="20"
                @update:model-value="updateWeapon(idx, { damageFormula: String($event) })"
              />
              <UButton
                class="col-span-1"
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-x"
                @click="removeWeapon(idx)"
              />
            </div>
            <!-- Zeile 2: Kategorie + Trefferskill -->
            <div class="grid grid-cols-12 gap-2 items-center">
              <USelect
                class="col-span-6"
                :model-value="w.category ?? 'sonstige'"
                :items="weaponCategoryOptions"
                value-key="value"
                size="sm"
                @update:model-value="setWeaponCategory(idx, $event)"
              />
              <USelect
                class="col-span-6"
                :model-value="w.attackSkillId ?? NONE_VALUE"
                :items="attackSkillOptions"
                value-key="value"
                size="sm"
                @update:model-value="setWeaponAttackSkill(idx, $event)"
              />
            </div>
            <!-- Zeile 3: Sonderregeln -->
            <div class="grid grid-cols-12 gap-2 items-center">
              <UCheckbox
                class="col-span-3"
                :model-value="!!w.properties?.schlagwaffe"
                label="Schlagwaffe"
                title="Schadenswurf-1er werden einmal neu gewürfelt"
                @update:model-value="updateWeaponProps(idx, { schlagwaffe: !!$event })"
              />
              <div class="col-span-3 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Rüstungsbrechend X — reduziert RW um X">RB</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="50"
                  :model-value="w.properties?.armorBreak ?? 0"
                  placeholder="0"
                  title="Rüstungsbrechend X (Stechschwert 15, Streitkolben 30)"
                  @update:model-value="updateWeaponProps(idx, { armorBreak: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
              <UCheckbox
                class="col-span-3"
                :model-value="!!w.properties?.aufspiessen"
                label="Aufspießen"
                title="Krit-Bereich ≤ 20 % statt 10 % des FW; Krit beschädigt Rüstung dauerhaft"
                @update:model-value="updateWeaponProps(idx, { aufspiessen: !!$event })"
              />
              <div class="col-span-3 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Jagdwaffe: +15 Trefferwurf vs. RW ≤ Schwelle">Jagd ≤</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="50"
                  :model-value="w.properties?.huntingThreshold ?? 0"
                  placeholder="0"
                  title="Jagdwaffe: +15 auf Trefferwurf gegen Gegner mit RW ≤ diesem Wert (typ. 15)"
                  @update:model-value="updateWeaponProps(idx, { huntingThreshold: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
            </div>
            <!-- Zeile 4: Trefferwurf-Modifikatoren (Flink/Grob/Genau/Schwer) -->
            <div class="grid grid-cols-12 gap-2 items-center">
              <div class="col-span-3 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Flink +X — Bonus auf Trefferwurf (Nahkampf)">Flink +</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="50"
                  :model-value="w.properties?.flink ?? 0"
                  placeholder="0"
                  title="Flink +X auf Trefferwurf (z.B. Bauernwehr +20, Knüppel +20, Langschwert +10)"
                  @update:model-value="updateWeaponProps(idx, { flink: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
              <div class="col-span-3 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Grob −X — Malus auf Trefferwurf (Nahkampf, 2H-Waffen)">Grob −</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="50"
                  :model-value="w.properties?.grob ?? 0"
                  placeholder="0"
                  title="Grob −X auf Trefferwurf (z.B. Zweihänder −15, Streitaxt −10)"
                  @update:model-value="updateWeaponProps(idx, { grob: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
              <div class="col-span-3 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Genau +X — Bonus auf Trefferwurf (Fernkampf)">Genau +</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="50"
                  :model-value="w.properties?.genau ?? 0"
                  placeholder="0"
                  title="Genau +X auf Trefferwurf (z.B. Jagdbogen +20, Reiterbogen +10)"
                  @update:model-value="updateWeaponProps(idx, { genau: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
              <div class="col-span-3 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Schwer −X — Malus auf Trefferwurf (Fernkampf)">Schwer −</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="50"
                  :model-value="w.properties?.schwer ?? 0"
                  placeholder="0"
                  title="Schwer −X auf Trefferwurf (z.B. Kriegsbogen −10, Kriegsarmbrust −10)"
                  @update:model-value="updateWeaponProps(idx, { schwer: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
            </div>
            <!-- Zeile 5: Kontext-Boni (Schwert / Stangenwaffe) -->
            <div class="grid grid-cols-12 gap-2 items-center">
              <UCheckbox
                class="col-span-6"
                :model-value="!!w.properties?.schwert"
                label="Schwert (+5 Paradewurf, wenn ausgerüstet)"
                title="Klassisches Schwert-Profil — gibt +5 auf den Paradewurf, solange diese Waffe ausgewählt ist"
                @update:model-value="updateWeaponProps(idx, { schwert: !!$event })"
              />
              <UCheckbox
                class="col-span-6"
                :model-value="!!w.properties?.stangenwaffe"
                label="Stangenwaffe (+10 Initiative, wenn ausgerüstet)"
                title="Spear/Hellebarde/etc. — +10 auf den Initiative-Wurf, wenn beim Wurf gewählt"
                @update:model-value="updateWeaponProps(idx, { stangenwaffe: !!$event })"
              />
            </div>
            <!-- Zeile 5b: Schusswaffen-Distanz-Falloff (Schrotflinte etc.) -->
            <div class="grid grid-cols-12 gap-2 items-center">
              <div class="col-span-6 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Distanz-Falloff: Vollschaden bis X Meter">Vollschaden bis (m)</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="500"
                  :model-value="w.properties?.falloffStart ?? 0"
                  placeholder="0"
                  title="Bis zu dieser Distanz wirkt voller Schaden (Schusswaffen)"
                  @update:model-value="updateWeaponProps(idx, { falloffStart: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
              <div class="col-span-6 flex items-center gap-1">
                <span class="text-[10px] text-ink-300 whitespace-nowrap" title="Pro Meter über Vollschaden-Distanz: dieser Wert vom Schaden abziehen">Schaden −/Meter</span>
                <UInput
                  size="xs"
                  type="number"
                  min="0"
                  max="50"
                  :model-value="w.properties?.falloffPerMeter ?? 0"
                  placeholder="0"
                  title="Schaden-Abzug pro Meter über Vollschaden-Distanz (Schrotflinte ≈ 5)"
                  @update:model-value="updateWeaponProps(idx, { falloffPerMeter: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
              </div>
            </div>
            <!-- Zeile 6: Notiz -->
            <UInput
              :model-value="w.note ?? ''"
              placeholder="Notiz (z.B. Zweihänder, +2 Hand frei nicht möglich)"
              :maxlength="120"
              @update:model-value="updateWeapon(idx, { note: String($event) })"
            />
          </div>
        </div>
      </div>
    </SheetSection>

    <!-- Zauber & Magie-Fähigkeiten: probt gegen einen vorhandenen Skill;
         jede Stufe modifiziert die Probe und liefert eine Schadensformel. -->
    <SheetSection title="Zauber & Magie" class="lg:col-span-2">
      <div class="flex items-baseline justify-between gap-2 mb-2">
        <p class="text-xs text-ink-300/80">
          Wähle pro Zauber einen Skill (Probe gegen dessen FW). Jede Stufe
          bekommt eine eigene Erschwernis und Schadensformel — im Battle-Map-Wurf
          kannst du die entsprechende Stufe wählen, beides wird automatisch befüllt.
        </p>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addSpell">
          Zauber hinzufügen
        </UButton>
      </div>
      <p
        v-if="!(sheet.spells && sheet.spells.length)"
        class="text-xs text-ink-300 italic"
      >
        Noch kein Zauber eingetragen.
      </p>
      <div class="space-y-3">
        <div
          v-for="(spell, sIdx) in (sheet.spells ?? [])"
          :key="spell.id"
          class="border border-parchment-700/30 rounded p-2 bg-white/30 space-y-2"
        >
          <!-- Kopf: Name + Skill-Auswahl + Notiz + Löschen -->
          <div class="grid grid-cols-12 gap-2 items-center">
            <UInput
              class="col-span-4"
              :model-value="spell.name"
              placeholder="Zaubername (z.B. Feuerball)"
              :maxlength="60"
              @update:model-value="updateSpell(sIdx, { name: String($event) })"
            />
            <USelect
              class="col-span-4"
              :model-value="spell.skillId || NONE_VALUE"
              :items="spellSkillOptions"
              value-key="value"
              size="sm"
              @update:model-value="updateSpell(sIdx, { skillId: String($event) === NONE_VALUE ? '' : String($event) })"
            />
            <UInput
              class="col-span-3"
              :model-value="spell.note ?? ''"
              placeholder="Notiz (optional)"
              :maxlength="120"
              @update:model-value="updateSpell(sIdx, { note: String($event) })"
            />
            <UButton
              class="col-span-1"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-trash-2"
              :title="`Zauber „${spell.name || '(unbenannt)'}“ löschen`"
              @click="removeSpell(sIdx)"
            />
          </div>

          <!-- Stufen-Liste -->
          <div class="pl-3 border-l-2 border-parchment-700/30 space-y-1">
            <div class="flex items-baseline justify-between">
              <div class="text-[10px] uppercase tracking-widest text-ink-300">
                Stufen
                <span class="normal-case tracking-normal text-ink-300/70">
                  · Mod typisch negativ (Erschwernis) · NdM±X für Schaden
                </span>
              </div>
              <UButton
                size="xs"
                variant="ghost"
                icon="i-lucide-plus"
                @click="addSpellLevel(sIdx)"
              >
                Stufe
              </UButton>
            </div>
            <p
              v-if="!spell.levels.length"
              class="text-xs text-ink-300 italic"
            >
              Noch keine Stufen — pro Stufe Erschwernis & Schaden anlegen.
            </p>
            <div
              v-for="(lvl, lIdx) in spell.levels"
              :key="lvl.id"
              class="grid grid-cols-12 gap-2 items-center"
            >
              <UInput
                class="col-span-3"
                :model-value="lvl.label"
                placeholder="z.B. Stufe 1 / Funke"
                :maxlength="40"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { label: String($event) })"
              />
              <USelect
                class="col-span-2"
                :model-value="lvl.kind ?? 'damage'"
                :items="[
                  { label: '⚔ Schaden', value: 'damage' },
                  { label: '✚ Heilung', value: 'heal' },
                ]"
                value-key="value"
                size="sm"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { kind: String($event) === 'heal' ? 'heal' : 'damage' })"
              />
              <UInput
                class="col-span-2"
                type="number"
                :model-value="lvl.modifier"
                placeholder="Mod ±"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { modifier: Number($event) })"
              />
              <UInput
                class="col-span-2"
                :model-value="lvl.damageFormula"
                placeholder="z.B. 4d10"
                :maxlength="20"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { damageFormula: String($event) })"
              />
              <UInput
                class="col-span-2"
                :model-value="lvl.note ?? ''"
                placeholder="Notiz"
                :maxlength="120"
                @update:model-value="updateSpellLevel(sIdx, lIdx, { note: String($event) })"
              />
              <UButton
                class="col-span-1"
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-x"
                @click="removeSpellLevel(sIdx, lIdx)"
              />
            </div>
          </div>
        </div>
      </div>
    </SheetSection>

    <!-- Verwendbare Gegenstände: Heiltrank, Erste-Hilfe-Paket o.aE. mit festem
         Heilwert + Anzahl. Im Battle-Map-Mini-Charsheet auf sich oder ein
         Ziel anwendbar — Anzahl sinkt automatisch um 1. -->
    <SheetSection title="Verwendbare Gegenstände" class="lg:col-span-2">
      <div class="flex items-baseline justify-between gap-2 mb-2">
        <p class="text-xs text-ink-300/80">
          Heiltrank, Erste-Hilfe-Paket o.ä. — Heilwert in HP plus Anzahl.
          Im Battle-Map-Mini-Charsheet wählst du ein Ziel + verwendest sie per Klick.
        </p>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addUsableItem">
          Gegenstand
        </UButton>
      </div>
      <p
        v-if="!(sheet.usableItems && sheet.usableItems.length)"
        class="text-xs text-ink-300 italic"
      >
        Noch nichts eingetragen.
      </p>
      <div
        v-for="(item, idx) in (sheet.usableItems ?? [])"
        :key="item.id"
        class="grid grid-cols-12 gap-2 items-center"
      >
        <UInput
          class="col-span-5"
          :model-value="item.name"
          placeholder="z.B. Heiltrank, Erste-Hilfe-Paket"
          :maxlength="60"
          @update:model-value="updateUsableItem(idx, { name: String($event) })"
        />
        <UInput
          class="col-span-2"
          type="number"
          min="0"
          :model-value="item.healAmount"
          placeholder="Heilung"
          title="Heilwert in HP"
          @update:model-value="updateUsableItem(idx, { healAmount: Math.max(0, Math.floor(Number($event) || 0)) })"
        />
        <UInput
          class="col-span-2"
          type="number"
          min="0"
          :model-value="item.quantity"
          placeholder="Anzahl"
          title="Wie viele du davon dabei hast"
          @update:model-value="updateUsableItem(idx, { quantity: Math.max(0, Math.floor(Number($event) || 0)) })"
        />
        <UInput
          class="col-span-2"
          :model-value="item.note ?? ''"
          placeholder="Notiz"
          :maxlength="80"
          @update:model-value="updateUsableItem(idx, { note: String($event) })"
        />
        <UButton
          class="col-span-1"
          size="xs"
          variant="ghost"
          color="error"
          icon="i-lucide-x"
          @click="removeUsableItem(idx)"
        />
      </div>
    </SheetSection>

    <SheetSection title="Inventar & Beute" class="lg:col-span-2">
      <UFormField label="Inventar">
        <UTextarea
          rows="6"
          :model-value="sheet.inventory"
          class="w-full"
          @update:model-value="setText('inventory', String($event))"
        />
      </UFormField>
      <div class="mt-3">
        <div class="flex items-baseline justify-between mb-1">
          <div class="text-xs uppercase tracking-widest text-ink-300">
            Geldbeutel
            <span class="text-[10px] normal-case tracking-normal text-ink-300/70">
              · 100 Kupfer = 1 Silber · 100 Silber = 1 Gold
            </span>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            title="Münzen umrechnen (100 Kupfer → 1 Silber, 100 Silber → 1 Gold)"
            @click="applyPurseNormalize"
          >
            Umrechnen
          </UButton>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#b45309" />
                Kupfer
              </span>
            </template>
            <UInput
              type="number"
              min="0"
              :model-value="sheet.purse.copper"
              @update:model-value="setPurseRaw('copper', Number($event))"
              @blur="applyPurseNormalize"
            />
          </UFormField>
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#9ca3af" />
                Silber
              </span>
            </template>
            <UInput
              type="number"
              min="0"
              :model-value="sheet.purse.silver"
              @update:model-value="setPurseRaw('silver', Number($event))"
              @blur="applyPurseNormalize"
            />
          </UFormField>
          <UFormField>
            <template #label>
              <span class="inline-flex items-center gap-1">
                <span class="inline-block w-2 h-2 rounded-full" style="background:#d4af37" />
                Gold
              </span>
            </template>
            <UInput
              type="number"
              min="0"
              :model-value="sheet.purse.gold"
              @update:model-value="setPurseRaw('gold', Number($event))"
              @blur="applyPurseNormalize"
            />
          </UFormField>
        </div>
      </div>
      <UFormField label="Sonstige Beute" class="mt-3" help="Edelsteine, Wertgegenstände, Schuldscheine — nicht-monetäre Beute.">
        <UTextarea
          rows="3"
          placeholder="z.B. Rubin (geschätzt 50 Gold), Goldkette, Schuldschein über 200 Silber …"
          :model-value="sheet.beute"
          class="w-full"
          @update:model-value="setText('beute', String($event))"
        />
      </UFormField>
    </SheetSection>

    <SheetSection title="Magie" class="lg:col-span-2">
      <!-- Magie-Modul "Zauberei" (§8) — strukturierter Tracker. Optional aktivierbar. -->
      <div class="border border-parchment-700/30 rounded p-3 bg-white/30 space-y-3 mb-4">
        <div class="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <div class="font-serif text-base">Zauberei-Modul (§8)</div>
            <p class="text-[10px] text-ink-300">
              Arkanum-Tracker, Mana-Pool, Lehren-Auswahl. Optional — Charaktere ohne Magie lassen es deaktiviert.
            </p>
          </div>
          <UButton
            size="xs"
            :variant="sheet.magicState?.active ? 'solid' : 'outline'"
            :color="sheet.magicState?.active ? 'primary' : 'neutral'"
            :icon="sheet.magicState?.active ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'"
            @click="toggleMagicModule"
          >
            {{ sheet.magicState?.active ? 'Aktiv' : 'Aktivieren' }}
          </UButton>
        </div>

        <div v-if="sheet.magicState?.active" class="space-y-3">
          <!-- Modul-Switcher -->
          <UFormField label="Magie-Modul">
            <USelect
              :model-value="sheet.magicState.module ?? 'zauberei'"
              :items="HTBAH_MAGIC_MODULES.map((m) => ({ label: HTBAH_MAGIC_MODULE_LABELS[m], value: m }))"
              value-key="value"
              size="sm"
              @update:model-value="setMagicModule(String($event))"
            />
          </UFormField>

          <!-- Zauberei (Default-Modul) + Sonnen-Magie nutzen Arkanum/Mana. -->
          <template v-if="sheet.magicState.module === 'zauberei' || sheet.magicState.module === 'sonnen' || !sheet.magicState.module">
          <!-- Arkanum + Mana -->
          <div class="grid grid-cols-3 gap-2">
            <UFormField label="Arkanum (0–5)">
              <UInput
                type="number"
                min="0"
                :max="HTBAH_ARKANUM_MAX"
                :model-value="sheet.magicState.arkanum"
                @update:model-value="setMagicArkanum(Number($event))"
              />
            </UFormField>
            <UFormField label="Mana aktuell">
              <UInput
                type="number"
                min="0"
                :max="htbahManaMax(sheet.magicState.arkanum)"
                :model-value="sheet.magicState.mana"
                @update:model-value="setMagicMana(Number($event))"
              />
            </UFormField>
            <UFormField :label="`Mana max (= ${htbahManaMax(sheet.magicState.arkanum)})`">
              <UButton
                block
                size="sm"
                variant="outline"
                icon="i-lucide-refresh-cw"
                title="Manavorrat auf Maximum auffüllen (z.B. nach Rast)"
                @click="restoreMagicMana"
              >
                Auffüllen
              </UButton>
            </UFormField>
          </div>
          <p class="text-[10px] text-ink-300">
            Mana max = Arkanum × 2 · Regeneration: +1 / Stunde Rast · Manatränke: leicht 2, mittel 4, stark 6
          </p>

          <!-- Lehren-Auswahl (max 3) -->
          <div>
            <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
              Lehren (max 3 — aktuell {{ sheet.magicState.lehren.length }}/3)
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
              <UButton
                v-for="l in HTBAH_SPELL_LEHREN"
                :key="l.id"
                size="xs"
                :variant="sheet.magicState.lehren.includes(l.id) ? 'solid' : 'outline'"
                :color="sheet.magicState.lehren.includes(l.id) ? 'primary' : 'neutral'"
                :disabled="!sheet.magicState.lehren.includes(l.id) && sheet.magicState.lehren.length >= 3"
                :title="l.hint"
                @click="toggleMagicLehre(l.id)"
              >
                {{ l.label }}
              </UButton>
            </div>
          </div>

          <!-- Komplexitäts-Schwellen-Cheat-Sheet -->
          <div class="text-[10px] text-ink-300 grid grid-cols-5 gap-1 mt-1">
            <div class="text-center"><strong>I</strong>: 14+ (1 Mana)</div>
            <div class="text-center"><strong>II</strong>: 16+ (2 Mana)</div>
            <div class="text-center"><strong>III</strong>: 18+ (3 Mana)</div>
            <div class="text-center"><strong>IV</strong>: 20+ (4 Mana)</div>
            <div class="text-center"><strong>V</strong>: 22+ (5 Mana)</div>
          </div>

          <!-- Spruch-Katalog: pro aktivierter Lehre alle 5 Stufen als
               Toggle-Button. Max 5 Sprüche insgesamt (= Arkanum). -->
          <details
            v-if="sheet.magicState.lehren.length"
            class="border border-parchment-700/30 rounded p-2 bg-white/40"
            :open="!(sheet.magicState.knownSpellKeys?.length)"
          >
            <summary class="cursor-pointer text-xs uppercase tracking-widest text-ink-300 flex items-center justify-between">
              <span>Sprüche aus Katalog ({{ sheet.magicState.knownSpellKeys?.length ?? 0 }}/{{ HTBAH_ARKANUM_MAX }})</span>
              <span class="text-[10px] normal-case tracking-normal opacity-70">
                Klick auf Spruch = lernen / verlernen
              </span>
            </summary>
            <div class="mt-2 space-y-2">
              <div
                v-for="lehreId in sheet.magicState.lehren"
                :key="lehreId"
                class="border border-parchment-700/20 rounded p-2 bg-white/40"
              >
                <div class="font-serif text-sm mb-1">
                  {{ HTBAH_SPELL_LEHREN.find((l) => l.id === lehreId)?.label ?? lehreId }}
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  <button
                    v-for="spell in htbahSpellsByLehre(lehreId)"
                    :key="spell.key"
                    type="button"
                    class="text-left text-[11px] px-2 py-1.5 rounded border transition flex items-start gap-2"
                    :class="(sheet.magicState.knownSpellKeys ?? []).includes(spell.key)
                      ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-ink-700'
                      : 'bg-white/40 border-parchment-700/30 hover:bg-white/70 text-ink-500'"
                    :disabled="
                      !(sheet.magicState.knownSpellKeys ?? []).includes(spell.key)
                      && (sheet.magicState.knownSpellKeys?.length ?? 0) >= HTBAH_ARKANUM_MAX
                    "
                    :title="`${spell.range} · ${spell.manaCost} Mana — ${spell.effect}`"
                    @click="toggleKnownSpell(spell.key)"
                  >
                    <span class="font-mono text-[10px] opacity-70 mt-0.5 shrink-0">
                      {{ ['I','II','III','IV','V'][spell.stufe - 1] }}
                    </span>
                    <span class="flex-1 min-w-0">
                      <span class="font-semibold block">{{ spell.name }}</span>
                      <span class="text-[10px] opacity-75 block truncate">{{ spell.effect }}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
            <p class="text-[10px] text-ink-300 mt-2">
              Maximum 5 Sprüche (Arkanum). Bei vollem Pool gelernte Sprüche zuerst verlernen.
            </p>
          </details>
          <p
            v-else
            class="text-[10px] text-ink-300/80 italic"
          >
            Wähle oben mindestens eine Lehre, um Sprüche aus dem Katalog lernen zu können.
          </p>
          </template>

          <!-- ====== Sonnen-Magie-spezifischer Block (§8.13.2) ====== -->
          <div
            v-if="sheet.magicState.module === 'sonnen'"
            class="mt-2 p-2 rounded border border-amber-300 bg-amber-50/60 space-y-2"
          >
            <div class="text-xs uppercase tracking-widest text-amber-900">
              Sonnen-Magie (§8.13.2) — Konzentration
            </div>
            <div class="grid grid-cols-2 gap-2 items-end">
              <UFormField label="Konzentration (0–100)">
                <UInput
                  type="number"
                  min="0"
                  max="100"
                  :model-value="sheet.magicState.sonnenKonzentration ?? 70"
                  @update:model-value="setSonnenKonzentration(Number($event))"
                />
              </UFormField>
              <UButton
                size="sm"
                variant="outline"
                icon="i-lucide-refresh-cw"
                title="Konzentration auf 70 zurücksetzen (Default)"
                @click="setSonnenKonzentration(70)"
              >
                Reset auf 70
              </UButton>
            </div>
            <p class="text-[10px] text-amber-900/80">
              Pro Unterbrechung −10 · Aufladerunden je Spruchstufe: Stufe ÷ 2 + 1 ·
              Strahlenbündel lvl X: X·W10 + (X÷3)·W5 · Sphären-Radius lvl 1–5: 3–50 m
            </p>
          </div>

          <!-- ====== Fünfstufenmagie-Block (§8.13.1) ====== -->
          <div
            v-if="sheet.magicState.module === 'fuenfstufen'"
            class="mt-2 p-2 rounded border border-purple-300 bg-purple-50/60 space-y-2"
          >
            <div class="text-xs uppercase tracking-widest text-purple-900 flex items-baseline justify-between">
              <span>Fünfstufenmagie (§8.13.1)</span>
              <span class="font-mono normal-case tracking-normal text-[10px]">
                Slots: {{ htbahFsUsedSlots(sheet.magicState.fsVorbereitet ?? []) }}/{{ htbahFsKontingent(sheet.magicState.fsMagiePunkte ?? 0) }}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-2 items-end">
              <UFormField label="Magie-Punkte (Wissen)">
                <UInput
                  type="number"
                  min="0"
                  :model-value="sheet.magicState.fsMagiePunkte ?? 0"
                  @update:model-value="setMagicMagiePunkte(Number($event))"
                />
              </UFormField>
              <div class="text-[10px] text-purple-900/80 pb-1">
                Kontingent = Magie-Punkte ÷ 5<br>
                Ein Spruch belegt Plätze = Stärkeklasse
              </div>
            </div>

            <div class="space-y-1">
              <div class="text-[10px] uppercase tracking-widest text-purple-900">
                Vorbereitete Sprüche (Vorbereiten: 1 h Rast pro Spruch)
              </div>
              <div
                v-for="(spell, idx) in (sheet.magicState.fsVorbereitet ?? [])"
                :key="idx"
                class="grid grid-cols-12 gap-1 items-center"
              >
                <UInput
                  class="col-span-6"
                  size="xs"
                  :model-value="spell.name"
                  placeholder="Spruchname"
                  :maxlength="60"
                  @update:model-value="updateFsPrepared(idx, { name: String($event) })"
                />
                <USelect
                  class="col-span-2"
                  size="xs"
                  :model-value="spell.stufe"
                  :items="[1,2,3,4,5].map((n) => ({ label: 'St. ' + n, value: n }))"
                  value-key="value"
                  @update:model-value="setFsPreparedStufe(idx, $event)"
                />
                <UInput
                  class="col-span-2"
                  size="xs"
                  type="number"
                  min="0"
                  :model-value="spell.charges"
                  placeholder="Anz."
                  title="Wie oft kann der Spruch noch gewirkt werden?"
                  @update:model-value="updateFsPrepared(idx, { charges: Math.max(0, Math.floor(Number($event) || 0)) })"
                />
                <UButton
                  class="col-span-2"
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="i-lucide-x"
                  @click="removeFsPrepared(idx)"
                />
              </div>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addFsPrepared">
                Spruch
              </UButton>
            </div>
            <p class="text-[10px] text-purple-900/80">
              Rituale: Stufe = Anzahl Magie-Würfe · 3 Fehlschläge = Ritual scheitert ·
              W100 vs. Magie −30 bei Misserfolg → Zutat zurück
            </p>
          </div>

          <!-- ====== Seelensplittermagie-Block (§8.13.3) ====== -->
          <div
            v-if="sheet.magicState.module === 'seelensplitter'"
            class="mt-2 p-2 rounded border border-red-300 bg-red-50/60 space-y-2"
          >
            <div class="text-xs uppercase tracking-widest text-red-900 flex items-baseline justify-between">
              <span>Seelensplittermagie (§8.13.3)</span>
              <span
                v-if="(sheet.magicState.seeleVerbraucht ?? 0) > 99"
                class="text-[10px] normal-case tracking-normal font-mono px-1.5 py-0.5 rounded bg-red-700 text-white"
                title="Über 99 % Seelen-Verbrauch — Charakter gilt als (vermutet) tot."
              >
                💀 KRITISCH
              </span>
            </div>
            <UFormField label="Verbrauchte Seele (%)">
              <UInput
                type="number"
                min="0"
                max="100"
                :model-value="sheet.magicState.seeleVerbraucht ?? 0"
                @update:model-value="setSeeleVerbraucht(Number($event))"
              />
            </UFormField>
            <!-- Fortschrittsbalken: rot intensiver, je höher der Wert. -->
            <div class="h-2 rounded overflow-hidden bg-white/60 border border-red-200">
              <div
                class="h-full transition-all"
                :style="{
                  width: Math.min(100, sheet.magicState.seeleVerbraucht ?? 0) + '%',
                  background: 'linear-gradient(90deg, #fca5a5, #b91c1c)',
                }"
              />
            </div>
            <p class="text-[10px] text-red-900/80">
              Mind. 1 % pro Zauber · Vor jeder Probe W100; Wurf ≤ verbrauchter % = Schreckens-/Todesvision ·
              &gt; 99 % = vermutet tot
            </p>
          </div>

          <!-- ====== "Frei"-Modul (kein strukturiertes System) ====== -->
          <p
            v-if="sheet.magicState.module === 'frei'"
            class="text-[10px] text-ink-300 italic"
          >
            Kein strukturiertes Magie-Modul aktiv. Nutze das Freitext-Feld unten oder
            die Standard-Zauber-Sektion ("Zauber & Magie") für freie Spruch-Definitionen.
          </p>
        </div>
      </div>

      <UFormField
        label="Zauber, Foki, Sprüche (Freitext)"
        help="Zusätzlich zu den strukturierten Zaubern oben — für freie Notizen, Spruchrollen, magische Gegenstände."
      >
        <UTextarea
          rows="6"
          placeholder="z.B. Spruchrolle Heilende Hände (1×), Amulett der Manaregeneration (+1/h) …"
          :model-value="sheet.magic"
          class="w-full"
          @update:model-value="setText('magic', String($event))"
        />
      </UFormField>
    </SheetSection>

    <SheetSection title="Anmerkungen">
      <UTextarea
        rows="11"
        placeholder="Kontakte, Hintergrund, sonstiges…"
        :model-value="sheet.notes"
        class="w-full"
        @update:model-value="setText('notes', String($event))"
      />
    </SheetSection>
  </div>
</template>
