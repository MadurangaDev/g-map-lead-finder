export function normalizePhone(
    phone?: string | null
): string | null {


    if (!phone) {
        return null;
    }


    let value =
        phone.replace(/\D/g, "");


    if (value.startsWith("0094")) {

        value =
            value.substring(4);

    }


    if (value.startsWith("94")) {

        return value;

    }


    if (value.startsWith("0")) {

        value =
            value.substring(1);

    }


    return "94" + value;

}