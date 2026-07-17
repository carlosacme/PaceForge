// Sella dist/sw.js con un CACHE_NAME unico por build para forzar la purga
// de caches viejas en cada deploy. Corre en postbuild (tras `vite build`).
// Idempotente: reemplaza el placeholder __BUILD_ID__ o cualquier id previo.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const swPath = path.resolve(__dirname, "..", "dist", "sw.js");
if (!fs.existsSync(swPath)) {
  console.warn("[stamp-sw] dist/sw.js no existe (¿corriste vite build?). Skip.");
  process.exit(0);
}

// En Vercel git puede no estar disponible: priorizar la env del commit.
const buildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return Date.now().toString(36);
    }
  })();

let src = fs.readFileSync(swPath, "utf8");
const before = src;
src = src.replace(
  /const CACHE_NAME = "runningapexflow-[^"]*";/,
  `const CACHE_NAME = "runningapexflow-${buildId}";`,
);
if (src === before) {
  console.warn("[stamp-sw] No se encontro CACHE_NAME para sellar.");
  process.exit(0);
}
fs.writeFileSync(swPath, src, "utf8");
console.log(`[stamp-sw] CACHE_NAME = runningapexflow-${buildId}`);
