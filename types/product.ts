export interface MeliProduct {
  id: string;
  title: string;
  seller_sku: string | null;
  available_quantity: number;
  status: 'active' | 'paused' | 'closed' | 'under_review';
  price: number;
  last_updated: string;
  permalink: string;
  shipping: {
    mode: string;
    free_shipping: boolean;
    logistic_type: string | null;
  };
}

export interface DashboardProduct {
  id: string;
  title: string;
  sku: string;
  stock: number;
  stockStatus: 'normal' | 'bajo';
  publicationStatus: string;
  fulfillment: string;
  lastUpdated: string;
  price: string;
  permalink: string;
}
