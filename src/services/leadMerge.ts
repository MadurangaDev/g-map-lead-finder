import { Lead } from "../models/Lead";
import { normalizePhone } from "./phone";

import {
    findLeadByPhone,
    insertLead,
    updateLead
}
from "../database/repository";



export function mergeLead(
    incoming: Lead
){

    const phone =
        normalizePhone(
            incoming.phone_raw
            ??
            incoming.phone_normalized
        );


    incoming.phone_normalized =
        phone;


    /*
       No phone means:
       keep as separate record
    */

    if(!phone){

        return insertLead(
            incoming
        );

    }


    const existing =
        findLeadByPhone(phone);



    if(existing){

        updateLead(
            existing.id,
            incoming
        );


        return existing.id;

    }


    return insertLead(
        incoming
    );

}