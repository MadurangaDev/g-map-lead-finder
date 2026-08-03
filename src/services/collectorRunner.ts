import { collectOSM } from "../collectors/osm";
import { mergeLead } from "../services/leadMerge";
import { generateLocationZones } from "../services/zones";
import { Zone } from "../models/Zone";
import { loadJson } from "../config/loader";
import { resolveQuery, ResolvedQuery } from "../services/queryBuilder";
import { logger } from "../utils/logger";
import { ProgressDashboard, formatDuration } from "../utils/progressDashboard";
import { printEndpointStats } from "../services/overpassClient";

interface Category {
  category: string;
  keywords: string[];
}

interface Territory {
  name: string;
  areas: string[];
}

interface AreaCoordinate {
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

function countTotalTasks(
  territories: Territory[],
  coordinates: Record<string, AreaCoordinate>,
  categories: Category[]
): number {
  let total = 0;
  for (const territory of territories) {
    for (const areaName of territory.areas) {
      const coords = coordinates[areaName];
      if (!coords) continue;
      const zones = generateLocationZones({
        name: areaName,
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      total += zones.length * categories.length;
    }
  }
  return total;
}

export async function runCollection() {
  logger.info("Starting collection...");

  const categories = loadJson<Category[]>("config/categories.json");
  const territories = loadJson<Territory[]>("config/territories.json");
  const coordinates =
    loadJson<Record<string, AreaCoordinate>>("data/areaCoordinates.json");

  logger.info(`Categories: ${categories.length}`);
  logger.info(`Territories: ${territories.length}`);
  logger.info(
    `Areas: ${territories.flatMap((t) => t.areas).length}`
  );

  const startTime = Date.now();

  const totalTasks = countTotalTasks(territories, coordinates, categories);
  const dashboard = new ProgressDashboard({
    total: totalTasks,
    processed: 0,
    saved: 0,
    skipped: 0,
    errors: 0,
    startTime,
    currentTask: "",
  });

  logger.setDashboard(dashboard);
  dashboard.render();

  const successfulTasks: string[] = [];
  const failedTasks: string[] = [];
  const failedTaskObjects: Task[] = [];

  let processed = 0;
  let saved = 0;
  let skipped = 0;
  let errors = 0;

  try {
    for (const territory of territories) {
      logger.info(`Territory: ${territory.name}`);

      for (const areaName of territory.areas) {
        const coords = coordinates[areaName];

        if (!coords) {
          logger.warn(`Coordinates not found for area: ${areaName}`);
          logger.warn(
            `Skipping ${areaName}. Run 'npm run generate-coordinates' to generate coordinates.`
          );
          skipped++;
          dashboard.update({ skipped });
          dashboard.render();
          continue;
        }

        const zones = generateLocationZones({
          name: areaName,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });

        logger.info(`  Area: ${areaName} (${zones.length} zone(s))`);

        for (const zone of zones) {
          for (const cat of categories) {
            const query = resolveQuery(cat.category, cat.keywords);

            const taskLabel = `${zone.name} [${cat.category}]`;

            dashboard.update({ currentTask: taskLabel });
            logger.info(`\n   • ${taskLabel}`);

            try {
              const leads = await collectOSM(zone, cat.category, query);

              for (const lead of leads) {
                mergeLead(lead);
              }

              logger.success(`Merged ${leads.length} lead(s) from ${taskLabel}.`);

              successfulTasks.push(taskLabel);
              processed++;
              saved += leads.length;
              dashboard.update({ processed, saved });
              dashboard.render();
            } catch (error: any) {
              logger.error("FAILED");

              logger.error(`Could not collect OSM data for ${taskLabel}`);

              logger.error(`Reason: ${error.message}`);

              logger.error(`No database changes were made for ${taskLabel}.`);

              failedTasks.push(taskLabel);
              failedTaskObjects.push({
                zone,
                category: cat.category,
                query,
              });
              processed++;
              errors++;
              dashboard.update({ processed, errors });
              dashboard.render();
            }

            await delay(DELAY_BETWEEN_TASKS_MS);
          }
        }
      }
    }

    if (failedTasks.length > 0) {
      logger.info("\n----------------------------------------");
      logger.info(`Retrying failed tasks (${failedTasks.length})...`);

      const remainingFailedTasks: string[] = [];

      for (let i = 0; i < failedTaskObjects.length; i++) {
        const task = failedTaskObjects[i];
        const taskLabel = `${task.zone.name} [${task.category}]`;

        dashboard.update({ currentTask: taskLabel });
        logger.info(`\n   • ${taskLabel}`);

        try {
          const leads = await collectOSM(task.zone, task.category, task.query);

          for (const lead of leads) {
            mergeLead(lead);
          }

          logger.success(`Merged ${leads.length} lead(s) from ${taskLabel}.`);

          successfulTasks.push(taskLabel);
          processed++;
          saved += leads.length;
          dashboard.update({ processed, saved });
          dashboard.render();
        } catch (error: any) {
          logger.error("FAILED");

          logger.error(`Could not collect OSM data for ${taskLabel}`);

          logger.error(`Reason: ${error.message}`);

          logger.error(`No database changes were made for ${taskLabel}.`);

          remainingFailedTasks.push(taskLabel);
          processed++;
          errors++;
          dashboard.update({ processed, errors });
          dashboard.render();
        }

        await delay(DELAY_BETWEEN_TASKS_MS);
      }

      failedTasks.length = 0;

      for (const name of remainingFailedTasks) {
        failedTasks.push(name);
      }
    }
  } finally {
    dashboard.erase();
    logger.setDashboard(null);
  }

  const elapsed = (Date.now() - startTime) / 1000;

  process.stdout.write("\n========================================\n");
  process.stdout.write("\nCollection finished\n");
  process.stdout.write(`Total tasks      : ${totalTasks}\n`);
  process.stdout.write(`Successful tasks : ${processed - errors}\n`);
  process.stdout.write(`Failed tasks     : ${errors}\n`);
  process.stdout.write(`Saved leads      : ${saved}\n`);
  process.stdout.write(`Skipped          : ${skipped}\n`);
  process.stdout.write(`Errors           : ${errors}\n`);
  process.stdout.write(`Duration         : ${formatDuration(elapsed)}\n`);
  process.stdout.write("\n========================================\n");

  printEndpointStats();

  if (failedTasks.length > 0) {
    logger.info("Failed tasks:\n");

    for (const name of failedTasks) {
      logger.info(`- ${name}`);
    }

    logger.warn("\nDatabase may be incomplete.");
  } else {
    logger.info("All tasks collected successfully.");
  }
}
