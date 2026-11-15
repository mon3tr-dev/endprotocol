// Shim for the generated Android Gradle `BuildTask`.
//
// `src-tauri/gen/android/buildSrc/.../BuildTask.kt` runs:
//     node tauri android android-studio-script --target <arch>
// with the working directory set to `src-tauri/`. Node treats the first
// non-flag argument as a script path, so it looks for `src-tauri/tauri`
// (with implicit .js/.cjs/.mjs probing) — not for a package on NODE_PATH.
//
// This file makes that invocation resolve to the project's Tauri CLI. Using a
// dynamic `import()` keeps it working regardless of whether the nearest
// package.json declares CommonJS or ESM.
import { pathToFileURL } from "node:url";
import path from "node:path";

const cliEntry = path.resolve(
  import.meta.dirname,
  "../node_modules/@tauri-apps/cli/tauri.js",
);

await import(pathToFileURL(cliEntry).href);
