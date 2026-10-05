export interface ProductPart {
  componentIds?: string[];
  id: string;
  format?: string;
  isOwned?: boolean;
  name?: string;
  values?: Record<string, string>;
}

export interface Product {
  id: string;
  category?: string;
  categoryReason?: string;
  categorySource?: string;
  children?: ProductPart[];
  coverageSources?: Array<{ name: string; productId?: string }>;
  coveredBy?: string[];
  format?: string;
  isCovered?: boolean;
  isFirstParty?: boolean;
  isNew?: boolean;
  name?: string;
  price?: number | string | null;
  primaryCategoryId?: string | null;
  publisher?: string | null;
  type?: string;
  url?: string;
  variants?: ProductPart[];
}

export interface PanelData {
  errorCode?: string;
  errorMessage?: string;
  lastUpdated?: number;
  ownedCount?: number;
  products?: Product[];
  stage?: string;
  syncing?: boolean;
  totalCatalog?: number;
}

export interface FilterPrefs {
  collapsedCategories: string[];
  format: string;
  hiddenCategories: string[];
  publisher: string;
  showCovered: boolean;
}

export interface FilterState {
  format: string;
  publisher: string;
  search: string;
}

export interface ScopeStats {
  covered: number;
  dismissed: number;
  hidden: number;
  missing: number;
  owned: number | null;
  total: number | null;
  visible: number;
}

export interface CategoryGroup {
  badge: string;
  key: string;
  products: Product[];
}
