import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Add the binding to wrangler.jsonc and run the D1 migrations before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}
