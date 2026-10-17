import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tsconfigPaths(), tailwindcss()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "tray-panel": path.resolve(__dirname, "tray-panel.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("zrender")) return "vendor-zrender";
          if (id.includes("echarts")) return "vendor-echarts";
          if (
            id.includes("react-dom") ||
            id.includes("react-router") ||
            id.includes("@remix-run") ||
            /[\\/]node_modules[\\/](react|scheduler)[\\/]/.test(id)
          )
            return "vendor-react";
          if (id.includes("@dnd-kit")) return "vendor-dnd";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (
            id.includes("i18next") ||
            id.includes("react-i18next")
          )
            return "vendor-i18n";
          if (
            id.includes("lucide") ||
            id.includes("morphicons") ||
            id.includes("@radix-ui") ||
            id.includes("react-beautiful-color") ||
            id.includes("qrcode")
          )
            return "vendor-ui";
          return "vendor";
        },
      },
    },
  },
  base: "./",
}));
