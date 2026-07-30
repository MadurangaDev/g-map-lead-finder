import Database from "better-sqlite3";
import { schema } from "./schema";

const db = new Database("data/leads.sqlite");

export function initializeDatabase() {
  Object.values(schema).forEach((statement) => {
    db.exec(statement);
  });
}

export default db;
