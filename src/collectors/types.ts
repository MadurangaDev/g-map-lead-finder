import { Zone } from "../models/Zone";
import { Lead } from "../models/Lead";

export interface SearchRequest {
  url: string;
  zone: Zone;
  category: string;
  query?: unknown;
}

export interface ListingDiscoveryResult {
  urls: string[];
  totalFound: number;
  duplicateCount: number;
}

export interface BusinessExtractionResult {
  lead: Lead | null;
  reason?: string;
}

export interface DirectoryCollector {
  collect(zone: Zone, category: string, query?: unknown): Promise<Lead[]>;
}