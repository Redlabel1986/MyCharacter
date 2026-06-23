<script setup lang="ts">
/**
 * Generischer Charakterbogen fuer CUSTOM-Regelwerke.
 *
 * Liest die RuleSystemDefinition (per ruleSystemId) und rendert daraus dynamisch
 * HP, Attribute, Fertigkeiten, Inventar und Notizen. Die Charakterdaten liegen
 * in `data` (CustomCharacterData) und werden ueber v-model:data zurueckgegeben.
 *
 * WICHTIG: Aenderungen werden IMMUTABEL nach oben gereicht (neues Objekt bei
 * jeder Aenderung) — sonst erkennt die Charakter-Seite kein „ungespeichert".
 *
 * Phase 1: Anzeigen/Editieren + lokaler Probe-Wuerfler. Magie-/Kampfmodule folgen.
 */
import {
  resolveStatValue,
  statContext,
  type RuleSystemDefinition,
  type CustomCharacterData,
  type RsSpellDef,
} from '~~/shared/rule-system'
import { evalFormula, rollFormula } from '~~/shared/formula'

const props = defineProps<{
  system?: string
  characterId?: number
  ruleSystemId?: number
}>()

const model = defineModel<Record<string, unknown>>('data', { default: () => ({}) })

const definition = ref<RuleSystemDefinition | null>(null)
const defError = ref<string | null>(null)
const loading = ref(true)

// Lokale, editierbare Kopie der Charakterdaten. Aenderungen werden per Deep-Watch
// als NEUES Objekt nach oben emittiert.
const local = ref<CustomCharacterData | null>(null)
let watching = false

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** Rohe Daten in die erwartete Form bringen (Defaults aus der Definition). */
function normalize(raw: unknown, def: RuleSystemDefinition): CustomCharacterData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CustomCharacterData>
  const attributes: Record<string, number> = {}
  for (const a of def.attributes) {
    const v = r.attributes?.[a.key]
    attributes[a.key] = typeof v === 'number' ? v : a.default
  }
  const skills: Record<string, number> = {}
  for (const s of def.skills) {
    const v = r.skills?.[s.key]
    skills[s.key] = typeof v === 'number' ? v : s.default
  }
  const hp = r.resources?.hp
  const out: CustomCharacterData = {
    attributes,
    skills,
    resources: {
      hp: {
        current: typeof hp?.current === 'number' ? hp.current : 10,
        max: typeof hp?.max === 'number' ? hp.max : 10,
      },
    },
    inventory: typeof r.inventory === 'string' ? r.inventory : '',
    notes: typeof r.notes === 'string' ? r.notes : '',
  }
  // Magie-Modul -> Mana-Pool (vorhandene Werte behalten, sonst aus Formel).
  const mm = def.modules?.magic
  if (mm?.enabled) {
    const mana = r.resources?.mana
    const ctx = { ...attributes, ...skills }
    const manaMax = typeof mana?.max === 'number'
      ? mana.max
      : Math.max(0, Math.round(evalFormula(mm.resourceMaxFormula, ctx, 0)))
    out.resources.mana = {
      current: typeof mana?.current === 'number' ? mana.current : manaMax,
      max: manaMax,
    }
  }
  // Kampf-Modul -> Waffenliste.
  if (def.modules?.combat?.enabled) {
    out.weapons = Array.isArray(r.weapons) ? r.weapons : []
  }
  return out
}

onMounted(async () => {
  if (!props.ruleSystemId) {
    defError.value = 'Kein Regelwerk verknüpft.'
    loading.value = false
    return
  }
  try {
    const res = await $fetch<{ ruleSystem: { definition: RuleSystemDefinition } }>(
      `/api/rule-systems/${props.ruleSystemId}`,
    )
    definition.value = res.ruleSystem.definition
    local.value = normalize(model.value, definition.value)
    await nextTick()
    watching = true
  } catch {
    defError.value = 'Regelwerk-Definition nicht ladbar (evtl. gelöscht oder nicht freigegeben).'
  } finally {
    loading.value = false
  }
})

// Bei jeder lokalen Aenderung ein neues Objekt nach oben geben.
watch(
  local,
  () => {
    if (watching && local.value) model.value = clone(local.value)
  },
  { deep: true },
)

// --- Lokaler Probe-Würfler (nur Anzeige, keine Persistenz) ---
const rollTargetKey = ref<string>('')
const rollDc = ref(10)
const rollResult = ref<string | null>(null)

