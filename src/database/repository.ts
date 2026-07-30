import { Lead } from "../models/Lead";
import db from "./db";

interface LeadRow extends Lead {
  id: number;
  sources: string[];
}

export function findLeadByPhone(phone: string): LeadRow | undefined {
  const row = db
    .prepare(
      `
            SELECT *
            FROM leads
            WHERE phone_normalized = ?
            `,
    )
    .get(phone) as any;

  if (!row) {
    return undefined;
  }

  return {
    ...row,
    sources: row.sources ? JSON.parse(row.sources) : [],
  } as LeadRow;
}

export function insertLead(lead: Lead) {
  const dbLead = {
    ...lead,
    sources: JSON.stringify(lead.sources ?? []),
  };
  const result = db
    .prepare(
      `
            INSERT INTO leads
            (
                business_name,
                phone_normalized,
                phone_raw,
                address,
                category,
                town,
                zone,
                latitude,
                longitude,
                rating,
                reference_url,
                sources,
                notes
            )
            VALUES
            (
                @business_name,
                @phone_normalized,
                @phone_raw,
                @address,
                @category,
                @town,
                @zone,
                @latitude,
                @longitude,
                @rating,
                @reference_url,
                @sources,
                @notes
            )
            `,
    )
    .run(dbLead);

  return result.lastInsertRowid;
}

export function updateLead(id: number, lead: Lead) {
  db.prepare(
    `
        UPDATE leads SET

        business_name = COALESCE(?, business_name),
        address = COALESCE(?, address),
        category = COALESCE(?, category),
        town = COALESCE(?, town),
        zone = COALESCE(?, zone),
        latitude = COALESCE(?, latitude),
        longitude = COALESCE(?, longitude),
        rating = COALESCE(?, rating),
        reference_url = COALESCE(?, reference_url)
        sources = COALESCE(?, sources),

        WHERE id = ?

        `,
  ).run(
    lead.business_name,
    lead.address,
    lead.category,
    lead.town,
    lead.zone,
    lead.latitude,
    lead.longitude,
    lead.rating,
    lead.reference_url,
    JSON.stringify(lead.sources ?? []),
    id,
  );
}
