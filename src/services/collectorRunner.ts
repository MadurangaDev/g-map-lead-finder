import { collectOSM } from "../collectors/osm";
import { mergeLead } from "../services/leadMerge";
import { generateZones } from "../services/zones";
import { Zone } from "../models/Zone";
import { loadJson } from "../config/loader";
import { resolveQuery, ResolvedQuery } from "../services/queryBuilder";
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

interface Task {
  zone: Zone;
  category: string;
  query: ResolvedQuery;
}

const DELAY_BETWEEN_TASKS_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runCollection() {
  console.log(chalk.blue("Starting collection..."));

  const categories = loadJson<Category[]>("config/categories.json");
  const towns = loadJson<Town[]>("config/towns.json");

  console.log(`Categories: ${categories.length}`);
  console.log(`Towns: ${towns.length}`);

  const successfulTasks: string[] = [];
  const failedTasks: string[] = [];
  const failedTaskObjects: Task[] = [];

  for (const town of towns) {
    console.log(`\nTown: ${town.name}`);

    const zones = generateZones(town);

    console.log(`Generated ${zones.length} zones`);

    for (const zone of zones) {
      for (const cat of categories) {
        const query = resolveQuery(cat.category, cat.keywords);

        console.dir(query, { depth: null });

        const taskLabel = `${zone.name} [${cat.category}]`;

        console.log(`\n   • ${taskLabel}`);

        try {
          const leads = await collectOSM(zone, cat.category, query);

          console.log(`Found ${leads.length} leads`);

          for (const lead of leads) {
            mergeLead(lead);
          }

          console.log(`Merged ${leads.length} lead(s) from ${taskLabel}.`);

          successfulTasks.push(taskLabel);
        } catch (error: any) {
          console.error(chalk.red("FAILED"));

          console.error(`Could not collect OSM data for ${taskLabel}`);

          console.error(`Reason: ${error.message}`);

          console.error(`No database changes were made for ${taskLabel}.`);

          failedTasks.push(taskLabel);
          failedTaskObjects.push({
            zone,
            category: cat.category,
            query,
          });
        }

        await delay(DELAY_BETWEEN_TASKS_MS);
      }
    }
  }

  if (failedTasks.length > 0) {
    console.log("\n----------------------------------------");
    console.log(`\nRetrying failed tasks (${failedTasks.length})...\n`);

    const remainingFailedTasks: string[] = [];

    for (let i = 0; i < failedTaskObjects.length; i++) {
      const task = failedTaskObjects[i];
      const taskLabel = `${task.zone.name} [${task.category}]`;

      console.log(`\n   • ${taskLabel}`);

      try {
        const leads = await collectOSM(task.zone, task.category, task.query);

        console.log(`Found ${leads.length} leads`);

        for (const lead of leads) {
          mergeLead(lead);
        }

        console.log(`Merged ${leads.length} lead(s) from ${taskLabel}.`);

        successfulTasks.push(taskLabel);
      } catch (error: any) {
        console.error(chalk.red("FAILED"));

        console.error(`Could not collect OSM data for ${taskLabel}`);

        console.error(`Reason: ${error.message}`);

        console.error(`No database changes were made for ${taskLabel}.`);

        remainingFailedTasks.push(taskLabel);
      }

      await delay(DELAY_BETWEEN_TASKS_MS);
    }

    failedTasks.length = 0;

    for (const name of remainingFailedTasks) {
      failedTasks.push(name);
    }
  }

  const totalTasks = successfulTasks.length + failedTasks.length;

  console.log("\n========================================");
  console.log("\nCollection finished\n");
  console.log(`Total tasks      : ${totalTasks}`);
  console.log(`Successful tasks : ${successfulTasks.length}`);
  console.log(`Failed tasks     : ${failedTasks.length}\n`);

  if (failedTasks.length > 0) {
    console.log("Failed tasks:\n");

    for (const name of failedTasks) {
      console.log(`- ${name}`);
    }

    console.log("\nDatabase may be incomplete.");
  } else {
    console.log("All tasks collected successfully.");
  }

  console.log("\n========================================");
}
