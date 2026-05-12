<script setup lang="ts">
/**
 * Admin-Seite: globale Map-Objekt-Bibliothek.
 *
 * - Built-ins werden aus shared/map-objects.ts geladen und koennen pro Key
 *   einen Bild-/Meta-Override bekommen (gleicher Built-in-Key, neues Bild).
 * - Neue Eintraege ohne Built-in-Key landen als zusaetzliche globale Objekte
 *   in jedem Gruppen-Picker.
 */
import {
  BUILT_IN_MAP_OBJECTS,
  CATEGORY_LABELS,
  type MapObjectCategory,
  type MapObjectTemplateBuiltin,
} from '~~/shared/map-objects'

definePageMeta({ middleware: ['admin'] })

interface GlobalTemplate {
  id: number
  groupId: number | null
  builtInKey: string | null
  name: string
  category: string
  imageUrl: string | null
  width: number
  height: number
  rotatable: boolean
  lightRadius: number
}

const { data, refresh, pending } = await useFetch<{ templates: GlobalTemplate[] }>(
  '/api/admin/object-templates',
  { default: () => ({ templates: [] as GlobalTemplate[] }) },
)

const overrides = computed<Record<string, GlobalTemplate>>(() => {
  const m: Record<string, GlobalTemplate> = {}
  for (const t of data.value?.templates ?? []) {
    if (t.builtInKey) m[t.builtInKey] = t
  }
  return m
})

const newGlobals = computed<GlobalTemplate[]>(
  () => (data.value?.templates ?? []).filter((t) => !t.builtInKey),
)

// — Built-in-Override / Replace —
const replacingKey = ref<string | null>(null)
const replaceFile = ref<File | null>(null)
const replaceBusy = ref(false)
const replaceError = ref<string | null>(null)

const openReplace = (key: string) => {
  replacingKey.value = key
  replaceFile.value = null
  replaceError.value = null
}
const onReplaceFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  replaceFile.value = t.files?.[0] ?? null
}
const submitReplace = async () => {
  if (!replacingKey.value || !replaceFile.value) {
    replaceError.value = 'Bitte ein Bild auswaehlen.'
    return
  }
  replaceBusy.value = true
  replaceError.value = null
  try {
    const fd = new FormData()
    fd.append('file', replaceFile.value)
    fd.append('builtInKey', replacingKey.value)
    await $fetch('/api/admin/object-templates', { method: 'POST', body: fd })
    replacingKey.value = null
    replaceFile.value = null
    await refresh()
  } catch (e: unknown) {
    replaceError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Upload fehlgeschlagen.'
  } finally {
    replaceBusy.value = false
  }
}

const removeOverride = async (id: number) => {
  if (!confirm('Override entfernen — Standard-Bild wiederherstellen?')) return
  try {
    await $fetch(`/api/admin/object-templates/${id}`, { method: 'DELETE' })
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Loeschen fehlgeschlagen.')
  }
}

// — Neue globale Objekte —
const showNewForm = ref(false)
const newDraft = ref({
  name: '',
  category: 'misc' as MapObjectCategory,
  width: 1,
  height: 1,
  lightRadius: 0,
  rotatable: false,
  file: null as File | null,
})
const newBusy = ref(false)
const newError = ref<string | null>(null)
const onNewFile = (e: Event) => {
  const t = e.target as HTMLInputElement
  newDraft.value.file = t.files?.[0] ?? null
}
const submitNew = async () => {
  const d = newDraft.value
  if (!d.file || !d.name.trim()) {
    newError.value = 'Name und Bild benötigt.'
    return
  }
  newBusy.value = true
  newError.value = null
  try {
    const fd = new FormData()
    fd.append('file', d.file)
    fd.append('name', d.name.trim())
    fd.append('category', d.category)
    fd.append('width', String(d.width))
    fd.append('height', String(d.height))
    fd.append('lightRadius', String(d.lightRadius))
    fd.append('rotatable', d.rotatable ? 'true' : 'false')
    await $fetch('/api/admin/object-templates', { method: 'POST', body: fd })
    newDraft.value = {
      name: '',
      category: 'misc',
      width: 1,
      height: 1,
      lightRadius: 0,
      rotatable: false,
      file: null,
    }
    showNewForm.value = false
    await refresh()
  } catch (e: unknown) {
    newError.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Upload fehlgeschlagen.'
  } finally {
    newBusy.value = false
  }
}
const removeGlobal = async (id: number) => {
  if (!confirm('Globales Objekt aus der Bibliothek loeschen?')) return
  try {
    await $fetch(`/api/admin/object-templates/${id}`, { method: 'DELETE' })
    await refresh()
  } catch (e: unknown) {
    alert((e as { statusMessage?: string }).statusMessage ?? 'Loeschen fehlgeschlagen.')
  }
}

