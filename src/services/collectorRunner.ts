import { collectOSM } from "../collectors/osm";
import { mergeLead } from "../services/leadMerge";
import { generateZones } from "../services/zones";

export async function runOSMTest() {
  const zones = generateZones({
    name: "Kandy",

    latitude: 7.2906,

    longitude: 80.6337,
  });

  const testZone = {
    ...zones[0],
    radius: 3000,
  };

  const leads = await collectOSM(testZone, "car");

  for (const lead of leads) {
    mergeLead(lead);
  }

  console.log("OSM leads merged into database");
}
