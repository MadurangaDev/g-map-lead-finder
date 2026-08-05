import { collectOSM } from "../collectors/osm";
import {
  collectGoogleMaps,
  closeGoogleMapsBrowser,
} from "../collectors/googleMaps";
import { mergeLead } from "../services/leadMerge";
import { generateLocationZones } from "../services/zones";
import { Zone } from "../models/Zone";
import { Lead } from "../models/Lead";
import { loadJson } from "../config/loader";
import { resolveQuery, ResolvedQuery } from "../services/queryBuilder";
import { logger } from "../utils/logger";
import { ProgressDashboard, formatDuration } from "../utils/progressDashboard";
import { printEndpointStats } from "../services/overpassClient";
import {
  CollectionCheckpoint,
  createCheckpoint,
  markCollectorComplete,
  markCsvExported,
  isCheckpointComplete,
  getIncompleteCollectors,
  findCheckpoint,
  deleteCheckpoint,
} from "../services/checkpoint";
import { exportCollectionToCsv } from "../services/csvExporter";

export interface Category {
  category: string;
  keywords: string[];
}

export interface Territory {
  name: string;
  areas: string[];
}

export interface AreaCoordinate {
  latitude: number;
  longitude: number;
}

interface CollectorConfig {
  collectors: Record<string, boolean>;
}

export type CollectorFn = (
  zone: Zone,
  category: string,
  query: ResolvedQuery,
) => Promise<Lead[]>;

const collectorRegistry: Record<string, CollectorFn> = {
  osm: (zone, category, query) => collectOSM(zone, category, query),
  googleMaps: (zone, category, _query) => collectGoogleMaps(zone, category),
};

interface Task {
  zone: Zone;
  category: string;
  query: ResolvedQuery;
  collectorName: string;
}

interface JobSpec {
  territory: string;
  area: string;
  category: string;
  keywords: string[];
}

interface JobPlan {
  job: JobSpec;
  jobMode: "fresh" | "restart" | "resume";
  checkpoint: CollectionCheckpoint;
  collectorsToRun: string[];
  tasks: Task[];
}

export interface CollectionScope {
  territory?: string;
  area?: string;
  category?: string;
}

export interface RunCollectionOptions {
  scope?: CollectionScope;
  resumeMode?: "resume" | "restart" | "fresh";
  fullRestart?: boolean;
}

const DELAY_BETWEEN_TASKS_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getEnabledCollectors(): string[] {
  try {
    const config = loadJson<CollectorConfig>("config/collectors.json");
    const enabled = Object.entries(config.collectors)
      .filter(([_, enabled]) => enabled)
      .map(([name, _]) => name);

    if (enabled.length === 0) {
      logger.warn(
        "No collectors enabled in config/collectors.json. Falling back to OSM.",
      );
      return ["osm"];
    }

    return enabled;
  } catch {
    const envCollector = (process.env.COLLECTOR || "osm") as string;
    const normalized =
      envCollector === "google-maps" ? "googleMaps" : envCollector;
    return [normalized];
  }
}

interface RunStats {
  processed: number;
  saved: number;
  skipped: number;
  errors: number;
}

let interruptRequested = false;
let interruptHandlerInstalled = false;

function installInterruptHandler(): void {
  if (interruptHandlerInstalled) return;
  interruptHandlerInstalled = true;

  const handleInterrupt = () => {
    if (interruptRequested) {
      process.exit(130);
    }
    interruptRequested = true;
    logger.warn(
      "Interrupt received. Finishing current task and saving progress...",
    );
    closeGoogleMapsBrowser();
  };

  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);
}

function buildJobs(
  territories: Territory[],
  categories: Category[],
  coordinates: Record<string, AreaCoordinate>,
  scope?: CollectionScope,
): JobSpec[] {
  const jobs: JobSpec[] = [];

  for (const territory of territories) {
    if (scope?.territory && territory.name !== scope.territory) {
      continue;
    }

    for (const area of territory.areas) {
      if (scope?.area && area !== scope.area) {
        continue;
      }

      if (!coordinates[area]) {
        continue;
      }

      for (const category of categories) {
        if (scope?.category && category.category !== scope.category) {
          continue;
        }

        jobs.push({
          territory: territory.name,
          area,
          category: category.category,
          keywords: category.keywords,
        });
      }
    }
  }

  return jobs;
}

function resolveJobMode(
  job: JobSpec,
  existing: CollectionCheckpoint | null,
  options: RunCollectionOptions,
  isSingleScope: boolean,
): "fresh" | "restart" | "resume" | "skip" {
  if (options.fullRestart) {
    return "restart";
  }

  if (isSingleScope) {
    return (options.resumeMode ?? "fresh") as "fresh" | "restart" | "resume";
  }

  if (existing && isCheckpointComplete(existing)) {
    return "skip";
  }

  return existing ? "resume" : "fresh";
}

