import { defineConfig } from "vite";

/**
 * The peer site, built on its OWN. Two origins means two deployments, so this
 * must not be nested inside the deli's `dist/`: `npm run build:peer` writes
 * `peer-dist/` at the repository root and nothing else touches it.
 *
 * The two agent artifacts and the `_headers` file are served verbatim out of
 * `peer/public`, so what a judge fetches over HTTP is byte-identical to what
 * the tests read off disk.
 */
export default defineConfig({
  root: "peer",
  base: "./",
  publicDir: "public",
  build: { outDir: "../peer-dist", emptyOutDir: true },
});
