import axios from "axios";
import fs from "fs";
import { loadJson } from "../../config/loader";

interface Territory {
  name: string;
  areas: string[];
}

interface AreaCoordinate {
  latitude: number;
  longitude: number;
}

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search";
const DELAY_BETWEEN_REQUESTS_MS = 1000;
const USER_AGENT =
  "g-map-lead-finder/1.0 (https://github.com/MadurangaDev/g-map-lead-finder)";
const COORDINATES_PATH = "data/areaCoordinates.json";
const TERRITORIES_PATH = "config/territories.json";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lookupCoordinates(area: string): Promise<AreaCoordinate | null> {
  const query = `${area}, Sri Lanka`;

  const response = await axios.get(NOMINATIM_BASE_URL, {
    params: {
      q: query,
      format: "json",
      limit: 1,
    },
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  const results = response.data;

  if (!results || results.length === 0) {
    return null;
  }

  return {
    latitude: parseFloat(results[0].lat),
    longitude: parseFloat(results[0].lon),
  };
}

function loadExistingCoordinates(): Record<string, AreaCoordinate> {
  if (!fs.existsSync(COORDINATES_PATH)) {
    return {};
  }

  return loadJson<Record<string, AreaCoordinate>>(COORDINATES_PATH);
}

function flattenAreas(territories: Territory[]): string[] {
  const areas: string[] = [];

  for (const territory of territories) {
    for (const area of territory.areas) {
      areas.push(area);
    }
  }

  return areas;
}

function sortCoordinates(
  coordinates: Record<string, AreaCoordinate>
): Record<string, AreaCoordinate> {
  const sortedEntries = Object.entries(coordinates).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const sorted: Record<string, AreaCoordinate> = {};

  for (const [key, value] of sortedEntries) {
    sorted[key] = value;
  }

  return sorted;
}

async function main() {
  console.log("Generating area coordinates...\n");

  const territories = loadJson<Territory[]>(TERRITORIES_PATH);

  const allAreaNames = flattenAreas(territories);

  const existingCoordinates = loadExistingCoordinates();

  const missingAreas = allAreaNames.filter(
    (area) => !existingCoordinates[area]
  );

  console.log(`Total areas: ${allAreaNames.length}`);
  console.log(`Existing coordinates: ${Object.keys(existingCoordinates).length}`);
  console.log(`Missing coordinates: ${missingAreas.length}\n`);

  const failedLookups: string[] = [];
  const newCoordinates: Record<string, AreaCoordinate> = {};

  for (const area of missingAreas) {
    process.stdout.write(`Looking up "${area}, Sri Lanka"... `);

    try {
      const coords = await lookupCoordinates(area);

      if (coords) {
        newCoordinates[area] = coords;
        console.log(`OK (${coords.latitude}, ${coords.longitude})`);
      } else {
        failedLookups.push(area);
        console.log("FAILED (no results)");
      }
    } catch (error: any) {
      failedLookups.push(area);
      console.log(`ERROR (${error.message})`);
    }

    await delay(DELAY_BETWEEN_REQUESTS_MS);
  }

  const allCoordinates = { ...existingCoordinates, ...newCoordinates };

  const sortedCoordinates = sortCoordinates(allCoordinates);

  const dir = "data";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(
    COORDINATES_PATH,
    JSON.stringify(sortedCoordinates, null, 2) + "\n",
    "utf8"
  );

  console.log(`\nCoordinates written to ${COORDINATES_PATH}`);

  const totalWritten = Object.keys(sortedCoordinates).length;
  const totalNew = Object.keys(newCoordinates).length;
  console.log(`Total entries: ${totalWritten} (+${totalNew} new)`);

  if (failedLookups.length > 0) {
    console.log("\nFailed lookups:");
    for (const area of failedLookups) {
      console.log(`  - ${area}`);
    }
  } else {
    console.log("\nAll lookups succeeded.");
  }
}

main();