function resolvePlan(
  job: JobSpec,
  existing: CollectionCheckpoint | null,
  enabledCollectors: string[],
  jobMode: "fresh" | "restart" | "resume",
  coordinates: Record<string, AreaCoordinate>,
): JobPlan {
  let checkpoint: CollectionCheckpoint;
  let collectorsToRun: string[];

  if (jobMode === "restart") {
    deleteCheckpoint(job.territory, job.area, job.category);
    logger.info("Previous checkpoint removed");
    logger.info("Starting fresh...");
    checkpoint = createCheckpoint(
      job.territory,
      job.area,
      job.category,
      enabledCollectors,
    );
    collectorsToRun = enabledCollectors;
  } else if (jobMode === "resume" && existing) {
    logger.info("Checkpoint found");
    logger.info("Resuming...");
    checkpoint = existing;
    const incomplete = getIncompleteCollectors(existing);
    collectorsToRun = incomplete;
  } else {
    checkpoint = createCheckpoint(
      job.territory,
      job.area,
      job.category,
      enabledCollectors,
    );
    collectorsToRun = enabledCollectors;
  }

  const coords = coordinates[job.area];
  const zones = generateLocationZones({
    name: job.area,
    latitude: coords.latitude,
    longitude: coords.longitude,
  });

  const query = resolveQuery(job.category, job.keywords);

  const tasks: Task[] = [];
  for (const zone of zones) {
    for (const collectorName of collectorsToRun) {
      tasks.push({ zone, category: job.category, query, collectorName });
    }
  }

  return { job, jobMode, checkpoint, collectorsToRun, tasks };
}

function taskLabel(task: Task): string {
  return `${task.zone.name} [${task.category}] - ${task.collectorName}`;
}

async function runTask(task: Task): Promise<{ saved: number }> {
  const collect = collectorRegistry[task.collectorName];
  if (!collect) {
    throw new Error(`Unknown collector: ${task.collectorName}`);
  }

  const leads = await collect(task.zone, task.category, task.query);

  for (const lead of leads) {
    mergeLead(lead);
  }

  logger.success(`Merged ${leads.length} lead(s) from ${taskLabel(task)}.`);
  return { saved: leads.length };
}

async function executeTask(
  task: Task,
  dashboard: ProgressDashboard,
  stats: RunStats,
  failedTasks: Task[],
): Promise<void> {
  const label = taskLabel(task);
  dashboard.update({ currentTask: label });
  logger.info(`\n   • ${label}`);

  try {
    const result = await runTask(task);
    stats.processed++;
    stats.saved += result.saved;
    dashboard.update({ processed: stats.processed, saved: stats.saved });
  } catch (error: any) {
    logger.error("FAILED");
    logger.error(`Collector failed: ${task.collectorName}`);
    logger.error(`Could not collect data for ${label}`);
    logger.error(`Reason: ${error.message}`);
    logger.error(`No database changes were made for ${label}.`);
    failedTasks.push(task);
    stats.processed++;
    stats.errors++;
    dashboard.update({ processed: stats.processed, errors: stats.errors });
  }

  dashboard.render();
}

async function runJob(
  plan: JobPlan,
  dashboard: ProgressDashboard,
  stats: RunStats,
  failedTaskLabels: string[],
): Promise<void> {
  const job = plan.job;

  logger.info(`Selected Territory: ${job.territory}`);
  logger.info(`Selected Area: ${job.area}`);
  logger.info(`Selected Category: ${job.category}`);

  const tasks = plan.tasks;
  const failedTasks: Task[] = [];

  let activeCollector: string | null = null;

  if (tasks.length === 0) {
    logger.info(
      "All collectors already completed for this selection. Proceeding to export...",
    );
  } else {
    for (const task of tasks) {
      if (interruptRequested) {
        break;
      }

      if (task.collectorName !== activeCollector) {
        logger.info(`Collector: ${task.collectorName}`);
        activeCollector = task.collectorName;
      }

      await executeTask(task, dashboard, stats, failedTasks);
      await delay(DELAY_BETWEEN_TASKS_MS);
    }

    if (failedTasks.length > 0 && !interruptRequested) {
      logger.info("\n----------------------------------------");
      logger.info(`Retrying failed tasks (${failedTasks.length})...`);

      const stillFailed: Task[] = [];
      for (const task of failedTasks) {
        if (interruptRequested) {
          break;
        }
        await executeTask(task, dashboard, stats, stillFailed);
        await delay(DELAY_BETWEEN_TASKS_MS);
      }

      failedTasks.length = 0;
      failedTasks.push(...stillFailed);
    }

    for (const collector of plan.collectorsToRun) {
      const collectorTasks = tasks.filter(
        (t) => t.collectorName === collector,
      );
      const allSucceeded = collectorTasks.every(
        (t) =>
          !failedTasks.some(
            (f) =>
              f.zone.name === t.zone.name &&
              f.category === t.category &&
              f.collectorName === t.collectorName,
          ),
      );
      if (allSucceeded) {
        if (!plan.checkpoint.completedCollectors.includes(collector)) {
          markCollectorComplete(plan.checkpoint, collector);
          logger.success(`Collector "${collector}" marked complete.`);
        }
      }
    }

    for (const task of failedTasks) {
      failedTaskLabels.push(taskLabel(task));
    }
  }

  const allCollectorsComplete =
    plan.checkpoint.collectors.length > 0 &&
    plan.checkpoint.completedCollectors.length ===
      plan.checkpoint.collectors.length;

  if (allCollectorsComplete && !interruptRequested) {
    exportCollectionToCsv(job.territory, job.area, job.category);
    if (!plan.checkpoint.csvExported) {
      markCsvExported(plan.checkpoint);
    }
  }
}

