<script setup lang="ts">
interface Option {
  key: string;
  label: string;
}

defineProps<{
  label: string;
  modelValue: string;
  options: readonly Option[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();
</script>

<template>
  <div class="segmented" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.key"
      class="segmented__button"
      :class="{ 'segmented__button--active': modelValue === option.key }"
      type="button"
      :aria-pressed="modelValue === option.key"
      @click="emit('update:modelValue', option.key)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
