import { invoke } from "@tauri-apps/api/core";
import { getConfig } from "@/utils/configService";

export const DEFAULT_BG_IMAGE_OPACITY = 0.5;
export const DEFAULT_BG_BLUR = 16;

export interface BackgroundSettings {
  imagePath: string | null;
  imageUrl: string | null;
  imageOpacity: number;
  blur: number;
}

export async function loadBackgroundSettings(): Promise<BackgroundSettings> {
  const [imagePath, savedOpacity, savedBlur] = await Promise.all([
    getConfig<string>("bg_image_path"),
    getConfig<number>("bg_image_opacity"),
    getConfig<number>("bg_blur"),
  ]);

  const imageOpacity = savedOpacity ?? DEFAULT_BG_IMAGE_OPACITY;
  const blur = savedBlur ?? DEFAULT_BG_BLUR;
  const root = document.documentElement;

  root.style.setProperty("--bg-image-opacity", String(imageOpacity));
  root.style.setProperty("--bg-blur", `${blur}px`);
  root.style.setProperty("--bg-image", "none");

  let imageUrl: string | null = null;
  if (imagePath) {
    try {
      const bytes = await invoke<ArrayBuffer>("read_image_file", { path: imagePath });
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/webp" });
      imageUrl = URL.createObjectURL(blob);
      root.style.setProperty("--bg-image", `url(${imageUrl})`);
    } catch {
      // Keep the background empty when the configured file is unavailable.
    }
  }

  return { imagePath: imagePath ?? null, imageUrl, imageOpacity, blur };
}
