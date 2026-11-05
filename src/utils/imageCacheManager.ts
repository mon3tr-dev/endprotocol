import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";

export type CacheMode = "smart" | "manual";

interface CacheConfig {
  mode: CacheMode;
  maxEntries: number;
  maxSizeMB: number;
}

const SMART_MAX_ENTRIES = 100;
const DEFAULT_MANUAL_MAX_SIZE_MB = 100;

/**
 * smart 模式的兜底字节上限。
 *
 * smart 模式靠「引用计数 + pin」驱动驱逐，条目数刻意不设硬上限——视图里正在用的
 * 图片不该因为条数到了就被踢掉再重新解码。但有一条必须兜底的路径：
 * 同一批图片同时用 `useImageRequest` 和 `usePinImages` 时，React 的卸载顺序是
 * 先 release、后 unpin；release 那一刻图片还是 pinned，于是既不会被 release 驱逐，
 * 也不会被 unpin 驱逐，只能永久留在内存里（blob URL 持有整张图片的二进制，
 * 不计入 JS 堆，只体现在 WebView renderer 进程上）。
 * `unpin()` 已补上驱逐调度，这里再给一个足够宽松的上限，
 * 保证任何遗漏路径下缓存也不会无界增长。256MB 远高于正常浏览所需。
 */
const SMART_MAX_SIZE_MB = 256;

class ImageCacheManager {
  private cache = new Map<string, string>();
  private sizes = new Map<string, number>();
  private accessOrder: string[] = [];
  private refCounts = new Map<string, number>();
  private pinned = new Set<string>();
  private loading = new Map<string, Promise<string>>();
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private config: CacheConfig = {
    mode: "smart",
    maxEntries: SMART_MAX_ENTRIES,
    maxSizeMB: DEFAULT_MANUAL_MAX_SIZE_MB,
  };

  private totalSizeBytes = 0;

  private cacheDirPromise: Promise<string> | null = null;

  private getCacheDir(): Promise<string> {
    if (!this.cacheDirPromise) {
      this.cacheDirPromise = invoke<string>("get_image_cache_dir").catch((e) => {
        console.error("[imageCache] Failed to get cache dir:", e);
        this.cacheDirPromise = null;
        throw e;
      });
    }
    return this.cacheDirPromise;
  }

  configure(cfg: Partial<CacheConfig>) {
    if (cfg.mode !== undefined) this.config.mode = cfg.mode;
    if (cfg.maxEntries !== undefined) this.config.maxEntries = cfg.maxEntries;
    if (cfg.maxSizeMB !== undefined) this.config.maxSizeMB = cfg.maxSizeMB;
  }

  getConfig(): CacheConfig {
    return { ...this.config };
  }

  getStats() {
    return {
      entries: this.cache.size,
      totalSizeMB: Math.round((this.totalSizeBytes / (1024 * 1024)) * 100) / 100,
      maxEntries: this.config.mode === "smart" ? Infinity : this.config.maxEntries,
      maxSizeMB: this.config.mode === "smart" ? Infinity : this.config.maxSizeMB,
    };
  }

  getEntries() {
    return this.accessOrder
      .filter((path) => this.cache.has(path))
      .map((path) => ({
        path,
        sizeKB: Math.round(((this.sizes.get(path) ?? 0) / 1024) * 10) / 10,
        pinned: this.pinned.has(path),
        refCount: this.refCounts.get(path) ?? 0,
      })).reverse();
  }

  private getEffectiveMaxEntries(): number {
    return this.config.mode === "smart" ? Infinity : this.config.maxEntries;
  }

  private getEffectiveMaxSizeBytes(): number {
    return this.config.mode === "smart"
      ? SMART_MAX_SIZE_MB * 1024 * 1024
      : this.config.maxSizeMB * 1024 * 1024;
  }

  async load(path: string): Promise<string> {
    if (!path) return "";
    if (path.startsWith("blob:") || path.startsWith("data:")) {
      return path;
    }
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return this.loadRemote(path);
    }

    const hit = this.cache.get(path);
    if (hit) {
      this.cancelEviction(path);
      this.touch(path);
      return hit;
    }

    const inflight = this.loading.get(path);
    if (inflight) return inflight;

    const promise = invoke<ArrayBuffer>("read_image_file", { path })
      .then((bytes) => {
        const blob = new Blob([new Uint8Array(bytes)]);
        const url = URL.createObjectURL(blob);
        const byteSize = bytes.byteLength;
        this.evictFor(byteSize);
        this.cache.set(path, url);
        this.sizes.set(path, byteSize);
        this.totalSizeBytes += byteSize;
        this.touch(path);
        return url;
      })
      .finally(() => this.loading.delete(path));

