const fs = require("fs");
const path = require("path");

const ua = process.env.npm_config_user_agent || "";
if (!ua.startsWith("pnpm/")) {
  console.error("Use pnpm instead of npm/yarn for this workspace.");
  process.exit(1);
}

for (const lockFile of ["package-lock.json", "yarn.lock"]) {
  const target = path.resolve(process.cwd(), lockFile);
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
}
