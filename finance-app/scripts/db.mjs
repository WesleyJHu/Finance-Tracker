// import dotenv from "dotenv";
// dotenv.config({ path: ".env.local" });
import { Pool } from "pg"

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
})