const rollTargets = computed(() => {
  const def = definition.value
  const l = local.value
  if (!def || !l) return [] as { label: string; value: string; val: number }[]
  const out: { label: string; value: string; val: number }[] = []
  for (const a of def.attributes) out.push({ label: `${a.label} (Attribut)`, value: `attr:${a.key}`, val: l.attributes[a.key] ?? a.default })
  for (const s of def.skills) out.push({ label: `${s.label} (Fertigkeit)`, value: `skill:${s.key}`, val: l.skills[s.key] ?? s.default })
  return out
})
const rollSelectItems = computed(() => rollTargets.value.map((t) => ({ label: t.label, value: t.value })))

const d = (size: number) => Math.floor(Math.random() * size) + 1
const doRoll = () => {
  const def = definition.value
  const target = rollTargets.value.find((t) => t.value === rollTargetKey.value)
  if (!def || !target) {
    rollResult.value = 'Bitte erst ein Ziel wählen.'
    return
  }
  const m = def.dice.mechanic
  if (m === 'roll-under') {
    const roll = d(def.dice.dieSize)
    const ok = roll <= target.val
    rollResult.value = `1W${def.dice.dieSize} = ${roll} ${ok ? '≤' : '>'} ${target.val} → ${ok ? 'Erfolg ✓' : 'Misserfolg ✗'}`
  } else if (m === 'roll-over') {
    const roll = d(def.dice.dieSize)
    const sum = roll + target.val
    const ok = sum >= rollDc.value
    rollResult.value = `1W${def.dice.dieSize} = ${roll} + ${target.val} = ${sum} vs Schwelle ${rollDc.value} → ${ok ? 'Erfolg ✓' : 'Misserfolg ✗'}`
  } else {
    const rolls = [d(20), d(20), d(20)]
    const successes = rolls.filter((r) => r <= target.val).length
    rollResult.value = `3W20 = [${rolls.join(', ')}] vs ${target.val} → ${successes}/3 Erfolge`
  }
}

const diceHint = computed(() => {
  const m = definition.value?.dice.mechanic
  if (m === 'roll-under') return 'Unterwürfeln: 1WX ≤ Wert'
  if (m === 'roll-over') return 'Überwürfeln: 1WX + Wert ≥ Schwelle'
  if (m === 'pool-3d20') return 'Pool: 3W20, Erfolg je Würfel ≤ Wert'
  return ''
})

