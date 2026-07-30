import db from "./db";


export function listLeads(){

    const leads =
        db.prepare(
            `
            SELECT *
            FROM leads
            `
        )
        .all();


    console.table(leads);

}