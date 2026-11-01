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
        // 每个第三方包只落在唯一一个 chunk 里，且 chunk 之间**没有回边**。
        //
        // 此前用 `id.includes("react-dom")` 做匹配，它同时命中了 `@radix-ui/react-dom`
        // 等包，于是 Radix 的模块被塞进 `vendor-react`，而它们又 import 其它 Radix
        // 包 —— Rollup 直接报告 circular chunk：
        //   vendor-react -> vendor-ui -> vendor-react
        //   vendor -> vendor-react -> vendor
        // 出现回边时 Rollup 会重排模块的顶层声明，React 的工厂变量 `ot` 在其
        // 自身模块求值前就被写入，浏览器里抛
        //   TypeError: undefined is not an object (evaluating 'ot.Activity=S')
        // 前端在 main.tsx 之前就崩了，Splash 永远停在「正在启动…」。Linux 与 Windows
        // 的产物哈希不同（本仓库的 vendor-react 在两端分别是 DII7mJny / Cw5N63L7），
        // 是否触发取决于模块顺序，所以只有 Linux 发行版稳定复现。
        //
        // 现在按「包根目录」精确匹配，保证依赖方向单一：
        //   vendor-ui / vendor-dnd → vendor-react → vendor
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("zrender")) return "vendor-zrender";
          if (id.includes("echarts")) return "vendor-echarts";
          // React 运行时成组：react / react-dom / scheduler 互相引用，不能拆开。
          // 用包根锚定，避免 `@radix-ui/react-dom` 之类被误收。
          if (
            /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?(?:react|react-dom|scheduler)[\\/]/.test(
              id,
            ) ||
            /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?react-router/.test(id) ||
            id.includes("@remix-run")
          )
            return "vendor-react";
          if (id.includes("@dnd-kit")) return "vendor-dnd";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          if (id.includes("i18next") || id.includes("react-i18next"))
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
