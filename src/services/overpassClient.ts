import axios from "axios";

const OVERPASS_SERVERS = [
  "https://overpass.private.coffee/api/interpreter",

  "https://overpass.kumi.systems/api/interpreter",

  "https://overpass-api.de/api/interpreter",
];

let preferredServer = 0;

export async function runOverpassQuery(query: string) {
  let lastError: any;

  for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
    const attempt = (preferredServer + i) % OVERPASS_SERVERS.length;

    const url = OVERPASS_SERVERS[attempt];

    try {
      console.log(`Overpass attempt ${attempt + 1}: ${url}`);

      const response = await axios.get(url, {
        params: {
          data: query,
        },

        timeout: 60000,

        headers: {
          "User-Agent": "VehicleLeadFinder/1.0",
        },
      });

      preferredServer = attempt;

      return response.data;
    } catch (error: any) {
      lastError = error;

      console.log(`Overpass failed, retrying...`);

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  throw lastError;
}

export interface OverpassResponse {
  elements: any[];
}
