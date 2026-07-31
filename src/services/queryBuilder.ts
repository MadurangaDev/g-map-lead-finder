import fs from "fs";
import { loadJson } from "../config/loader";

export interface OsmTag {
  key: string;
  value: string;
}

export type ResolvedQuery =
  | {
      type: "tags";
      tags: OsmTag[];
    }
  | {
      type: "name";
      pattern: string;
    };

interface TagMapEntry {
  mode: "tags" | "name";
  tags?: OsmTag[];
}

const TAG_MAP_PATH = "config/osmTagMap.json";

let cachedTagMap: Record<string, TagMapEntry> | null = null;

function loadTagMap(): Record<string, TagMapEntry> {
  if (!cachedTagMap) {
    if (!fs.existsSync(TAG_MAP_PATH)) {
      cachedTagMap = {};
      return cachedTagMap;
    }
    cachedTagMap = loadJson<Record<string, TagMapEntry>>(TAG_MAP_PATH);
  }
  return cachedTagMap;
}

export function resolveQuery(category: string, keywords: string[]): ResolvedQuery {
  const tagMap = loadTagMap();
  const entry = tagMap[category];

  if (entry) {
    if (entry.mode === "tags") {
      if (!entry.tags || entry.tags.length === 0) {
        throw new Error(
          `Category "${category}" is configured as mode="tags" but has no tags.`
        );
      }

      return { type: "tags", tags: entry.tags };
    }

    if (entry.mode === "name") {
      const pattern = buildNamePattern(keywords);
      return { type: "name", pattern };
    }
  }

  console.warn(
    `No OSM tag mapping found for category "${category}". Falling back to name search.`
  );

  const pattern = buildNamePattern(keywords);
  return { type: "name", pattern };
}

function buildNamePattern(keywords: string[]): string {
  if (keywords.length === 0) {
    throw new Error("Category must define at least one keyword.");
  }

  const escaped = keywords.map(escapeRegex);
  return escaped.join("|");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
