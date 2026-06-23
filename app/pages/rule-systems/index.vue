<script setup lang="ts">
/**
 * Regelwerk-Builder ("Eigenes Regelwerk").
 *
 * Liste aller nutzbaren Regelwerke (eigene + global veroeffentlichte) und ein
 * Editor, mit dem man Attribute, Fertigkeiten, eine Wuerfelmechanik und die
 * HP-Formel definiert. Phase 1 — Module (Magie/Kampf) folgen spaeter.
 */
import {
  RS_DICE_MECHANICS,
  RS_DICE_LABELS,
  createDefaultRuleSystemDefinition,
  validateRuleSystemDefinition,
  type RuleSystemDefinition,
  type RsAttributeDef,
  type RsSkillDef,
  type RsDiceMechanic,
} from '~~/shared/rule-system'
import { isValidFormula } from '~~/shared/formula'

definePageMeta({ middleware: ['auth'] })

interface RuleSystemListItem {
  id: number
  name: string
  description: string
  published: boolean
  definition: RuleSystemDefinition
  isOwner: boolean
  updatedAt: string
}

const { data, refresh, pending } = await useFetch<{ ruleSystems: RuleSystemListItem[] }>(
  '/api/rule-systems',
  { default: () => ({ ruleSystems: [] }) },
)
const list = computed(() => data.value?.ruleSystems ?? [])

// --- Editor-State ---
const editorOpen = ref(false)
const editingId = ref<number | null>(null) // null = neu
const draftName = ref('')
const draftDescription = ref('')
const draftPublished = ref(false)
const draftDef = ref<RuleSystemDefinition>(createDefaultRuleSystemDefinition())
const saving = ref(false)
const saveError = ref<string | null>(null)

const diceItems = RS_DICE_MECHANICS.map((m) => ({ label: RS_DICE_LABELS[m], value: m }))
const attrSelectItems = computed(() => [
  { label: '— kein Attribut —', value: '' },
  ...draftDef.value.attributes.map((a) => ({ label: `${a.label} (${a.key})`, value: a.key })),
])

const openCreate = () => {
  editingId.value = null
  draftName.value = ''
  draftDescription.value = ''
  draftPublished.value = false
  draftDef.value = createDefaultRuleSystemDefinition()
  saveError.value = null
  editorOpen.value = true
}
const openEdit = (rs: RuleSystemListItem) => {
  editingId.value = rs.id
  draftName.value = rs.name
  draftDescription.value = rs.description
  draftPublished.value = rs.published
  draftDef.value = JSON.parse(JSON.stringify(rs.definition))
  // Defensiv: fehlende Felder aus alten Datensaetzen auffuellen.
  if (!draftDef.value.attributes) draftDef.value.attributes = []
  if (!draftDef.value.skills) draftDef.value.skills = []
  if (!draftDef.value.hp) draftDef.value.hp = { maxFormula: '10' }
  if (!draftDef.value.dice) draftDef.value.dice = { mechanic: 'roll-over', dieSize: 20 }
  saveError.value = null
  editorOpen.value = true
}

// Attribute
const addAttr = () => {
  const n = draftDef.value.attributes.length + 1
  draftDef.value.attributes.push({ key: `ATTR${n}`, label: `Attribut ${n}`, default: 10, min: 1, max: 20 } as RsAttributeDef)
}
const removeAttr = (idx: number) => draftDef.value.attributes.splice(idx, 1)

// Fertigkeiten
const addSkill = () => {
  const n = draftDef.value.skills.length + 1
  draftDef.value.skills.push({ key: `skill${n}`, label: `Fertigkeit ${n}`, attribute: '', default: 0 } as RsSkillDef)
}
const removeSkill = (idx: number) => draftDef.value.skills.splice(idx, 1)

// HP-Formel Live-Check
const attrSampleCtx = computed<Record<string, number>>(() => {
  const ctx: Record<string, number> = {}
  for (const a of draftDef.value.attributes) ctx[a.key] = a.default
  return ctx
})
const hpFormulaValid = computed(() => isValidFormula(draftDef.value.hp.maxFormula, attrSampleCtx.value))

