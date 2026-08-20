import "dotenv/config";
import { z } from "zod";
export const config = z.object({
  DATABASE_URL: z.string().url(), JWT_SECRET: z.string().min(32), PORT: z.coerce.number().default(3001), CLIENT_ORIGIN: z.string().default("http://localhost:5173")
}).parse(process.env);
