#!/usr/bin/env node

import chalk from "chalk";
import { loadJson } from "../config/loader";
import { initializeDatabase } from "../database/db";
import { normalizePhone } from "../services/phone";
import { mergeLead } from "../services/leadMerge";
import { runZoneTest } from "./commands/testZones";
import { runOSMTest } from "./commands/testOSM";

console.log(chalk.green("Vehicle Lead Finder"));

async function main() {
  try {
    const categories = loadJson<any[]>("config/categories.json");

    const towns = loadJson<any[]>("config/towns.json");

    console.log("");

    console.log(`Categories loaded: ${categories.length}`);

    console.log(`Towns loaded: ${towns.length}`);

    console.log("");

    console.log(chalk.green("Configuration ready"));

    initializeDatabase();

    console.log(chalk.green("Database ready"));
    await runOSMTest();
  } catch (error) {
    console.error(chalk.red(String(error)));

    process.exit(1);
  }
}
main();
