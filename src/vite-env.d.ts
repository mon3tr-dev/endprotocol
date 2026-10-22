/// <reference types="vite/client" />

declare module "*.json" {
  const value: any;
  export default value;
}

interface Window {
  /** index.html 的启动脚本兜底计时器；main.tsx 启动后清除。 */
  __endprotocolBootTimer?: number;
}
