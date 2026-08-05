import inquirer from "inquirer";
import { loadJson } from "../config/loader";
import {
  findCheckpoint,
  isCheckpointComplete,
  getIncompleteCollectors,
} from "../services/checkpoint";
import { getEnabledCollectors } from "../services/collectorRunner";

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

export interface Selection {
  territory: string;
  area: string;
  category: string;
}

export interface ResolvedSelection extends Selection {
  resumeMode: "resume" | "restart" | "fresh";
}

const COLLECTOR_DISPLAY_NAMES: Record<string, string> = {
  osm: "OpenStreetMap",
  googleMaps: "Google Maps",
};

export function formatCollectorName(id: string): string {
  return COLLECTOR_DISPLAY_NAMES[id] ?? id;
}

export function formatCollectorList(ids: string[]): string[] {
  return ids.map(formatCollectorName);
}

export async function selectTerritory(
  territories: Territory[],
): Promise<string | null> {
  const choices = territories.map((territory) => ({
    name: territory.name,
    value: territory.name,
  }));

  const { territory } = await inquirer.prompt([
    {
      type: "list",
      name: "territory",
      message: "Select Territory",
      choices,
      loop: false,
    },
  ]);

  return territory as string;
}

export async function selectArea(
  areas: string[],
  territoryName: string,
  coordinates: Record<string, AreaCoordinate>,
): Promise<string | null> {
  const availableAreas = areas.filter((area) => !!coordinates[area]);

  if (availableAreas.length === 0) {
    return null;
  }

  const { area } = await inquirer.prompt([
    {
      type: "list",
      name: "area",
      message: "Select Area",
      choices: availableAreas.map((area) => ({ name: area, value: area })),
      loop: false,
    },
  ]);

  return area as string;
}

export async function selectCategory(categories: Category[]): Promise<string> {
  const { category } = await inquirer.prompt([
    {
      type: "list",
      name: "category",
      message: "Select Category",
      choices: categories.map((cat) => ({
        name: cat.category,
        value: cat.category,
      })),
      loop: false,
    },
  ]);

  return category as string;
}

export async function confirmSelection(selection: Selection): Promise<boolean> {
  const { confirmed } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message: "Collect this selection?",
      default: true,
    },
  ]);

  return Boolean(confirmed);
}

function printSeparator(): void {
  process.stdout.write("\n");
}

async function promptResumeOrRestart(): Promise<"resume" | "restart"> {
  const { decision } = await inquirer.prompt([
    {
      type: "list",
      name: "decision",
      message: "Existing progress detected.",
      choices: [
        { name: "Resume", value: "resume" },
        { name: "Restart", value: "restart" },
      ],
      loop: false,
    },
  ]);

  return decision as "resume" | "restart";
}

async function promptRestartOrCancel(): Promise<"restart" | "cancel"> {
  const { decision } = await inquirer.prompt([
    {
      type: "list",
      name: "decision",
      message: "Collection already completed.",
      choices: [
        { name: "Restart", value: "restart" },
        { name: "Cancel", value: "cancel" },
      ],
      loop: false,
    },
  ]);

  return decision as "restart" | "cancel";
}

export async function resolveResumeState(
  selection: Selection,
): Promise<{ resumeMode: "resume" | "restart" | "fresh" } | null> {
  const existing = findCheckpoint(
    selection.territory,
    selection.area,
    selection.category,
  );

  if (!existing) {
    return { resumeMode: "fresh" };
  }

  if (isCheckpointComplete(existing)) {
    const decision = await promptRestartOrCancel();
    return decision === "cancel" ? null : { resumeMode: "restart" };
  }

  const decision = await promptResumeOrRestart();
  return { resumeMode: decision };
}

export async function runInteractiveSelection(
  territories: Territory[],
  categories: Category[],
): Promise<ResolvedSelection | null> {
  let coordinates: Record<string, AreaCoordinate> = {};
  try {
    coordinates = loadJson<Record<string, AreaCoordinate>>(
      "data/areaCoordinates.json",
    );
  } catch {
    // coordinates missing — area list will include all areas,
    // runner will warn and skip areas without coordinates
  }

  let territoryName: string | null = null;
  while (!territoryName) {
    territoryName = await selectTerritory(territories);
  }
  printSeparator();

  const territory = territories.find((t) => t.name === territoryName);
  if (!territory) {
    return null;
  }

  let areaName: string | null = null;
  while (!areaName) {
    areaName = await selectArea(territory.areas, territory.name, coordinates);
    if (!areaName) {
      return null;
    }
  }
  printSeparator();

  let categoryName: string | null = null;
  while (!categoryName) {
    categoryName = await selectCategory(categories);
  }
  printSeparator();

  const selection: Selection = {
    territory: territoryName,
    area: areaName,
    category: categoryName,
  };

  const resumeState = await resolveResumeState(selection);
  if (!resumeState) {
    return null;
  }

  const confirmed = await confirmSelection(selection);
  if (!confirmed) {
    return null;
  }

  const enabledCollectors = getEnabledCollectors();

  console.log("\nCollection Summary\n");
  console.log(`Territory : ${territoryName}`);
  console.log(`Area      : ${areaName}`);
  console.log(`Category  : ${categoryName}`);
  console.log("");
  console.log("Collectors to run");
  for (const name of formatCollectorList(enabledCollectors)) {
    console.log(` • ${name}`);
  }
  console.log("");

  return {
    ...selection,
    resumeMode: resumeState.resumeMode,
  };
}