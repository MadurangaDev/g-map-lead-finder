export interface Lead {
  id?: number;

  business_name: string;

  phone_normalized?: string | null;

  phone_raw?: string | null;

  address?: string | null;

  category?: string | null;

  town?: string | null;

  zone?: string | null;

  latitude?: number | null;

  longitude?: number | null;

  rating?: number | null;

  reference_url?: string | null;

  notes?: string | null;

  sources?: string[];
}