const builtinImage = (b: MapObjectTemplateBuiltin) => {
  const ov = overrides.value[b.key]
  if (ov) return `/api/admin/object-templates/${ov.id}/image`
  return b.imageUrl
}
const categoryLabel = (cat: string): string =>
  (CATEGORY_LABELS as Record<string, string>)[cat] ?? cat
</script>

<template>
  <div class="max-w-6xl mx-auto p-4 space-y-4">
    <div class="flex items-baseline justify-between">
      <h1 class="font-serif text-2xl">Map-Objekt-Bibliothek</h1>
      <NuxtLink to="/admin/users" class="text-sm text-[var(--color-accent)] hover:underline">
        ← Admin
      </NuxtLink>
    </div>
    <p class="text-sm text-ink-300">
      Built-ins haben ein Standard-Bild (Standard-SVG aus dem Code). Du kannst pro Eintrag ein
      eigenes Bild hochladen, das in ALLEN Gruppen das Original ersetzt. Zusätzlich kannst du
      neue globale Objekte hinzufügen, die in jedem Gruppen-Picker erscheinen.
    </p>

    <section class="parchment-card p-3 space-y-3">
      <div class="flex items-baseline justify-between">
        <h2 class="font-serif text-lg">Eingebaute Objekte</h2>
        <span class="text-[11px] text-ink-300">{{ BUILT_IN_MAP_OBJECTS.length }} Einträge</span>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <div
          v-for="b in BUILT_IN_MAP_OBJECTS"
          :key="b.key"
          class="parchment-card p-2 flex flex-col items-center gap-1 relative"
        >
          <div
            class="w-full checker rounded flex items-center justify-center overflow-hidden"
            :style="{ aspectRatio: `${b.width} / ${b.height}` }"
          >
            <img
              :src="builtinImage(b)"
              :alt="b.name"
              class="max-w-full max-h-full object-contain"
              draggable="false"
            >
          </div>
          <div class="text-[11px] font-semibold text-center leading-tight">{{ b.name }}</div>
          <div class="text-[9px] text-ink-300 uppercase tracking-widest">
            {{ b.width }}×{{ b.height }}
            <span v-if="b.rotatable">·↻</span>
            <span v-if="b.lightRadius > 0" class="text-amber-700">·☀{{ b.lightRadius }}</span>
          </div>
          <div
            v-if="overrides[b.key]"
            class="absolute top-1 left-1 text-[9px] uppercase tracking-widest font-bold bg-emerald-700 text-white px-1 rounded"
          >
            Override
          </div>
          <div class="flex gap-1 mt-1">
            <UButton size="xs" variant="outline" icon="i-lucide-image" @click="openReplace(b.key)">
              Bild
            </UButton>
            <UButton
              v-if="overrides[b.key]"
              size="xs"
              variant="ghost"
              color="error"
              icon="i-lucide-rotate-ccw"
              title="Override entfernen / Standard wiederherstellen"
              @click="removeOverride(overrides[b.key].id)"
            >
              Standard
            </UButton>
          </div>
        </div>
      </div>
    </section>

    <section class="parchment-card p-3 space-y-3">
      <div class="flex items-baseline justify-between">
        <h2 class="font-serif text-lg">Eigene globale Objekte</h2>
        <UButton size="sm" color="primary" icon="i-lucide-plus" @click="showNewForm = !showNewForm">
          Neues Objekt
        </UButton>
      </div>
      <p v-if="!newGlobals.length && !showNewForm" class="text-xs italic text-ink-300">
        Noch keine zusaetzlichen globalen Objekte. Klick auf „Neues Objekt", um eines hinzuzufuegen.
      </p>
      <div v-if="newGlobals.length" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <div
          v-for="g in newGlobals"
          :key="g.id"
          class="parchment-card p-2 flex flex-col items-center gap-1 relative"
        >
          <div
            class="w-full checker rounded flex items-center justify-center overflow-hidden"
            :style="{ aspectRatio: `${g.width} / ${g.height}` }"
          >
            <img
              v-if="g.imageUrl"
              :src="`/api/admin/object-templates/${g.id}/image`"
              :alt="g.name"
              class="max-w-full max-h-full object-contain"
              draggable="false"
            >
          </div>
          <div class="text-[11px] font-semibold text-center leading-tight">{{ g.name }}</div>
          <div class="text-[9px] text-ink-300 uppercase tracking-widest">
            {{ g.width }}×{{ g.height }}
            <span v-if="g.rotatable">·↻</span>
            <span v-if="g.lightRadius > 0" class="text-amber-700">·☀{{ g.lightRadius }}</span>
            · {{ categoryLabel(g.category) }}
          </div>
          <UButton
            size="xs"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            class="mt-1"
            @click="removeGlobal(g.id)"
          >
            Entfernen
          </UButton>
        </div>
      </div>

      <div v-if="showNewForm" class="border-t border-parchment-700/30 pt-3 space-y-2">
        <div class="grid sm:grid-cols-12 gap-2">
          <UFormField label="Name" class="sm:col-span-4">
            <UInput v-model="newDraft.name" />
          </UFormField>
          <UFormField label="Kategorie" class="sm:col-span-3">
            <USelect
              v-model="newDraft.category"
              :items="[
                { label: 'Transport', value: 'transport' },
                { label: 'Lagerung', value: 'storage' },
                { label: 'Licht', value: 'light' },
                { label: 'Lager', value: 'camp' },
                { label: 'Beute', value: 'loot' },
                { label: 'Natur', value: 'nature' },
                { label: 'Möbel', value: 'furniture' },
                { label: 'Sonstiges', value: 'misc' },
              ]"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Breite" class="sm:col-span-1">
            <UInput v-model.number="newDraft.width" type="number" min="1" max="8" />
          </UFormField>
          <UFormField label="Höhe" class="sm:col-span-1">
            <UInput v-model.number="newDraft.height" type="number" min="1" max="8" />
          </UFormField>
          <UFormField label="Licht" class="sm:col-span-1">
            <UInput v-model.number="newDraft.lightRadius" type="number" min="0" max="20" />
          </UFormField>
          <UFormField label="Drehbar" class="sm:col-span-2">
            <UCheckbox v-model="newDraft.rotatable" />
          </UFormField>
        </div>
        <UFormField label="Bild" help="JPEG/PNG/WEBP/SVG, max 4 MB.">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            class="block w-full text-sm"
            @change="onNewFile"
          >
        </UFormField>
        <p v-if="newError" class="text-sm text-red-700">{{ newError }}</p>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="showNewForm = false">Abbrechen</UButton>
          <UButton
            color="primary"
            :loading="newBusy"
            :disabled="!newDraft.file || !newDraft.name.trim()"
            @click="submitNew"
          >
            Hinzufügen
          </UButton>
        </div>
      </div>
    </section>

    <!-- Replace-Modal -->
    <UModal v-model:open="replacingKey" :title="`Bild ersetzen: ${replacingKey ?? ''}`">
      <template #body>
        <div class="space-y-3">
          <p class="text-xs text-ink-300">
            Lade ein neues Bild für den Built-in
            <code class="font-mono">{{ replacingKey }}</code> hoch. Es wird in allen Gruppen
            das Standard-SVG ersetzen. Format-Tipp: transparenter Hintergrund,
            Seitenverhältnis passend zur Footprint-Größe.
          </p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            class="block w-full text-sm"
            @change="onReplaceFile"
          >
          <p v-if="replaceError" class="text-sm text-red-700">{{ replaceError }}</p>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2 justify-end">
          <UButton variant="ghost" @click="replacingKey = null">Abbrechen</UButton>
          <UButton
            color="primary"
            :loading="replaceBusy"
            :disabled="!replaceFile"
            @click="submitReplace"
          >
            Bild ersetzen
          </UButton>
        </div>
      </template>
    </UModal>

    <p v-if="pending" class="text-xs text-ink-300 italic">Lade…</p>
  </div>
</template>

<style scoped>
/* Schachbrett-Hintergrund — zeigt Transparenz im PNG sichtbar an. */
.checker {
  background-color: #f4ead2;
  background-image:
    linear-gradient(45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(0, 0, 0, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(0, 0, 0, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(0, 0, 0, 0.08) 75%);
  background-size: 14px 14px;
  background-position: 0 0, 0 7px, 7px -7px, -7px 0;
}
</style>
