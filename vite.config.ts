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
      // 3. tell Vite to ignore watching `src-tauri` 以及根目录下的构建产物。
      //
      // 根目录 `target/`（Rust workspace 的构建目录）在本机有 35 GB / 5.6 万个文件。
      // Vite 8 的文件监听器是 Rust 实现、启动即递归建树，扫描它会把**首个模块请求**
      // 阻塞数十秒（实测冷启动 `/src/main.tsx` 耗时 46 秒），表现就是 `tauri dev`
      // 起来后窗口长时间只有启动 splash、控制台没有任何输出——看起来像"窗口没内容"。
      // `dist/`、`dist-linux/` 同理：它们是本项目的产物目录，dev 下不需要监听。
      ignored: [
        "**/src-tauri/**",
        "**/target/**",
        "**/dist/**",
        "**/dist-linux/**",
      ],
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        "tray-panel": path.resolve(import.meta.dirname, "tray-panel.html"),
      },
      output: {
        // 每个第三方包只落在唯一一个 chunk 里，且 chunk 之间**没有回边**。
        //
        // Vite 8 起 bundler 由 Rolldown 接管：`manualChunks` 函数形式已 deprecated，
        // 迁移到原生 `codeSplitting.groups`（test 匹配模块 id，group 依赖方向单一）。
        //
        // 此前用 `id.includes("react-dom")` 做匹配，它同时命中了 `@radix-ui/react-dom`
        // 等包，于是 Radix 的模块被塞进 `vendor-react`，而它们又 import 其它 Radix
        // 包 —— Rollup 直接报告 circular chunk，前端在 main.tsx 之前就崩了。
        // 所以 React 组仍按「包根目录」精确锚定（react/react-dom/scheduler），保证依赖方向单一：
        //   vendor-ui / vendor-dnd → vendor-react → vendor
        codeSplitting: {
          groups: [
            { name: "vendor-zrender", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?zrender[\\/]/, priority: 10 },
            { name: "vendor-echarts", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?echarts[\\/]/, priority: 10 },
            // React 运行时成组：react / react-dom / scheduler / router 互相引用，
            // 用相同 name 落进同一个 chunk；按包根锚定，避免 `@radix-ui/react-dom` 被误收。
            { name: "vendor-react", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?(?:react|react-dom|scheduler)[\\/]/, priority: 10 },
            { name: "vendor-react", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?react-router(?:-dom)?[\\/]/, priority: 10 },
            { name: "vendor-react", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?@remix-run[\\/]/, priority: 10 },
            { name: "vendor-dnd", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?@dnd-kit[\\/]/, priority: 10 },
            { name: "vendor-tauri", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?@tauri-apps[\\/]/, priority: 10 },
            { name: "vendor-i18n", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?(?:i18next|react-i18next)[\\/]/, priority: 10 },
            { name: "vendor-ui", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?lucide[\\/]/, priority: 10 },
            { name: "vendor-ui", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?morphicons[\\/]/, priority: 10 },
            { name: "vendor-ui", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?@radix-ui[\\/]/, priority: 10 },
            { name: "vendor-ui", test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/])?qrcode[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  base: "./",
}));
