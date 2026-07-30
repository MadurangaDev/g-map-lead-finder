#!/usr/bin/env node

import chalk from "chalk";
import { loadJson } from "../config/loader";
import { initializeDatabase } from "../database/db";
import { runCollection } from "../services/collectorRunner";

console.log(chalk.green("Vehicle Lead Finder"));

async function main() {
  try {

    initializeDatabase();

    console.log(chalk.green("Database ready"));

    await runCollection();
  } catch (error) {
    console.error(chalk.red(String(error)));

    process.exit(1);
  }
}
main();
