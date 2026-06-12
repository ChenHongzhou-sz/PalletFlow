import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");

  return {
    base: env.VITE_APP_BASE_PATH || "/",
    plugins: [react()],
    resolve: {
      alias: {
        "@": srcRoot,
      },
    },
    server: {
      host: "0.0.0.0",
      port: 4173,
    },
  };
});
