import pg from "pg";
import { config } from "./config.js";
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
export const query = <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) => pool.query<T>(text, values);
