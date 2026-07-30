#!/usr/bin/env node

import chalk from "chalk";
import { loadJson } from "../config/loader";
import { initializeDatabase } from "../database/db";

console.log(chalk.green("Vehicle Lead Finder"));

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
} catch (error) {
  console.error(chalk.red(String(error)));

  process.exit(1);
}
