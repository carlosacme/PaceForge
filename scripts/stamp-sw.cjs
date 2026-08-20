// Sella dist/sw.js con un CACHE_NAME unico por build para forzar la purga
// de caches viejas en cada deploy. Corre en postbuild (tras `vite build`).
// Idempotente: reemplaza el placeholder __BUILD_ID__ o cualquier id previo.
// Tambien escribe dist/build-id.txt para que la APK compare version al resume.
const fs = require("fs");
const path = require("path");
const { resolveBuildId } = require("./resolve-build-id.cjs");

const distDir = path.resolve(__dirname, "..", "dist");
const swPath = path.join(distDir, "sw.js");
const buildIdPath = path.join(distDir, "build-id.txt");

const buildId = resolveBuildId();

if (!fs.existsSync(swPath)) {
  console.warn("[stamp-sw] dist/sw.js no existe (¿corriste vite build?). Skip.");
  process.exit(0);
}

let src = fs.readFileSync(swPath, "utf8");
const before = src;
src = src.replace(
  /const CACHE_NAME = "runningapexflow-[^"]*";/,
  `const CACHE_NAME = "runningapexflow-${buildId}";`,
);
if (src === before) {
  console.warn("[stamp-sw] No se encontro CACHE_NAME para sellar.");
} else {
  fs.writeFileSync(swPath, src, "utf8");
  console.log(`[stamp-sw] CACHE_NAME = runningapexflow-${buildId}`);
}

fs.writeFileSync(buildIdPath, `${buildId}\n`, "utf8");
console.log(`[stamp-sw] build-id.txt = ${buildId}`);
