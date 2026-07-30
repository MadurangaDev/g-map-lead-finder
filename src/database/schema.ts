export const schema = {
  leads: `
        CREATE TABLE IF NOT EXISTS leads (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            business_name TEXT NOT NULL,

            phone_normalized TEXT UNIQUE,

            phone_raw TEXT,

            address TEXT,

            category TEXT,

            town TEXT,

            zone TEXT,

            latitude REAL,

            longitude REAL,

            rating REAL,

            reference_url TEXT,

            collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            notes TEXT

        );
    `,

  lead_sources: `
        CREATE TABLE IF NOT EXISTS lead_sources (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            lead_id INTEGER NOT NULL,

            source TEXT NOT NULL,

            source_url TEXT,

            FOREIGN KEY(lead_id)
            REFERENCES leads(id)

        );
    `,

  zones: `
        CREATE TABLE IF NOT EXISTS zones (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            town TEXT NOT NULL,

            name TEXT NOT NULL,

            latitude REAL,

            longitude REAL,

            radius INTEGER,

            completed BOOLEAN DEFAULT 0

        );
    `,

  collection_runs: `
        CREATE TABLE IF NOT EXISTS collection_runs (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            completed_at DATETIME,

            status TEXT,

            notes TEXT

        );
    `,
};
