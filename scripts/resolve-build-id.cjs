// Identificador corto de build compartido por vite (define) y stamp-sw.
// Prioriza el commit de Vercel; si no, git; si no, timestamp.
const { execSync } = require("child_process");

function resolveBuildId() {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel && String(fromVercel).trim()) {
    return String(fromVercel).trim().slice(0, 7);
  }
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return Date.now().toString(36);
  }
}

module.exports = { resolveBuildId };
