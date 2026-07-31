import { collectOSM } from "../collectors/osm";
import { mergeLead } from "../services/leadMerge";
import { generateZones } from "../services/zones";
import { Zone } from "../models/Zone";
import { loadJson } from "../config/loader";
import chalk from "chalk";

interface Category {
  category: string;
  keywords: string[];
}

interface Town {
  name: string;
  latitude: number;
  longitude: number;
}

const DELAY_BETWEEN_ZONES_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCollection() {
  console.log(chalk.blue("Starting collection..."));

  const categories = loadJson<Category[]>("config/categories.json");
  const towns = loadJson<Town[]>("config/towns.json");

  console.log(`Categories: ${categories.length}`);
  console.log(`Towns: ${towns.length}`);

  const successfulZones: string[] = [];
  const failedZones: string[] = [];

  for (const town of towns) {
    console.log(`\nTown: ${town.name}`);

    const zones: Zone[] = generateZones(town);

    console.log(`Generated ${zones.length} zones`);

    for (const zone of zones) {
      console.log(`\n   • ${zone.name}`);

      try {
        const leads = await collectOSM(zone, "car");

        console.log(`Found ${leads.length} leads`);

        for (const lead of leads) {
          mergeLead(lead);
        }

        console.log(`Merged ${leads.length} lead(s) from ${zone.name}.`);

        successfulZones.push(zone.name);
      } catch (error: any) {
        console.error(chalk.red(`FAILED`));

        console.error(
          `Could not collect OSM data for zone: ${zone.name}`,
        );

        console.error(`Reason: ${error.message}`);

        console.error(
          `No database changes were made for ${zone.name}.`,
        );

        failedZones.push(zone.name);
      }

      await delay(DELAY_BETWEEN_ZONES_MS);
    }
  }

  const totalZones = successfulZones.length + failedZones.length;

  console.log("\n========================================");
  console.log("\nCollection finished\n");
  console.log(`Total zones      : ${totalZones}`);
  console.log(`Successful zones : ${successfulZones.length}`);
  console.log(`Failed zones     : ${failedZones.length}\n`);

  if (failedZones.length > 0) {
    console.log("Failed zones:\n");

    for (const name of failedZones) {
      console.log(`- ${name}`);
    }

    console.log("\nDatabase may be incomplete.");
  } else {
    console.log("All zones collected successfully.");
  }

  console.log("\n========================================");
}
