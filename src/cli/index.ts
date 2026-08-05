#!/usr/bin/env node

import { loadJson } from "../config/loader";
import { initializeDatabase } from "../database/db";
import {
  runCollection,
  Category,
  Territory,
} from "../services/collectorRunner";
import { runInteractiveSelection } from "./prompts";
import { logger } from "../utils/logger";

const args = process.argv.slice(2);
const runAll = args.includes("--all");
const fullRestart = runAll && args.includes("--restart");

logger.info("Vehicle Lead Finder");

async function main() {
  try {
    initializeDatabase();

    logger.info("Database ready");

    if (runAll) {
      logger.info("Run All mode: collecting every territory, area and category.");
      await runCollection({ fullRestart });
      return;
    }

    const categories = loadJson<Category[]>("config/categories.json");
    const territories = loadJson<Territory[]>("config/territories.json");

    const selection = await runInteractiveSelection(territories, categories);

    if (!selection) {
      logger.info("No collection started.");
      return;
    }

    await runCollection({
      scope: {
        territory: selection.territory,
        area: selection.area,
        category: selection.category,
      },
      resumeMode: selection.resumeMode,
    });
  } catch (error: any) {
    if (error?.name === "ExitError" || error?.code === "ERR_UIE_EXIT") {
      throw error;
    }
    logger.error(String(error?.message ?? error));

    process.exit(1);
  }
}

main();
