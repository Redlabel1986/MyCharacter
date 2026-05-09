<script setup lang="ts">
import type { HtbahCharacterData, HtbahSkill, HtbahTalent } from '~~/shared/engines/htbah'
import { HTBAH_TALENT_LABELS, HTBAH_TALENTS } from '~~/shared/engines/htbah'

interface CharacterListItem {
  id: number
  system: string
  name: string
  updatedAt: string
}

const props = defineProps<{ groupId: number }>()
const emit = defineEmits<{ shared: [] }>()

const open = defineModel<boolean>('open', { required: true })

const loadingChars = ref(false)
const charList = ref<CharacterListItem[]>([])
const selectedCharacterId = ref<number | undefined>(undefined)

const loadingSheet = ref(false)
const sheetData = ref<HtbahCharacterData | null>(null)

const checkedSkillIds = ref<Set<string>>(new Set())
const showStory = ref(false)
const submitting = ref(false)
const errorMsg = ref<string | null>(null)

const fetchCharacters = async () => {
  loadingChars.value = true
  try {
    const res = await $fetch<{ characters: CharacterListItem[] }>('/api/characters')
    charList.value = res.characters.filter((c) => c.system === 'htbah')
    if (charList.value.length === 1) {
      const only = charList.value[0]
      if (only) selectedCharacterId.value = only.id
    }
  } finally {
    loadingChars.value = false
  }
}

const fetchSheet = async (id: number) => {
  loadingSheet.value = true
  sheetData.value = null
  checkedSkillIds.value = new Set()
  try {
    const res = await $fetch<{ character: { data: HtbahCharacterData } }>(
      `/api/characters/${id}`,
    )
    sheetData.value = res.character.data
  } finally {
    loadingSheet.value = false
  }
}

watch(selectedCharacterId, (id) => {
  if (id) fetchSheet(id)
})

watch(open, (v) => {
  if (v) {
    errorMsg.value = null
    submitting.value = false
    selectedCharacterId.value = undefined
    sheetData.value = null
    checkedSkillIds.value = new Set()
    showStory.value = false
    fetchCharacters()
  }
})

const skillsByTalent = computed<Record<HtbahTalent, HtbahSkill[]>>(() => {
  const out: Record<HtbahTalent, HtbahSkill[]> = {
    handeln: [],
    wissen: [],
    soziales: [],
  }
  for (const s of sheetData.value?.skills ?? []) {
    out[s.talent].push(s)
  }
  return out
})

const hasStoryText = computed(() => {
  const t = sheetData.value?.backstory?.text?.trim()
  return Boolean(t && t.length > 0)
})

const toggleSkill = (id: string) => {
  const next = new Set(checkedSkillIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  checkedSkillIds.value = next
}

const toggleTalentAll = (talent: HtbahTalent) => {
  const ids = skillsByTalent.value[talent].map((s) => s.id)
  const next = new Set(checkedSkillIds.value)
  const allOn = ids.length > 0 && ids.every((id) => next.has(id))
  if (allOn) ids.forEach((id) => next.delete(id))
  else ids.forEach((id) => next.add(id))
  checkedSkillIds.value = next
}

const canSubmit = computed(() => {
  if (!selectedCharacterId.value) return false
  if (submitting.value) return false
  return checkedSkillIds.value.size > 0 || showStory.value
})

const submit = async () => {
  if (!canSubmit.value || !selectedCharacterId.value) return
  submitting.value = true
  errorMsg.value = null
  try {
    await $fetch(`/api/groups/${props.groupId}/messages`, {
      method: 'POST',
      body: {
        type: 'character_share',
        characterId: selectedCharacterId.value,
        visibleSkillIds: [...checkedSkillIds.value],
        showStory: showStory.value,
      },
    })
    emit('shared')
    open.value = false
  } catch (e: unknown) {
    errorMsg.value =
      (e as { statusMessage?: string }).statusMessage ?? 'Konnte Bogen nicht teilen.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Charakterbogen teilen" :ui="{ content: 'max-w-2xl' }">
    <template #body>
      <div class="space-y-4">
        <UFormField label="Welcher Charakter?">
          <USelect
            v-if="charList.length"
            v-model="selectedCharacterId"
            :items="charList.map((c) => ({ label: c.name, value: c.id }))"
            placeholder="Charakter auswaehlen"
            class="w-full"
          />
          <div v-else-if="loadingChars" class="text-sm text-ink-400">Laedt …</div>
          <div v-else class="text-sm text-ink-400">
            Du hast noch keinen HtbaH-Charakter.
          </div>
        </UFormField>

        <div v-if="selectedCharacterId && loadingSheet" class="text-sm text-ink-400">
          Bogen wird geladen …
        </div>

        <div v-if="sheetData && !loadingSheet" class="space-y-4">
          <div>
            <div class="text-xs uppercase tracking-widest text-ink-300 mb-1">
              Faehigkeiten (ohne Punkte teilen)
            </div>
            <div class="space-y-3 max-h-72 overflow-y-auto pr-1">
              <div v-for="talent in HTBAH_TALENTS" :key="talent">
                <div
                  v-if="skillsByTalent[talent].length"
                  class="flex items-center justify-between mb-1"
                >
                  <div class="font-serif text-sm">
                    {{ HTBAH_TALENT_LABELS[talent] }}
                  </div>
                  <UButton
                    size="xs"
                    variant="ghost"
                    @click="toggleTalentAll(talent)"
                  >
                    Alle umschalten
                  </UButton>
                </div>
                <div class="grid grid-cols-2 gap-1">
                  <label
                    v-for="s in skillsByTalent[talent]"
                    :key="s.id"
                    class="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-parchment-700/10 cursor-pointer"
                  >
                    <UCheckbox
                      :model-value="checkedSkillIds.has(s.id)"
                      @update:model-value="toggleSkill(s.id)"
                    />
                    <span class="truncate">{{ s.name || '(unbenannt)' }}</span>
                  </label>
                </div>
                <div
                  v-if="!skillsByTalent[talent].length"
                  class="text-xs text-ink-300 italic mb-1"
                >
                  — keine Faehigkeiten in {{ HTBAH_TALENT_LABELS[talent] }}
                </div>
              </div>
            </div>
          </div>

          <UFormField>
            <label class="flex items-center gap-2 text-sm cursor-pointer">
              <UCheckbox v-model="showStory" :disabled="!hasStoryText" />
              <span>
                Hintergrundgeschichte mitschicken
                <span v-if="!hasStoryText" class="text-ink-300">— keine Story hinterlegt</span>
              </span>
            </label>
          </UFormField>

          <UAlert v-if="errorMsg" color="error" :title="errorMsg" />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" @click="open = false">Abbrechen</UButton>
        <UButton
          color="primary"
          :disabled="!canSubmit"
          :loading="submitting"
          @click="submit"
        >
          In Chat teilen
        </UButton>
      </div>
    </template>
  </UModal>
</template>
