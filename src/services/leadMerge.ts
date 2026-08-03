import { Lead } from "../models/Lead";
import { normalizePhone } from "./phone";

import {
    findLeadByPhone,
    findLeadByNameAndTown,
    findLeadByReferenceUrl,
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

       Highest-priority match: a stable reference_url
       (e.g. an OpenStreetMap element URL). Rediscovery of the
       same element from overlapping area searches must merge
       into the existing row rather than insert a duplicate.

    */

    if(incoming.reference_url){

        const existing =
            findLeadByReferenceUrl(incoming.reference_url);

        if(existing){

            updateLead(
                existing.id,
                incoming
            );

            return existing.id;

        }

    }


    /*

       No stable reference_url (or no existing match):
       fall back to phone-based matching.

    */

    if(!phone){

        const existing = findLeadByNameAndTown(
            incoming.business_name ?? "",
            incoming.town ?? ""
        );

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
