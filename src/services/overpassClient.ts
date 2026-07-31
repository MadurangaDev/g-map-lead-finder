import axios from "axios";

export const OVERPASS_TIMEOUT_MS = 60000;

export const OVERPASS_RETRY_ROUNDS = 2;

const OVERPASS_SERVERS = [
  "https://overpass.private.coffee/api/interpreter",

  "https://overpass.kumi.systems/api/interpreter",

  "https://overpass-api.de/api/interpreter",
];

export async function runOverpassQuery(query: string) {
  const totalAttempts = OVERPASS_SERVERS.length * OVERPASS_RETRY_ROUNDS;

  let lastError: any;

  for (let round = 0; round < OVERPASS_RETRY_ROUNDS; round++) {
    for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
      const attemptNumber = round * OVERPASS_SERVERS.length + i + 1;

      const url = OVERPASS_SERVERS[i];

      try {
        console.log(`Attempt ${attemptNumber}/${totalAttempts}`);

        console.log(`Endpoint: ${url}`);

        const response = await axios.get(url, {
          params: {
            data: query,
          },

          timeout: OVERPASS_TIMEOUT_MS,

          headers: {
            "User-Agent": "VehicleLeadFinder/1.0",
          },
        });

        return response.data;
      } catch (error: any) {
        lastError = error;

        const reason =
          error.code === "ECONNABORTED"
            ? "timeout"
            : error.response?.status
              ? `HTTP ${error.response.status}`
              : error.message;

        console.log(`Reason: ${reason}`);

        if (attemptNumber < totalAttempts) {
          console.log("Retrying...");
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