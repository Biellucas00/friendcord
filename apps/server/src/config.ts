import "dotenv/config";
import { z } from "zod";
export const config = z.object({
  DATABASE_URL: z.string().url(), JWT_SECRET: z.string().min(32), PORT: z.coerce.number().default(3001), CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  OPENAI_API_KEY: z.string().optional(), OPENAI_MODEL: z.string().default("gpt-5-mini"), GEMINI_API_KEY: z.string().optional(), GEMINI_MODEL: z.string().default("gemini-2.5-flash")
}).parse(process.env);
