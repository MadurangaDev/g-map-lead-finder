import { mergeLead } from "../../services/leadMerge";


export function runMergeTest(){

    const lead1 = {

        business_name:
            "ABC Motors",

        phone_raw:
            "077 1234567",

        address:
            "Kandy",

        category:
            "Vehicle Repair",

        town:
            "Kandy",

        zone:
            "Kandy Center"

    };


    const lead2 = {

        business_name:
            "ABC Motors Updated",

        phone_raw:
            "+94 77 1234567",

        address:
            "Kandy Main Street",

        category:
            "Vehicle Repair",

        town:
            "Kandy",

        zone:
            "Kandy Center"

    };


    mergeLead(lead1);
    mergeLead(lead2);


    console.log(
        "Merge test completed"
    );

}