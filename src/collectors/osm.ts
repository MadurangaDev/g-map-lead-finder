import { Zone } from "../models/Zone";
import { Lead } from "../models/Lead";
import { OverpassResponse, runOverpassQuery } from "../services/overpassClient";

const OVERPASS_URL = "https://overpass.private.coffee/api/interpreter";

export async function collectOSM(zone: Zone, keyword: string): Promise<Lead[]> {
  const query = `[out:json][timeout:25];

node
["shop"="car_repair"]
(around:${zone.radius},${zone.latitude},${zone.longitude});

out center;`;

  // TODO:
  // OSM queries should be driven by category-specific OSM tags.
  // The 'keyword' parameter is reserved for future implementation.

  let data: OverpassResponse;

  try {
    data = await runOverpassQuery(query);
  } catch (error: any) {
    console.error(
      "OSM request failed:",
      error.response?.status ?? error.message,
    );

    return [];
  }

  const elements = data.elements;
  console.log("OSM elements found:", elements.length);

  return elements.map((item: any) => ({
    business_name: item.tags?.name ?? "Unknown",

    phone_raw: item.tags?.phone ?? null,

    address: item.tags?.["addr:street"] ?? null,

    latitude: item.lat ?? item.center?.lat ?? null,

    longitude: item.lon ?? item.center?.lon ?? null,

    category: keyword,

    town: zone.town,

    zone: zone.name,
    sources: ["OpenStreetMap"],

    reference_url: `https://www.openstreetmap.org/${item.type}/${item.id}`,
    rating: null,
    notes: null,
  }));
}
