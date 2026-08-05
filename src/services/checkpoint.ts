import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

export type ResumeDecision = "resume" | "restart" | "cancel";

export interface CollectionCheckpoint {
  territory: string;
  area: string;
  category: string;
  collectors: string[];
  completedCollectors: string[];
  startedAt: string;
  completedAt: string | null;
  csvExported: boolean;
}

export const CHECKPOINT_DIR = "checkpoints";

function sanitizeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function checkpointFilePath(
  territory: string,
  area: string,
  category: string,
): string {
  const name = `${sanitizeSegment(territory)}-${sanitizeSegment(area)}-${sanitizeSegment(category)}`;
  return path.join(CHECKPOINT_DIR, `${name}.json`);
}

export function ensureCheckpointDir(): void {
  if (!fs.existsSync(CHECKPOINT_DIR)) {
    fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
  }
}

function writeCheckpoint(checkpoint: CollectionCheckpoint): void {
  ensureCheckpointDir();
  const file = checkpointFilePath(
    checkpoint.territory,
    checkpoint.area,
    checkpoint.category,
  );
  fs.writeFileSync(file, JSON.stringify(checkpoint, null, 2), "utf8");
}

function readCheckpoint(file: string): CollectionCheckpoint | null {
  try {
    const checkpoint = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as CollectionCheckpoint;

    if (!Array.isArray(checkpoint.completedCollectors)) {
      checkpoint.completedCollectors = [];
    }
    if (!Array.isArray(checkpoint.collectors)) {
      checkpoint.collectors = [];
    }

    return checkpoint;
  } catch {
    logger.warn(`Checkpoint file corrupt, ignoring: ${file}`);
    return null;
  }
}

const LEGACY_TERRITORY_ALIASES: Record<string, string> = {
  "Territorry 01": "Territory 01",
  "Territorry 02": "Territory 02",
  "Territorry 03": "Territory 03",
  "Territorry 04": "Territory 04",
  "Territorry 05": "Territory 05",
};

function normalizeTerritory(territory: string): string {
  return LEGACY_TERRITORY_ALIASES[territory] ?? territory;
}

export function findCheckpoint(
  territory: string,
  area: string,
  category: string,
): CollectionCheckpoint | null {
  const directPath = checkpointFilePath(territory, area, category);
  if (fs.existsSync(directPath)) {
    return readCheckpoint(directPath);
  }

  if (!fs.existsSync(CHECKPOINT_DIR)) {
    return null;
  }

  for (const entry of fs.readdirSync(CHECKPOINT_DIR)) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const fullPath = path.join(CHECKPOINT_DIR, entry);
    const checkpoint = readCheckpoint(fullPath);
    if (!checkpoint) {
      continue;
    }

    if (
      normalizeTerritory(checkpoint.territory) === normalizeTerritory(territory) &&
      checkpoint.area === area &&
      checkpoint.category === category
    ) {
      return checkpoint;
    }
  }

  return null;
}

export function createCheckpoint(
  territory: string,
  area: string,
  category: string,
  collectors: string[],
): CollectionCheckpoint {
  const now = new Date().toISOString();
  const checkpoint: CollectionCheckpoint = {
    territory,
    area,
    category,
    collectors,
    completedCollectors: [],
    startedAt: now,
    completedAt: null,
    csvExported: false,
  };
  writeCheckpoint(checkpoint);
  return checkpoint;
}

export function markCollectorComplete(
  checkpoint: CollectionCheckpoint,
  collector: string,
): void {
  if (!checkpoint.completedCollectors.includes(collector)) {
    checkpoint.completedCollectors.push(collector);
  }
  syncCompletedAt(checkpoint);
  writeCheckpoint(checkpoint);
}

export function markCsvExported(checkpoint: CollectionCheckpoint): void {
  checkpoint.csvExported = true;
  syncCompletedAt(checkpoint);
  writeCheckpoint(checkpoint);
}

function syncCompletedAt(checkpoint: CollectionCheckpoint): void {
  const allCollectorsDone =
    checkpoint.collectors.length > 0 &&
    checkpoint.completedCollectors.length === checkpoint.collectors.length;
  checkpoint.completedAt = allCollectorsDone ? new Date().toISOString() : null;
}

export function isCheckpointComplete(checkpoint: CollectionCheckpoint): boolean {
  return (
    checkpoint.collectors.length > 0 &&
    checkpoint.completedCollectors.length === checkpoint.collectors.length &&
    checkpoint.csvExported
  );
}

export function getIncompleteCollectors(
  checkpoint: CollectionCheckpoint,
): string[] {
  return checkpoint.collectors.filter(
    (collector) => !checkpoint.completedCollectors.includes(collector),
  );
}

export function deleteCheckpoint(
  territory: string,
  area: string,
  category: string,
): void {
  const file = checkpointFilePath(territory, area, category);
  if (!fs.existsSync(file)) {
    return;
  }

  const stats = fs.statSync(file);
  if (!stats.isFile()) {
    return;
  }

  const content = readCheckpoint(file);
  if (!content) {
    logger.warn(`Checkpoint file ${file} is unreadable. Refusing to delete.`);
    return;
  }

  if (
    content.territory !== territory ||
    content.area !== area ||
    content.category !== category
  ) {
    logger.warn(
      `Checkpoint file ${file} contains data for a different collection ` +
        `(${content.territory} / ${content.area} / ${content.category}). ` +
        `Refusing to delete.`,
    );
    return;
  }

  logger.info(`Removing checkpoint: ${territory} / ${area} / ${category}`);
  fs.unlinkSync(file);
}
