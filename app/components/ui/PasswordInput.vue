<script setup lang="ts">
/**
 * Passwort-Eingabe mit Augen-Toggle. Zeigt das Passwort als Dots an, ein Klick
 * auf das Icon schaltet auf Klartext um und zurueck.
 */
const model = defineModel<string>({ required: true })

defineProps<{
  placeholder?: string
  autocomplete?: string
  required?: boolean
  disabled?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>()

const visible = ref(false)
const toggle = () => (visible.value = !visible.value)
</script>

<template>
  <div class="relative">
    <UInput
      v-model="model"
      :type="visible ? 'text' : 'password'"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :required="required"
      :disabled="disabled"
      :size="size"
      :ui="{ trailing: 'pe-9' }"
      class="w-full"
    />
    <button
      type="button"
      class="absolute inset-y-0 right-0 flex items-center px-2 text-ink-300 hover:text-ink-100"
      :aria-label="visible ? 'Passwort verbergen' : 'Passwort anzeigen'"
      :title="visible ? 'Passwort verbergen' : 'Passwort anzeigen'"
      tabindex="-1"
      @click="toggle"
    >
      <UIcon :name="visible ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="text-base" />
    </button>
  </div>
</template>
