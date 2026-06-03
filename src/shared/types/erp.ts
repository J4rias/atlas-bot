export interface Category {
  id: number;
  code: string;
  name: string;
  description: string | null;
  color: string;
  productCount: number;
}

export interface Presentation {
  id: number;
  name: string;
  units_per_package: number;
  package_price: string | null;
  base_price: string | null;
  is_default: boolean;
  packagingType?: { id: number; name: string } | null;
  presentationType?: { id: number; name: string } | null;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category: Category | null;
  brand: { id: number; name: string } | null;
  presentations: Presentation[];
  inventories?: { quantity: string; warehouse: { id: number; name: string } }[];
}

export interface PriceListSummary {
  id: number;
  code: string;
  name: string;
  currency: string;
  isDefault: boolean;
  validFrom: string | null;
  validUntil: string | null;
}

export interface PriceListDetail {
  presentation_id: number;
  product_id: number;
  package_price: string;
  unit_price: string;
  product?: { id: number; sku: string; name: string; image_url: string | null };
  presentation?: { id: number; name: string; units_per_package: number };
}

export interface PriceList extends PriceListSummary {
  details: PriceListDetail[];
}

export interface ExchangeRate {
  currency: string;
  rate: number;
  updated_at: string;
}
