import { generateLocationZones, SEARCH_RADIUS_METERS } from "../../services/zones";
import { insertZone } from "../../database/zoneRepository";

export function runZoneTest() {
  const zones = generateLocationZones({
    name: "Kandy",
    latitude: 7.2906,
    longitude: 80.6337,
  });

  zones.forEach((zone) => {
    insertZone({ ...zone, radius: SEARCH_RADIUS_METERS });
  });

  console.table(zones);

  console.log("Zones saved");
}
