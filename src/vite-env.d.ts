/// <reference types="vite/client" />

/**
 * 构建期常量，由 `vite.config.ts` 的 `define` 注入（见 `src/utils/appInfoService.ts`）。
 * 用途是给 `plugin:app|*` 这类 IPC 取不到值时兜底，避免版本卡片显示成空。
 */
declare const __APP_VERSION__: string;
declare const __TAURI_CORE_VERSION__: string;
declare const __APP_IDENTIFIER__: string;

declare module "*.json" {
  const value: any;
  export default value;
}

interface Window {
  /** index.html 的启动脚本兜底计时器；main.tsx 启动后清除并置空。 */
  __endprotocolBootTimer?: number;
}
