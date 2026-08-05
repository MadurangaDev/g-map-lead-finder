import fs from "fs";
import path from "path";
import db from "../database/db";
import { logger } from "../utils/logger";

export const OUTPUT_DIR = "output";

export interface CsvColumn {
  header: string;
  field: string;
}

interface LeadRow {
  business_name: string | null;
  phone_normalized: string | null;
  phone_raw: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  sources: string | null;
  rating: number | null;
  reference_url: string | null;
  town: string | null;
  zone: string | null;
  collected_at: string | null;
}

const COLUMNS: CsvColumn[] = [
  { header: "Business Name", field: "business_name" },
  { header: "Phone", field: "phone_normalized" },
  { header: "Phone (Raw)", field: "phone_raw" },
  { header: "Address", field: "address" },
  { header: "Latitude", field: "latitude" },
  { header: "Longitude", field: "longitude" },
  { header: "Source", field: "sources" },
  { header: "Rating", field: "rating" },
  { header: "Reference URL", field: "reference_url" },
  { header: "Town", field: "town" },
  { header: "Zone", field: "zone" },
  { header: "Collected At", field: "collected_at" },
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toFsSafe(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export function generateExportFilename(
  territory: string,
  area: string,
  category: string,
  timestamp?: string,
): string {
  const safeArea = toFsSafe(area);
  const safeCategory = toFsSafe(category);
  const safeTerritory = toFsSafe(territory);
  const base = `${safeArea}-${safeCategory}-${safeTerritory}`;
  if (timestamp) {
    return `${base}-${timestamp}.csv`;
  }
  return `${base}.csv`;
}

function formatSources(sources: string | null): string {
  if (!sources) {
    return "";
  }
  try {
    const parsed = JSON.parse(sources);
    if (Array.isArray(parsed)) {
      return parsed.join("; ");
    }
    return String(parsed);
  } catch {
    return sources;
  }
}

function getField(lead: LeadRow, field: string): unknown {
  switch (field) {
    case "business_name":
      return lead.business_name;
    case "phone_normalized":
      return lead.phone_normalized;
    case "phone_raw":
      return lead.phone_raw;
    case "address":
      return lead.address;
    case "latitude":
      return lead.latitude;
    case "longitude":
      return lead.longitude;
    case "rating":
      return lead.rating;
    case "reference_url":
      return lead.reference_url;
    case "town":
      return lead.town;
    case "zone":
      return lead.zone;
    case "collected_at":
      return lead.collected_at;
    default:
      return null;
  }
}

export function fetchCollectionLeads(
  area: string,
  category: string,
): LeadRow[] {
  return db
    .prepare(
      `
      SELECT
        business_name,
        phone_normalized,
        phone_raw,
        address,
        latitude,
        longitude,
        sources,
        rating,
        reference_url,
        town,
        zone,
        collected_at
      FROM leads
      WHERE town = ? AND category = ?
      ORDER BY id
      `,
    )
    .all(area, category) as LeadRow[];
}

export function exportCollectionToCsv(
  territory: string,
  area: string,
  category: string,
): string {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const leads = fetchCollectionLeads(area, category);

  const seen = new Set<string>();
  const uniqueLeads: LeadRow[] = [];
  for (const lead of leads) {
    const identityKey =
      (lead.reference_url ?? "") +
      "|" +
      (lead.phone_normalized ?? "") +
      "|" +
      (lead.business_name ?? "");
    if (seen.has(identityKey)) {
      continue;
    }
    seen.add(identityKey);
    uniqueLeads.push(lead);
  }

  const filename = generateExportFilename(
    territory,
    area,
    category,
    formatTimestamp(new Date()),
  );
  const filePath = path.join(OUTPUT_DIR, filename);

  const header = COLUMNS.map((column) =>
    csvEscape(column.header),
  ).join(",");

  const lines: string[] = [header];
  for (const lead of uniqueLeads) {
    const values = COLUMNS.map((column) => {
      if (column.field === "sources") {
        return csvEscape(formatSources(lead.sources));
      }
      return csvEscape(getField(lead, column.field));
    });
    lines.push(values.join(","));
  }

  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");

  logger.info(`CSV exported:`);
  logger.info(`${OUTPUT_DIR}/${filename}`);

  return filePath;
}