const clientErrors = computed(() => validateRuleSystemDefinition(draftDef.value))
const canSave = computed(
  () => draftName.value.trim().length > 0 && clientErrors.value.length === 0 && hpFormulaValid.value,
)

const save = async () => {
  if (!canSave.value) {
    saveError.value = clientErrors.value[0] ?? (!hpFormulaValid.value ? 'HP-Formel ist ungültig.' : 'Name fehlt.')
    return
  }
  saving.value = true
  saveError.value = null
  try {
    const body = {
      name: draftName.value.trim(),
      description: draftDescription.value,
      published: draftPublished.value,
      definition: draftDef.value,
    }
    if (editingId.value) {
      await $fetch(`/api/rule-systems/${editingId.value}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/rule-systems', { method: 'POST', body })
    }
    editorOpen.value = false
    await refresh()
  } catch (e: unknown) {
    saveError.value = (e as { statusMessage?: string }).statusMessage ?? 'Speichern fehlgeschlagen.'
  } finally {
    saving.value = false
  }
}

const removeRs = async (rs: RuleSystemListItem) => {
  if (!confirm(`Regelwerk „${rs.name}" löschen?\n\nBereits erstellte Charaktere bleiben erhalten, verlieren aber die Anzeige-Definition.`)) return
  await $fetch(`/api/rule-systems/${rs.id}`, { method: 'DELETE' })
  await refresh()
}

const diceLabel = (m: RsDiceMechanic) => RS_DICE_LABELS[m]
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 class="font-serif text-3xl">Eigene Regelwerke</h1>
        <p class="text-sm text-ink-400 max-w-2xl">
          Bau dein eigenes Regelwerk: Attribute, Fertigkeiten, Würfelmechanik und HP-Formel.
          Beim Anlegen eines Charakters kannst du es auswählen. Veröffentlichte Regelwerke
          stehen allen Nutzern zur Verfügung. (Magie- &amp; Kampfmodule folgen.)
        </p>
      </div>
      <UButton color="primary" icon="i-lucide-plus" @click="openCreate">Neues Regelwerk</UButton>
    </div>

    <div v-if="pending && !list.length" class="text-ink-400">Lade…</div>
    <div v-else-if="!list.length" class="parchment-card p-10 text-center">
      <p class="font-serif text-xl">Noch keine Regelwerke.</p>
      <p class="text-ink-400 mt-2">Klick auf „Neues Regelwerk", um dein erstes eigenes System zu bauen.</p>
    </div>

    <div v-else class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <div v-for="rs in list" :key="rs.id" class="parchment-card p-4 flex flex-col">
        <div class="flex items-baseline gap-2 flex-wrap">
          <h2 class="font-serif text-lg flex-1 truncate">{{ rs.name }}</h2>
          <span v-if="rs.published" class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">öffentlich</span>
          <span v-if="!rs.isOwner" class="text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-semibold">fremd</span>
        </div>
        <p v-if="rs.description" class="text-xs text-ink-400 mt-1 line-clamp-2">{{ rs.description }}</p>
        <div class="text-[11px] text-ink-300 mt-2 space-y-0.5">
          <div>{{ rs.definition.attributes?.length ?? 0 }} Attribute · {{ rs.definition.skills?.length ?? 0 }} Fertigkeiten</div>
          <div>{{ diceLabel(rs.definition.dice?.mechanic ?? 'roll-over') }}</div>
        </div>
        <div class="flex gap-2 mt-3">
          <UButton v-if="rs.isOwner" size="xs" variant="outline" icon="i-lucide-pencil" @click="openEdit(rs)">Bearbeiten</UButton>
          <UButton v-else size="xs" variant="outline" icon="i-lucide-eye" @click="openEdit(rs)">Ansehen</UButton>
          <UButton v-if="rs.isOwner" size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeRs(rs)">Löschen</UButton>
        </div>
      </div>
    </div>

    <!-- Editor-Modal -->
    <UModal v-model:open="editorOpen" :title="editingId ? 'Regelwerk bearbeiten' : 'Regelwerk anlegen'" :ui="{ content: 'max-w-3xl' }">
      <template #body>
        <div class="space-y-4">
          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField label="Name">
              <UInput v-model="draftName" placeholder="z.B. „Mein Heldensystem“" :maxlength="80" />
            </UFormField>
            <UFormField label="Sichtbarkeit">
              <label class="flex items-center gap-2 text-sm h-9">
                <UCheckbox v-model="draftPublished" />
                <span>Öffentlich (alle Nutzer können es verwenden)</span>
              </label>
            </UFormField>
          </div>
          <UFormField label="Beschreibung (optional)">
            <UTextarea v-model="draftDescription" :rows="2" :maxlength="2000" />
          </UFormField>

          <!-- Würfelmechanik + HP -->
          <div class="grid sm:grid-cols-2 gap-3 border-t border-parchment-700/30 pt-3">
            <UFormField label="Würfelmechanik">
              <USelect v-model="draftDef.dice.mechanic" :items="diceItems" value-key="value" />
            </UFormField>
            <UFormField v-if="draftDef.dice.mechanic !== 'pool-3d20'" label="Würfelgröße (WX)">
              <UInput v-model.number="draftDef.dice.dieSize" type="number" min="2" max="1000" />
            </UFormField>
          </div>
          <UFormField label="HP-Maximum (Zahl oder Formel über Attribut-Keys)" :help="hpFormulaValid ? 'z.B. „20 + KOR * 2“ oder „100“' : 'Formel ungültig — prüfe Klammern/Attribut-Keys.'">
            <UInput
              v-model="draftDef.hp.maxFormula"
              placeholder="20 + KOR"
              :color="hpFormulaValid ? undefined : 'error'"
            />
          </UFormField>

          <!-- Attribute -->
          <div class="border-t border-parchment-700/30 pt-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold">Attribute</span>
              <UButton size="xs" variant="outline" icon="i-lucide-plus" @click="addAttr">Attribut</UButton>
            </div>
            <div class="space-y-1.5">
              <div v-for="(a, i) in draftDef.attributes" :key="i" class="flex items-center gap-1.5 flex-wrap">
                <UInput v-model="a.key" size="xs" class="w-20" placeholder="KEY" title="Key (für Formeln)" />
                <UInput v-model="a.label" size="xs" class="w-32" placeholder="Bezeichnung" />
                <span class="text-[10px] text-ink-300">Start</span>
                <UInput v-model.number="a.default" type="number" size="xs" class="w-16" />
                <span class="text-[10px] text-ink-300">min</span>
                <UInput v-model.number="a.min" type="number" size="xs" class="w-16" />
                <span class="text-[10px] text-ink-300">max</span>
                <UInput v-model.number="a.max" type="number" size="xs" class="w-16" />
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeAttr(i)" />
              </div>
            </div>
          </div>

          <!-- Fertigkeiten -->
          <div class="border-t border-parchment-700/30 pt-3">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold">Fertigkeiten</span>
              <UButton size="xs" variant="outline" icon="i-lucide-plus" @click="addSkill">Fertigkeit</UButton>
            </div>
            <div class="space-y-1.5">
              <div v-for="(s, i) in draftDef.skills" :key="i" class="flex items-center gap-1.5 flex-wrap">
                <UInput v-model="s.key" size="xs" class="w-24" placeholder="key" />
                <UInput v-model="s.label" size="xs" class="w-32" placeholder="Bezeichnung" />
                <span class="text-[10px] text-ink-300">Attribut</span>
                <USelect v-model="s.attribute" :items="attrSelectItems" value-key="value" size="xs" class="w-32" />
                <span class="text-[10px] text-ink-300">Start</span>
                <UInput v-model.number="s.default" type="number" size="xs" class="w-16" />
                <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeSkill(i)" />
              </div>
              <p v-if="!draftDef.skills.length" class="text-xs text-ink-300 italic">Keine Fertigkeiten (optional).</p>
            </div>
          </div>

          <p v-if="clientErrors.length" class="text-xs text-amber-700">{{ clientErrors[0] }}</p>
          <p v-if="saveError" class="text-sm text-red-700">{{ saveError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="editorOpen = false">Schließen</UButton>
          <UButton color="primary" :loading="saving" :disabled="!canSave" @click="save">Speichern</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
