import dotenv from "dotenv";
dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

import { Pool } from "pg";

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
