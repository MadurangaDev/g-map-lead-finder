import axios from "axios";
import { logger } from "../utils/logger";

export const OVERPASS_TIMEOUT_MS = 60000;
export const OVERPASS_RETRY_ROUNDS = 2;

const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

interface EndpointStats {
  url: string;
  requests: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  disabledUntil: number | null;
}

const endpointStats = new Map<string, EndpointStats>();

function getOrCreateStats(url: string): EndpointStats {
  let stats = endpointStats.get(url);
  if (!stats) {
    stats = {
      url,
      requests: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      lastFailureTime: null,
      disabledUntil: null,
    };
    endpointStats.set(url, stats);
  }
  return stats;
}

function getShortName(url: string): string {
  if (url.includes("overpass-api.de")) return "api.de";
  if (url.includes("overpass.kumi.systems")) return "kumi";
  if (url.includes("overpass.private.coffee")) return "private.coffee";
  return url;
}

function isAvailable(stats: EndpointStats): boolean {
  return stats.disabledUntil === null || Date.now() >= stats.disabledUntil;
}

export function getEndpointStats(): EndpointStats[] {
  return OVERPASS_SERVERS.map((url) => getOrCreateStats(url));
}

export function printEndpointStats() {
  const stats = getEndpointStats();

  process.stdout.write("\n==================================================\n\n");
  process.stdout.write("Overpass Endpoint Statistics\n\n");

  for (const s of stats) {
    const shortName = getShortName(s.url);
    const successRate =
      s.requests > 0 ? ((s.successes / s.requests) * 100).toFixed(0) : "0";

    process.stdout.write(`${shortName}\n`);
    process.stdout.write(`Requests : ${s.requests}\n`);
    process.stdout.write(`Success : ${s.successes}\n`);
    process.stdout.write(`Failures : ${s.failures}\n`);
    process.stdout.write(`Success Rate : ${successRate}%\n\n`);
  }

  process.stdout.write("==================================================\n");
}

export async function runOverpassQuery(query: string) {
  const totalAttempts = OVERPASS_SERVERS.length * OVERPASS_RETRY_ROUNDS;

  let lastError: any;
  let attemptNumber = 0;

  for (let round = 0; round < OVERPASS_RETRY_ROUNDS; round++) {
    const availableEndpoints = OVERPASS_SERVERS.filter((url) => {
      const stats = getOrCreateStats(url);
      return isAvailable(stats);
    });

    if (availableEndpoints.length === 0) {
      const minDisabledUntil = Math.min(
        ...OVERPASS_SERVERS.map((url) => getOrCreateStats(url).disabledUntil ?? Infinity)
      );

      if (minDisabledUntil === Infinity) break;

      const waitMs = Math.max(0, minDisabledUntil - Date.now());
      logger.info(
        `All endpoints disabled. Waiting ${Math.round(waitMs / 1000)}s for cooldown...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    for (const url of availableEndpoints) {
      attemptNumber++;
      const stats = getOrCreateStats(url);
      stats.requests++;

      if (stats.disabledUntil !== null && Date.now() >= stats.disabledUntil) {
        logger.info(`Endpoint back online:\n${url}`);
        stats.disabledUntil = null;
      }

      try {
        logger.info(`Attempt ${attemptNumber}/${totalAttempts}`);
        logger.info(`Endpoint: ${url}`);

        const response = await axios.get(url, {
          params: { data: query },
          timeout: OVERPASS_TIMEOUT_MS,
          headers: { "User-Agent": "VehicleLeadFinder/1.0" },
        });

        stats.successes++;
        stats.consecutiveFailures = 0;
        stats.disabledUntil = null;

        return response.data;
      } catch (error: any) {
        stats.failures++;
        stats.consecutiveFailures++;
        stats.lastFailureTime = Date.now();

        if (stats.consecutiveFailures >= 3) {
          stats.disabledUntil = Date.now() + 10 * 60 * 1000;
          logger.warn(
            `Endpoint disabled for 10 minutes:\n${url}\nReason: 3 consecutive failures`
          );
        }

        lastError = error;

        const reason =
          error.code === "ECONNABORTED"
            ? "timeout"
            : error.response?.status
              ? `HTTP ${error.response.status}`
              : error.message;

        logger.error(`Reason: ${reason}`);

        if (attemptNumber < totalAttempts) {
          logger.info("Retrying...");
        }

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  throw new Error(
    `All overpass endpoints failed after ${totalAttempts} attempts.`,
  );
}

export interface OverpassResponse {
  elements: any[];
}
