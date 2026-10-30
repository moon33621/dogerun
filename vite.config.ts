import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import netlify from "@netlify/vite-plugin-tanstack-start";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    tanstackStart({
      router: {
        target: "react",
        autoCodeSplitting: false,
        codeSplittingOptions: {
          addHmr: false,
        },
      },
    }),
    viteReact(),
    tailwindcss(),
    appEnvPlugin(),
    grokPwaPlugin(),
    netlify(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8080,
    hmr: {
      overlay: false, // hide overlay while we stabilize
    },
  },
});
