<script setup lang="ts">
import type { HtbahTalent } from '~~/shared/engines/htbah'
import { HTBAH_TALENT_LABELS, HTBAH_TALENTS } from '~~/shared/engines/htbah'

interface SharePayloadResponse {
  available: boolean
  name?: string
  portraitUrl?: string | null
  skills?: { id: string; name: string; talent: HtbahTalent }[]
  story?: string | null
}

const props = defineProps<{
  groupId: number
  messageId: number
}>()

const data = ref<SharePayloadResponse | null>(null)
const loading = ref(true)
const errorMsg = ref<string | null>(null)

const load = async () => {
  loading.value = true
  errorMsg.value = null
  try {
    data.value = await $fetch<SharePayloadResponse>(
      `/api/groups/${props.groupId}/messages/${props.messageId}/share`,
    )
  } catch (e: unknown) {
    errorMsg.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Bogen konnte nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const skillsByTalent = computed(() => {
  const out: Record<HtbahTalent, { id: string; name: string }[]> = {
    handeln: [],
    wissen: [],
    soziales: [],
  }
  for (const s of data.value?.skills ?? []) {
    out[s.talent].push({ id: s.id, name: s.name })
  }
  return out
})

const portraitSrc = computed(() => {
  if (!data.value?.available || !data.value.portraitUrl) return null
  return `/api/groups/${props.groupId}/messages/${props.messageId}/portrait`
})

const hasAnySkill = computed(() => (data.value?.skills?.length ?? 0) > 0)
const hasStory = computed(() =>
  Boolean(data.value?.story && data.value.story.trim().length > 0),
)
</script>

<template>
  <div
    class="border border-parchment-700/30 rounded-md bg-parchment-100/40 p-3 max-w-md"
  >
    <div v-if="loading" class="text-xs text-ink-300">Bogen wird geladen …</div>
    <div v-else-if="errorMsg" class="text-xs text-rose-700">{{ errorMsg }}</div>
    <div v-else-if="data && !data.available" class="text-xs text-ink-300 italic">
      Geteilter Charakter ist nicht mehr verfuegbar.
    </div>
    <div v-else-if="data" class="space-y-3">
      <div class="flex items-center gap-3">
        <div
          class="w-14 h-14 rounded-full overflow-hidden bg-parchment-700/10 border border-parchment-700/30 shrink-0"
        >
          <img
            v-if="portraitSrc"
            :src="portraitSrc"
            :alt="data.name"
            class="w-full h-full object-cover"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center text-ink-300 text-[10px]"
          >
            kein Bild
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[10px] uppercase tracking-widest text-[var(--color-accent)]">
            Charakterbogen
          </div>
          <div class="font-serif text-base truncate">{{ data.name }}</div>
        </div>
      </div>

      <div v-if="hasAnySkill" class="space-y-1">
        <div class="text-[10px] uppercase tracking-widest text-ink-300">
          Faehigkeiten
        </div>
        <div
          v-for="talent in HTBAH_TALENTS"
          :key="talent"
        >
          <div
            v-if="skillsByTalent[talent].length"
            class="text-xs"
          >
            <span class="font-semibold text-ink-500">
              {{ HTBAH_TALENT_LABELS[talent] }}:
            </span>
            <span class="text-ink-500">
              {{ skillsByTalent[talent].map((s) => s.name || '(unbenannt)').join(', ') }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="hasStory" class="space-y-1">
        <div class="text-[10px] uppercase tracking-widest text-ink-300">
          Hintergrund
        </div>
        <div class="text-xs text-ink-500 whitespace-pre-wrap">{{ data.story }}</div>
      </div>

      <div v-if="!hasAnySkill && !hasStory" class="text-xs text-ink-300 italic">
        Kein Inhalt zum Anzeigen ausgewaehlt.
      </div>
    </div>
  </div>
</template>