    this.loading.set(path, promise);
    return promise;
  }

  /**
   * 按需下载远程图片到本地缓存，返回 blob URL。
   * 已缓存则直接读取本地文件，未缓存则先调用后端 download_image。
   */
  private async loadRemote(url: string): Promise<string> {
    const hit = this.cache.get(url);
    if (hit) {
      this.cancelEviction(url);
      this.touch(url);
      return hit;
    }

    const inflight = this.loading.get(url);
    if (inflight) return inflight;

    const promise = (async () => {
      const cacheDir = await this.getCacheDir();
      const localPath = await invoke<string>("download_image", {
        url,
        cacheDir,
        subDir: "",
      });
      const bytes = await invoke<ArrayBuffer>("read_image_file", { path: localPath });
      const blob = new Blob([new Uint8Array(bytes)]);
      const objectUrl = URL.createObjectURL(blob);
      const byteSize = bytes.byteLength;
      this.evictFor(byteSize);
      this.cache.set(url, objectUrl);
      this.sizes.set(url, byteSize);
      this.totalSizeBytes += byteSize;
      this.touch(url);
      return objectUrl;
    })().finally(() => this.loading.delete(url));

    this.loading.set(url, promise);
    return promise;
  }

  request(paths: string[]) {
    for (const p of paths) {
      if (!p) continue;
      const prev = this.refCounts.get(p) ?? 0;
      this.refCounts.set(p, prev + 1);
      if (prev === 0) this.cancelEviction(p);
      this.touch(p);
    }
  }

  release(paths: string[]) {
    for (const p of paths) {
      if (!p) continue;
      const n = this.refCounts.get(p) ?? 0;
      if (n === 1) {
        this.refCounts.delete(p);
        if (this.cache.has(p) && !this.pinned.has(p)) {
          this.scheduleEviction(p);
        }
      } else if (n > 1) {
        this.refCounts.set(p, n - 1);
      }
    }
  }

  pin(paths: string[]) {
    for (const p of paths) {
      if (!p) continue;
      this.pinned.add(p);
      this.cancelEviction(p);
    }
  }

  unpin(paths: string[]) {
    for (const p of paths) {
      if (!p) continue;
      this.pinned.delete(p);
      // 卸载顺序是「先 release、后 unpin」：release 那一刻图片还 pin 着，不会被驱逐；
      // 到 unpin 这一刻它已经既没引用也没 pin，再不补一次调度就永远留在内存里了。
      if (this.cache.has(p) && (this.refCounts.get(p) ?? 0) === 0) {
        this.scheduleEviction(p);
      }
    }
  }

  private cancelEviction(path: string) {
    const timer = this.evictionTimers.get(path);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.evictionTimers.delete(path);
    }
  }

  private scheduleEviction(path: string) {
    if (this.config.mode === "manual") return;
    this.cancelEviction(path);
    const timer = setTimeout(() => {
      this.evictionTimers.delete(path);
      const url = this.cache.get(path);
      const byteSize = this.sizes.get(path) ?? 0;
      if (url) URL.revokeObjectURL(url);
      this.cache.delete(path);
      this.sizes.delete(path);
      this.totalSizeBytes -= byteSize;
      const idx = this.accessOrder.indexOf(path);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
    }, 20000);
    this.evictionTimers.set(path, timer);
  }

  private isProtected(path: string) {
    return this.pinned.has(path) || (this.refCounts.get(path) ?? 0) > 0;
  }

  private touch(path: string) {
    const idx = this.accessOrder.indexOf(path);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(path);
  }

  /**
   * 驱逐一个最久未使用的条目。
   *
   * @returns 是否真的驱逐成功。smart 模式下条目可能全部被 pin / 引用保护，
   *          此时返回 false —— 调用方必须据此收手，否则 `evictFor` 的 while
   *          会因为「驱逐不动」而空转成死循环，把界面卡死。
   */
  private evictOne(): boolean {
    if (this.accessOrder.length === 0) return false;
    let scanned = 0;
    while (scanned < this.accessOrder.length) {
      const oldest = this.accessOrder.shift();
      if (!oldest) break;
      if (this.config.mode === "smart" && this.isProtected(oldest)) {
        this.accessOrder.push(oldest);
        scanned++;
        continue;
      }
      this.cancelEviction(oldest);
      const url = this.cache.get(oldest);
      const byteSize = this.sizes.get(oldest) ?? 0;
      if (url) URL.revokeObjectURL(url);
      this.cache.delete(oldest);
      this.sizes.delete(oldest);
      this.totalSizeBytes -= byteSize;
      return true;
    }
    return false;
  }

  private evictFor(incomingSize: number) {
    const maxEntries = this.getEffectiveMaxEntries();
    const maxBytes = this.getEffectiveMaxSizeBytes();

    while (
      this.cache.size > 0 &&
      (this.cache.size >= maxEntries || this.totalSizeBytes + incomingSize > maxBytes)
    ) {
      // 没有任何条目可驱逐（全部被 pin / 仍被引用）时立即收手。
      if (!this.evictOne()) break;
    }
  }

  async loadMultiple(paths: string[]): Promise<string[]> {
    return Promise.all(paths.map((p) => this.load(p)));
  }

  evictInactive() {
    for (const [path] of this.evictionTimers) {
      this.cancelEviction(path);
    }
    for (const path of [...this.accessOrder]) {
      if (this.isProtected(path)) continue;
      const url = this.cache.get(path);
      const byteSize = this.sizes.get(path) ?? 0;
      if (url) URL.revokeObjectURL(url);
      this.cache.delete(path);
      this.sizes.delete(path);
      this.totalSizeBytes -= byteSize;
    }
    this.accessOrder = this.accessOrder.filter((p) => this.cache.has(p));
  }
}

export const cacheManager = new ImageCacheManager();

export function useImageRequest(paths: string[], deps: unknown[] = []) {
  const prevRef = useRef<string[]>([]);

  useEffect(() => {
    const prev = prevRef.current;
    const toRelease = prev.filter((p) => !paths.includes(p));
    const toRequest = paths.filter((p) => !prev.includes(p));
    if (toRelease.length) cacheManager.release(toRelease);
    if (toRequest.length) cacheManager.request(toRequest);
    prevRef.current = paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    return () => {
      const last = prevRef.current;
      if (last.length) cacheManager.release(last);
    };
  }, []);
}

export function usePinImages(paths: string[]) {
  useEffect(() => {
    if (paths.length) cacheManager.pin(paths);
    return () => {
      if (paths.length) cacheManager.unpin(paths);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join(",")]);
}
