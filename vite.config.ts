import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import { handleApi } from "./src/server/api.ts";

const apiMiddleware: Connect.NextHandleFunction = (req, res, next) => {
  if (!req.url?.startsWith("/api/")) {
    next();
    return;
  }
  void handleApi(req, res);
};

/** 开发和生产预览都把接口挂在 Vite 上，少起一个进程 */
function gitApi(): Plugin {
  return {
    name: "gitcontribution-api",
    configureServer(server) {
      server.middlewares.use(apiMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), gitApi()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
