import { generateZones } from "../../services/zones";
import { insertZone } from "../../database/zoneRepository";


export function runZoneTest(){

    const town = {

        name: "Kandy",

        latitude: 7.2906,

        longitude: 80.6337

    };


    const zones =
        generateZones(town);


    zones.forEach(zone => {

        insertZone(zone);

    });


    console.table(zones);

    console.log(
        "Zones saved"
    );

}