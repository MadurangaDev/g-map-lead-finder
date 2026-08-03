#!/usr/bin/env node

import { loadJson } from "../config/loader";
import { initializeDatabase } from "../database/db";
import { runCollection } from "../services/collectorRunner";
import { logger } from "../utils/logger";

logger.info("Vehicle Lead Finder");

async function main() {
  try {
    initializeDatabase();

    logger.info("Database ready");

    await runCollection();
  } catch (error) {
    logger.error(String(error));

    process.exit(1);
  }
}
main();
