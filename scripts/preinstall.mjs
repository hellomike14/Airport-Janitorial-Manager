import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

for (const filename of ["package-lock.json", "yarn.lock"]) {
  rmSync(fileURLToPath(new URL(`../${filename}`, import.meta.url)), { force: true });
}

const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
