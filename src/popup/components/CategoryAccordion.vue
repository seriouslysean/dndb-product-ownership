<script setup lang="ts">
import { computed } from "vue";

import type { Product } from "../types";
import ProductRow from "./ProductRow.vue";

const props = defineProps<{
  category: string;
  collapsed: boolean;
  format: string;
  products: Product[];
}>();

const emit = defineEmits<{
  dismiss: [productId: string];
  open: [url: string];
  toggle: [];
}>();

const containsUnclassifiedOfficial = computed(
  () => props.category === "Other" && props.products.some((product) => product.isFirstParty),
);
</script>

<template>
  <section class="category-card">
    <button
      class="category-card__header"
      type="button"
      :aria-expanded="!collapsed"
      @click="emit('toggle')"
    >
      <svg class="category-card__chevron" aria-hidden="true" viewBox="0 0 16 16">
        <path d="m4 6 4 4 4-4" />
      </svg>
      <span class="category-card__title">{{ category }}</span>
      <span
        v-if="containsUnclassifiedOfficial"
        class="category-card__warning"
        title="One or more first-party products need a category override"
      >
        Review
      </span>
      <span class="category-card__count">{{ products.length }}</span>
    </button>
    <div v-show="!collapsed" class="category-card__body">
      <ProductRow
        v-for="product in products"
        :key="product.id"
        :format="format"
        :product="product"
        @dismiss="emit('dismiss', $event)"
        @open="emit('open', $event)"
      />
    </div>
  </section>
</template>