const genId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `w-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  }
}

// --- Magie-Modul ---
const magicMod = computed(() => definition.value?.modules?.magic ?? null)
const magicActive = computed(() => !!magicMod.value?.enabled)
const spellResult = ref<string | null>(null)

// Probe nach der Systemmechanik. Liefert {success, text}.
const runCheck = (statVal: number, difficulty: number) => {
  const def = definition.value!
  const m = def.dice.mechanic
  if (m === 'roll-under') {
    const roll = d(def.dice.dieSize)
    const target = statVal - difficulty
    return { success: roll <= target, text: `1W${def.dice.dieSize}=${roll} ≤ ${target}` }
  }
  if (m === 'roll-over') {
    const roll = d(def.dice.dieSize)
    const dc = 10 + difficulty
    return { success: roll + statVal >= dc, text: `1W${def.dice.dieSize}=${roll}+${statVal} vs ${dc}` }
  }
  const rolls = [d(20), d(20), d(20)]
  const succ = rolls.filter((r) => r <= statVal).length
  return { success: succ >= 1, text: `3W20=[${rolls.join(',')}] → ${succ} Erfolge` }
}

const castSpell = (sp: RsSpellDef) => {
  const def = definition.value
  const l = local.value
  const mag = magicMod.value
  if (!def || !l || !mag) return
  if (!l.resources.mana) l.resources.mana = { current: 0, max: 0 }
  if (l.resources.mana.current < sp.cost) {
    spellResult.value = `${sp.name}: nicht genug ${mag.resourceName}.`
    return
  }
  const statVal = resolveStatValue(l, mag.castStat)
  const check = runCheck(statVal, sp.difficulty)
  l.resources.mana.current = Math.max(0, l.resources.mana.current - sp.cost)
  const costNote = `(−${sp.cost} ${mag.resourceName})`
  if (!check.success) {
    spellResult.value = `${sp.name}: Probe ${check.text} → misslungen. ${costNote}`
    return
  }
  if (sp.kind === 'utility') {
    spellResult.value = `${sp.name}: Probe ${check.text} → gelungen. ${costNote}`
    return
  }
  const eff = rollFormula(sp.effectFormula, statContext(l))
  if (sp.kind === 'heal') {
    l.resources.hp.current = Math.min(l.resources.hp.max, l.resources.hp.current + eff.total)
    spellResult.value = `${sp.name}: ${check.text} → +${eff.total} HP (${eff.detail}). ${costNote}`
  } else {
    spellResult.value = `${sp.name}: ${check.text} → ${eff.total} Schaden (${eff.detail}). ${costNote}`
  }
}

// --- Kampf-Modul ---
const combatMod = computed(() => definition.value?.modules?.combat ?? null)
const combatActive = computed(() => !!combatMod.value?.enabled)
const attackDc = ref(10)
const combatResult = ref<string | null>(null)

const addWeapon = () => {
  const l = local.value
  if (!l) return
  if (!l.weapons) l.weapons = []
  l.weapons.push({ id: genId(), name: 'Neue Waffe', damageFormula: '1d6' })
}
const removeWeapon = (idx: number) => {
  local.value?.weapons?.splice(idx, 1)
}
const weaponAttack = (w: { name: string }) => {
  const def = definition.value
  const l = local.value
  const cb = combatMod.value
  if (!def || !l || !cb) return
  const statVal = resolveStatValue(l, cb.attackStat)
  const check = runCheck(statVal, def.dice.mechanic === 'roll-over' ? attackDc.value - 10 : 0)
  combatResult.value = `${w.name} — Angriff: ${check.text} → ${check.success ? 'Treffer ✓' : 'daneben ✗'}`
}
const weaponDamage = (w: { name: string; damageFormula: string }) => {
  const l = local.value
  if (!l) return
  const eff = rollFormula(w.damageFormula, statContext(l))
  combatResult.value = `${w.name} — Schaden: ${eff.total} (${eff.detail})`
}
</script>

<template>
  <div class="space-y-5">
    <div v-if="loading" class="parchment-card p-4 text-ink-400 italic">Lade Regelwerk …</div>
    <div v-else-if="defError" class="parchment-card p-4 text-amber-700">
      {{ defError }} — die rohen Charakterdaten bleiben erhalten, lassen sich hier aber nicht strukturiert anzeigen.
    </div>

    <template v-else-if="definition && local">
      <!-- HP -->
      <section class="parchment-card p-4">
        <h2 class="font-serif text-lg mb-2">Lebenspunkte</h2>
        <div class="flex items-center gap-3">
          <UFormField label="Aktuell">
            <UInput v-model.number="local.resources.hp.current" type="number" class="w-24" />
          </UFormField>
          <span class="text-2xl text-ink-300 mt-5">/</span>
          <UFormField label="Maximum">
            <UInput v-model.number="local.resources.hp.max" type="number" class="w-24" />
          </UFormField>
        </div>
      </section>

      <!-- Attribute -->
      <section class="parchment-card p-4">
        <h2 class="font-serif text-lg mb-3">Attribute</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <UFormField v-for="a in definition.attributes" :key="a.key" :label="`${a.label} (${a.key})`">
            <UInput v-model.number="local.attributes[a.key]" type="number" :min="a.min" :max="a.max" />
          </UFormField>
        </div>
      </section>

      <!-- Fertigkeiten -->
      <section v-if="definition.skills.length" class="parchment-card p-4">
        <h2 class="font-serif text-lg mb-3">Fertigkeiten</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <UFormField v-for="s in definition.skills" :key="s.key" :label="s.label">
            <UInput v-model.number="local.skills[s.key]" type="number" />
          </UFormField>
        </div>
      </section>

      <!-- Probe-Würfler -->
      <section class="parchment-card p-4">
        <h2 class="font-serif text-lg mb-1">Probe würfeln</h2>
        <p class="text-xs text-ink-300 mb-3">{{ diceHint }}</p>
        <div class="flex items-end gap-2 flex-wrap">
          <UFormField label="Ziel">
            <USelect v-model="rollTargetKey" :items="rollSelectItems" value-key="value" class="w-56" />
          </UFormField>
          <UFormField v-if="definition.dice.mechanic === 'roll-over'" label="Schwelle">
            <UInput v-model.number="rollDc" type="number" class="w-20" />
          </UFormField>
          <UButton color="primary" icon="i-lucide-dices" @click="doRoll">Würfeln</UButton>
        </div>
        <p v-if="rollResult" class="mt-3 font-mono text-sm bg-[var(--color-accent-soft)] border border-[var(--color-accent)]/30 rounded px-3 py-2">
          {{ rollResult }}
        </p>
      </section>

      <!-- Magie-Modul -->
      <section v-if="magicActive && magicMod && local.resources.mana" class="parchment-card p-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-serif text-lg flex items-center gap-2">
            <UIcon name="i-lucide-sparkles" class="size-4 text-[var(--color-accent)]" />
            Magie
          </h2>
          <div class="flex items-center gap-2 text-sm">
            <span class="text-ink-400">{{ magicMod.resourceName }}</span>
            <UInput v-model.number="local.resources.mana.current" type="number" class="w-16" size="xs" />
            <span class="text-ink-300">/ {{ local.resources.mana.max }}</span>
          </div>
        </div>
        <div v-if="!magicMod.spells.length" class="text-xs text-ink-300 italic">Dieses Regelwerk hat keine Zauber im Katalog.</div>
        <div v-else class="space-y-1.5">
          <div v-for="sp in magicMod.spells" :key="sp.id" class="flex items-center gap-2 p-2 rounded border border-parchment-700/30 bg-white/50">
            <div class="flex-1 min-w-0">
              <div class="font-serif">{{ sp.name }}</div>
              <div class="text-[11px] text-ink-400">
                {{ sp.kind === 'damage' ? 'Schaden' : sp.kind === 'heal' ? 'Heilung' : 'Effekt' }}
                <template v-if="sp.kind !== 'utility' && sp.effectFormula"> · {{ sp.effectFormula }}</template>
                · {{ sp.cost }} {{ magicMod.resourceName }}
                <template v-if="sp.difficulty"> · Erschwernis {{ sp.difficulty }}</template>
                <template v-if="sp.note"> · {{ sp.note }}</template>
              </div>
            </div>
            <UButton
              size="xs"
              color="primary"
              icon="i-lucide-wand-2"
              :disabled="local.resources.mana.current < sp.cost"
              @click="castSpell(sp)"
            >
              Zaubern
            </UButton>
          </div>
        </div>
        <p v-if="spellResult" class="mt-3 font-mono text-sm bg-[var(--color-accent-soft)] border border-[var(--color-accent)]/30 rounded px-3 py-2">
          {{ spellResult }}
        </p>
      </section>

      <!-- Kampf-Modul -->
      <section v-if="combatActive" class="parchment-card p-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="font-serif text-lg flex items-center gap-2">
            <UIcon name="i-lucide-swords" class="size-4 text-[var(--color-accent)]" />
            Kampf
          </h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-ink-400">Treffer-Schwelle</span>
            <UInput v-model.number="attackDc" type="number" class="w-16" size="xs" />
            <UButton size="xs" variant="outline" icon="i-lucide-plus" @click="addWeapon">Waffe</UButton>
          </div>
        </div>
        <div v-if="!local.weapons || !local.weapons.length" class="text-xs text-ink-300 italic">Noch keine Waffen — füge welche hinzu.</div>
        <div v-else class="space-y-1.5">
          <div v-for="(w, i) in local.weapons" :key="w.id" class="flex items-center gap-1.5 flex-wrap p-2 rounded border border-parchment-700/30 bg-white/50">
            <UInput v-model="w.name" size="xs" class="w-40" placeholder="Name" />
            <span class="text-[10px] text-ink-300">Schaden</span>
            <UInput v-model="w.damageFormula" size="xs" class="w-32" placeholder="1d6 + KOR" />
            <UButton size="xs" variant="outline" icon="i-lucide-dices" @click="weaponAttack(w)">Angriff</UButton>
            <UButton size="xs" color="error" variant="soft" icon="i-lucide-swords" @click="weaponDamage(w)">Schaden</UButton>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeWeapon(i)" />
          </div>
        </div>
        <p v-if="combatResult" class="mt-3 font-mono text-sm bg-[var(--color-accent-soft)] border border-[var(--color-accent)]/30 rounded px-3 py-2">
          {{ combatResult }}
        </p>
      </section>

      <!-- Inventar + Notizen -->
      <section class="grid sm:grid-cols-2 gap-4">
        <div class="parchment-card p-4">
          <h2 class="font-serif text-lg mb-2">Inventar</h2>
          <UTextarea v-model="local.inventory" :rows="6" placeholder="Ausrüstung, Gegenstände …" class="w-full" />
        </div>
        <div class="parchment-card p-4">
          <h2 class="font-serif text-lg mb-2">Notizen</h2>
          <UTextarea v-model="local.notes" :rows="6" placeholder="Hintergrund, Sonstiges …" class="w-full" />
        </div>
      </section>
    </template>
  </div>
</template>
