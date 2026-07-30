import { runOverpassQuery } from "../services/overpassClient";

async function test() {

    const query = `
    [out:json][timeout:25];

    node
    ["shop"="car_repair"]
    (around:3000,7.2906,80.6337);

    out;
    `;

    const result = await runOverpassQuery(query);

    console.log(
        "Elements:",
        result.elements.length
    );
}

test();