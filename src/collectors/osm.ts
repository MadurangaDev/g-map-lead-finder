import { Zone } from "../models/Zone";
import { Lead } from "../models/Lead";
import { runOverpassQuery } from "../services/overpassClient";
import { ResolvedQuery } from "../services/queryBuilder";
import { logger } from "../utils/logger";

export async function collectOSM(
  zone: Zone,
  category: string,
  query: ResolvedQuery
): Promise<Lead[]> {
  const overpassQuery = buildOverpassQuery(zone, query);

  let data;

  try {
    data = await runOverpassQuery(overpassQuery);
  } catch (error: any) {
    logger.error(`OSM collection FAILED for zone: ${zone.name}`);
    logger.error(`Reason: ${error.message}`);
    throw error;
  }

  const elements = data.elements;

  logger.success(`OSM elements found: ${elements.length}`);

  return elements.map((item: any) => ({
    business_name: item.tags?.name ?? "Unknown",
    phone_raw: item.tags?.phone ?? null,
    address: item.tags?.["addr:street"] ?? null,
    latitude: item.lat ?? item.center?.lat ?? null,
    longitude: item.lon ?? item.center?.lon ?? null,
    category,
    town: zone.town,
    zone: zone.name,
    sources: ["OpenStreetMap"],
    reference_url: `https://www.openstreetmap.org/${item.type}/${item.id}`,
    rating: null,
    notes: null,
  }));
}

function buildOverpassQuery(zone: Zone, query: ResolvedQuery): string {
  const radius = zone.radius;
  const lat = zone.latitude;
  const lon = zone.longitude;

  if (query.type === "tags") {
    if (query.tags.length === 1) {
      const tag = query.tags[0];
      return `[out:json][timeout:25];

node
  ["${tag.key}"="${tag.value}"]
  (around:${radius},${lat},${lon});

out center;`;
    }

    const nodeClauses = query.tags
      .map(
        (tag) =>
          `node["${tag.key}"="${tag.value}"](around:${radius},${lat},${lon});`
      )
      .join("\n  ");

    return `[out:json][timeout:25];

(
  ${nodeClauses}
);

out center;`;
  }

  if (query.type === "name") {
    const regex = query.pattern ? `["name"~"${query.pattern}"]` : "";

    return `[out:json][timeout:25];

node
  ${regex}
  (around:${radius},${lat},${lon});

out center;`;
  }

  return `[out:json][timeout:25];

node
  (around:${radius},${lat},${lon});

out center;`;
}
