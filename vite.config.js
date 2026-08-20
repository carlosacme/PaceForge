import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { resolveBuildId } = require("./scripts/resolve-build-id.cjs");

const rafBuildId = resolveBuildId();

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Mismo id que stamp-sw escribe en dist/build-id.txt / CACHE_NAME.
    __RAF_BUILD_ID__: JSON.stringify(rafBuildId),
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
