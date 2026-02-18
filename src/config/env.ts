import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PILOT_EXPOSE_VERIFY_CODE: booleanFromEnv.optional(),
  VERIFY_CODE_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(30),
  VERIFY_CODE_MAX_PER_HOUR: z.coerce.number().int().positive().default(10),
  SIGNUP_RATE_LIMIT_MAX_PER_HOUR: z.coerce.number().int().positive().default(20)
});

export const env = envSchema.parse(process.env);
