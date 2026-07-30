import db from "./db";
import { Zone } from "../models/Zone";


export function insertZone(
    zone: Zone
){

    return db.prepare(
        `
        INSERT INTO zones
        (
            town,
            name,
            latitude,
            longitude,
            radius,
            completed
        )
        VALUES
        (
            @town,
            @name,
            @latitude,
            @longitude,
            @radius,
            0
        )
        `
    )
    .run(zone);

}



export function getZonesByTown(
    town:string
){

    return db.prepare(
        `
        SELECT *
        FROM zones
        WHERE town = ?
        `
    )
    .all(town);

}



export function markZoneCompleted(
    id:number
){

    return db.prepare(
        `
        UPDATE zones
        SET completed = 1
        WHERE id = ?
        `
    )
    .run(id);

}