import fs from "fs";


export function loadJson<T>(filePath: string): T {

    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Config file missing: ${filePath}`
        );
    }


    const content =
        fs.readFileSync(
            filePath,
            "utf8"
        );


    try {

        return JSON.parse(content);

    } catch {

        throw new Error(
            `Invalid JSON: ${filePath}`
        );

    }
}