<script setup lang="ts">
import { computed } from "vue";

import { ProductOwnership } from "../../../ownership.js";
import { formatPrice } from "../model";
import type { Product, ProductPart } from "../types";

const props = defineProps<{
  format: string;
  product: Product;
}>();

const emit = defineEmits<{
  dismiss: [productId: string];
  open: [url: string];
}>();

const relevantParts = computed(
  () => ProductOwnership.getRelevantParts(props.product, props.format) as ProductPart[],
);
const ownedPartCount = computed(() => relevantParts.value.filter((part) => part.isOwned).length);
const coveredBy = computed(() =>
  Array.isArray(props.product.coveredBy)
    ? props.product.coveredBy.filter((source) => typeof source === "string")
    : [],
);
const missingChildren = computed(() =>
  (Array.isArray(props.product.children) ? props.product.children : []).filter(
    (child) => ProductOwnership.matchesFormat(child, props.format) && child.isOwned !== true,
  ),
);
const price = computed(() => formatPrice(props.product.price));
</script>

<template>
  <article class="product-row" :data-product-id="product.id">
    <a
      class="product-row__link"
      :href="product.url"
      @click.prevent="product.url && emit('open', product.url)"
    >
      <span class="product-row__title">
        {{ product.name || "(unnamed)" }}
        <span v-if="product.isNew" class="product-row__new">New</span>
      </span>
      <span class="product-row__meta">
        <span v-if="price">{{ price }}</span>
        <span
          v-if="product.isCovered && coveredBy.length"
          :title="`Covered by ${coveredBy.join(', ')}`"
        >
          Covered by {{ coveredBy.join(", ") }}
        </span>
        <span v-if="relevantParts.length > 0 && ownedPartCount > 0">
          {{ ownedPartCount }}/{{ relevantParts.length }} {{ format }} owned
        </span>
        <span v-if="product.publisher && !product.isFirstParty">{{ product.publisher }}</span>
      </span>
      <span v-for="child in missingChildren" :key="child.id" class="product-row__child">
        Missing: {{ child.name || "(unnamed)" }}
      </span>
    </a>
    <button
      class="product-row__dismiss"
      type="button"
      :aria-label="`Dismiss ${product.name || 'product'}`"
      title="Not interested"
      @click="emit('dismiss', product.id)"
    >
      <span aria-hidden="true">&times;</span>
    </button>
  </article>
</template>
