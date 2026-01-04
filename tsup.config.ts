import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/envguard.ts"],
  format: ["cjs"],
  dts: false,
  clean: true,
  target: "node18",
});