export async function runCollection(
  options: RunCollectionOptions = {},
): Promise<void> {
  interruptRequested = false;

  const categories = loadJson<Category[]>("config/categories.json");
  const territories = loadJson<Territory[]>("config/territories.json");
  const coordinates =
    loadJson<Record<string, AreaCoordinate>>("data/areaCoordinates.json");

  const enabledCollectors = getEnabledCollectors();

  logger.info(`Collectors: ${enabledCollectors.join(", ")}`);

  const unknownCollectors = enabledCollectors.filter(
    (name) => !collectorRegistry[name],
  );
  if (unknownCollectors.length > 0) {
    logger.error(
      `Unknown collector(s): ${unknownCollectors.join(", ")}. Aborting.`,
    );
    return;
  }

  logger.info(`Categories: ${categories.length}`);
  logger.info(`Territories: ${territories.length}`);
  logger.info(`Areas: ${territories.flatMap((t) => t.areas).length}`);

  const scope = options.scope;
  const isSingleScope = !!(scope && scope.territory && scope.area && scope.category);

  const jobs = buildJobs(territories, categories, coordinates, scope);

  if (jobs.length === 0) {
    logger.warn("No collection jobs match the current selection.");
    return;
  }

  const plans: JobPlan[] = [];

  for (const job of jobs) {
    const existing = findCheckpoint(
      job.territory,
      job.area,
      job.category,
    );
    const jobMode = resolveJobMode(
      job,
      existing,
      options,
      isSingleScope,
    );

    if (jobMode === "skip") {
      continue;
    }

    plans.push(
      resolvePlan(job, existing, enabledCollectors, jobMode, coordinates),
    );
  }

  if (plans.length === 0) {
    logger.info("All selected collections are already complete.");
    return;
  }

  const totalTasks = plans.reduce((sum, plan) => sum + plan.tasks.length, 0);

  const startTime = Date.now();
  const dashboard = new ProgressDashboard({
    total: totalTasks,
    processed: 0,
    saved: 0,
    skipped: 0,
    errors: 0,
    startTime,
    currentTask: "",
  });

  const stats: RunStats = {
    processed: 0,
    saved: 0,
    skipped: 0,
    errors: 0,
  };

  const failedTaskLabels: string[] = [];

  installInterruptHandler();
  logger.setDashboard(dashboard);
  dashboard.render();

  try {
    for (const plan of plans) {
      if (interruptRequested) {
        break;
      }
      await runJob(plan, dashboard, stats, failedTaskLabels);
    }
  } finally {
    dashboard.erase();
    logger.setDashboard(null);

    if (enabledCollectors.includes("googleMaps")) {
      await closeGoogleMapsBrowser();
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;

  process.stdout.write("\n========================================\n");
  process.stdout.write("\nCollection finished\n");
  process.stdout.write(`Total tasks      : ${totalTasks}\n`);
  process.stdout.write(`Successful tasks : ${stats.processed - stats.errors}\n`);
  process.stdout.write(`Failed tasks     : ${stats.errors}\n`);
  process.stdout.write(`Saved leads      : ${stats.saved}\n`);
  process.stdout.write(`Skipped          : ${stats.skipped}\n`);
  process.stdout.write(`Errors           : ${stats.errors}\n`);
  process.stdout.write(`Duration         : ${formatDuration(elapsed)}\n`);
  process.stdout.write("\n========================================\n");

  if (enabledCollectors.includes("osm")) {
    printEndpointStats();
  }

  if (failedTaskLabels.length > 0) {
    logger.info("Failed tasks:\n");
    for (const name of failedTaskLabels) {
      logger.info(`- ${name}`);
    }
    logger.warn("\nDatabase may be incomplete.");
  } else if (isSingleScope) {
    logger.success("Selected collection completed successfully.\n");
  } else {
    logger.success("All collections completed successfully.\n");
  }

  if (interruptRequested) {
    logger.warn(
      "\nCollection interrupted. Progress has been saved. Resume next time.",
    );
  }
}
