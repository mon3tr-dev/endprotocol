// Build a local Android debug APK whose versionCode sits above every published
// release, then install it without wiping the data already on the device.
//
// ---------------------------------------------------------------------------
// Why this exists
// ---------------------------------------------------------------------------
// `pnpm tauri android build --debug` produces an APK that cannot be installed on
// a phone that already runs a release build, for two independent reasons:
//
//   1. versionCode. Tauri derives it from `version` as
//      major*1_000_000 + minor*1_000 + patch. The checked-in version is 0.1.0
//      (CI rewrites it from the git tag; local builds never do), so a local APK
//      ships 1000 while the release built from tag v0.1.7-pre4 carries 1007.
//      Android rejects that as a downgrade:
//          INSTALL_FAILED_VERSION_DOWNGRADE
//
//   2. Signature. Local builds sign with the Android *debug* keystore
//      (CN=Android Debug); releases use the project keystore (CN=mon3tr).
//      A signature change is never allowed in place — there is no flag for it.
//
// The conventional workaround for both is `adb uninstall`, which deletes
// /data/data wholesale and takes every account, dashboard tab and card layout
// with it. That is a data-loss bug in the dev workflow, not an unavoidable
// cost, so this script fixes both halves:
//
//   - versionCode is computed from the git tags and passed to the build through
//     Tauri's `--config` overlay, so `src-tauri/tauri.conf.json` stays untouched
//     and release builds keep deriving their own code from the tag.
//   - before crossing the signature boundary we archive the app's private
//     config with `run-as` (works because debug builds are debuggable) and
//     restore it afterwards.
//
// Usage:
//   node scripts/android-build-install.mjs                    # build + install
//   node scripts/android-build-install.mjs --target x86_64
//   node scripts/android-build-install.mjs --install-only <apk>
//   node scripts/android-build-install.mjs --dry-run
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "cn.msk_network.endprotocol";

// Local builds answer to nobody but the developer, so park them well clear of
// anything a release will reach (Tauri caps the field at 2.1e9). Play never
// sees these builds; the in-app updater only ever installs genuine releases.
const LOCAL_HEADROOM = 1_000_000;

// Equal versionCodes are fine for `adb install -r` as long as the certificate
// matches, so a rebuild can reuse the same code. But this workflow crosses a
// signature boundary on every cycle (debug keystore vs release keystore), which
// forces an uninstall — and that is exactly when Android also enforces
// "not a downgrade". Bumping by one each build keeps back-to-back rebuilds
// installable without any manual bookkeeping.
const LOCAL_STRIDE = 1;

// Files worth keeping across a reinstall. Everything else under /data/data is
// regenerable cache (webview, code_cache, image_cache).
//
// `secrets.key` is only the key for the *encrypted-file* fallback backend (used
// where no OS credential store exists, e.g. a Linux AppImage). On Android the
// keyring backend is available, so credentials live in the Android Keystore,
// which is bound to the package + signature and lives outside /data/data —
// `run-as` cannot reach it. Preserving these files is therefore necessary but
// not sufficient: after a signature-crossing reinstall the account metadata and
// role bindings survive while `cred`/`token` become unreadable, and the user has
// to sign in to that account once to restore them. See docs/development.md.
const PRESERVE = [
  "app_config.json",
  "app_config.json.bak",
  "secrets.key",
  "secrets.enc",
];

const EXE = process.platform === "win32" ? ".exe" : "";

// ---------------------------------------------------------------------------
// Tool discovery — neither adb nor aapt2 is on PATH on a typical Windows box,
// and this script must not assume the caller exported ANDROID_HOME.
// ---------------------------------------------------------------------------
function sdkRoot() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, "AppData", "Local", "Android", "Sdk"),
    process.env.HOME && path.join(process.env.HOME, "Android", "Sdk"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function findTool(name) {
  const root = sdkRoot();
  if (root && name === "adb") {
    const p = path.join(root, "platform-tools", `adb${EXE}`);
    if (fs.existsSync(p)) return p;
  }
  if (root && name === "aapt2") {
    const bt = path.join(root, "build-tools");
    if (fs.existsSync(bt)) {
      const versions = fs
        .readdirSync(bt)
        .filter((v) => fs.existsSync(path.join(bt, v, `aapt2${EXE}`)))
        .sort((a, b) => {
          const pa = a.split(".").map(Number);
          const pb = b.split(".").map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pb[i] || 0) - (pa[i] || 0);
            if (d !== 0) return d;
          }
          return 0;
        });
      if (versions[0]) return path.join(bt, versions[0], `aapt2${EXE}`);
    }
  }
  return name; // last resort: PATH
}

const ADB = findTool("adb");
const AAPT2 = findTool("aapt2");

// ---------------------------------------------------------------------------
// versionCode derivation
// ---------------------------------------------------------------------------
/** Tauri's documented mapping: version.major * 1e6 + minor * 1e3 + patch. */
const versionCodeOf = (major, minor, patch) =>
  major * 1_000_000 + minor * 1_000 + patch;

function parseTag(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag.trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

/** Highest versionCode among tags reachable from HEAD, or null if none. */
function localVersionCode() {
  let tags = [];
  try {
    tags = execFileSync("git", ["tag", "--list", "--merged", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null; // shallow clone / tarball: nothing to stay ahead of
  }

  let highest = 0;
  let tag = null;
  for (const t of tags) {
    const parsed = parseTag(t);
    if (!parsed) continue;
    const code = versionCodeOf(parsed.major, parsed.minor, parsed.patch);
    if (code > highest) {
      highest = code;
      tag = t;
    }
  }
  return highest === 0 ? null : { code: highest, tag, local: highest + LOCAL_HEADROOM };
}

// ---------------------------------------------------------------------------
// device helpers
// ---------------------------------------------------------------------------
function makeAdb(serial) {
  const args = serial ? ["-s", serial] : [];
  return (argv, opts = {}) =>
    execFileSync(ADB, [...args, ...argv], {
      encoding: opts.binary ? "buffer" : "utf8",
      ...opts,
    });
}

function installedVersionCode(adb) {
  try {
    const out = adb(["shell", "dumpsys", "package", PACKAGE]);
    const m = /versionCode=(\d+)/.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function apkVersionCode(apk) {
  try {
    const out = execFileSync(AAPT2, ["dump", "badging", apk], { encoding: "utf8" });
    const m = /versionCode='(\d+)'/.exec(out);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const installOnly = argv.includes("--install-only");
  const devIdx = argv.indexOf("--device");
  const serial = devIdx >= 0 ? argv[devIdx + 1] : null;
  const tgtIdx = argv.indexOf("--target");
  const target = tgtIdx >= 0 ? argv[tgtIdx + 1] : "x86_64";

  const log = (m) => console.log(`[android] ${m}`);
  const adb = makeAdb(serial);

  // ---- 1. build (unless --install-only) ----
  let apkPath;
  if (installOnly) {
    apkPath = argv.find((a) => a.endsWith(".apk"));
    if (!apkPath || !fs.existsSync(apkPath)) {
      console.error("[android] --install-only needs an existing .apk path");
      return 2;
    }
  } else {
    const vc = localVersionCode();
    const installedForBump = installedVersionCode(adb);
    // Sit above both the tags and whatever is currently installed, so a rebuild
    // a minute after the last install is still an upgrade.
    const buildCode = Math.max(
      vc ? vc.local : 1,
      (installedForBump ?? 0) + LOCAL_STRIDE,
    );
    if (!vc) {
      log("WARNING: no parseable git tags; the APK may be rejected as a downgrade");
    } else {
      log(
        `versionCode ${buildCode} (tag ${vc.tag} = ${vc.code} + ${LOCAL_HEADROOM}` +
          `${installedForBump != null ? `, installed ${installedForBump} + ${LOCAL_STRIDE}` : ""})`,
      );
    }

    // Overlay the versionCode instead of editing tauri.conf.json: release builds
    // must keep deriving their own code from the tag, and a committed
    // versionCode would leak into every future release.
    const overlayDir = fs.mkdtempSync(path.join(os.tmpdir(), "endprotocol-conf-"));
    const overlayPath = path.join(overlayDir, "local-version.json");
    fs.writeFileSync(
      overlayPath,
      JSON.stringify({ bundle: { android: { versionCode: buildCode } } }, null, 2),
    );

    // The Gradle toolchain wants JDK 21; the Android SDK ships one. Prefer it
    // over whatever JAVA_HOME the shell happens to hold (this box has 25/27,
    // which sends Gradle off to download a toolchain and fail on flaky network).
    const env = { ...process.env };
    if (!env.JAVA_HOME) {
      const bundled = ["C:/Program Files/Android/openjdk/jdk-21.0.8"].find((p) =>
        fs.existsSync(p),
      );
      if (bundled) env.JAVA_HOME = bundled;
    }
    const root = sdkRoot();
    env.ANDROID_HOME ??= root ?? "";
    if (!env.NDK_HOME && root) {
      const ndk = path.join(root, "ndk");
      if (fs.existsSync(ndk)) {
        const dirs = fs.readdirSync(ndk).sort().reverse();
        if (dirs[0]) env.NDK_HOME = path.join(ndk, dirs[0]);
      }
    }

    log(`building debug APK for ${target}${dryRun ? " (dry run)" : ""}`);
    if (!dryRun) {
      const res = spawnSync(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["tauri", "android", "build", "--debug", "--apk", "--target", target, "--config", overlayPath],
        {
          cwd: repoRoot,
          env,
          encoding: "utf8",
          maxBuffer: 128 * 1024 * 1024,
          // .cmd shims cannot be spawned directly on Windows without a shell;
          // without this spawnSync exits immediately with status null.
          shell: process.platform === "win32",
        },
      );
      if (res.status !== 0) {
        // Surface the tail of the real compiler/Gradle output; swallowing it
        // leaves the caller with an opaque "build failed".
        const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`.trim();
        const tail = output.split("\n").slice(-40).join("\n");
        console.error(`[android] build failed (exit ${res.status}):\n${tail}`);
        return 1;
      }
    }
    // Newest debug APK under the Gradle outputs tree. The per-ABI vs universal
    // directory depends on how the CLI resolved `--target`, so globbing beats
    // hard-coding a path that silently goes stale.
    const apkRoot = path.join(
      repoRoot,
      "src-tauri/gen/android/app/build/outputs/apk",
    );
    const candidates = [];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith("-debug.apk")) {
          candidates.push({ full, mtime: fs.statSync(full).mtimeMs });
        }
      }
    };
    walk(apkRoot);
    candidates.sort((a, b) => b.mtime - a.mtime);
    apkPath = candidates[0]?.full;
    if (!dryRun && !apkPath) {
      console.error(`[android] no *-debug.apk found under ${apkRoot}`);
      return 1;
    }
    if (apkPath) {
      log(`${dryRun ? "would use" : "built"} ${path.relative(repoRoot, apkPath)}`);
    }
  }

  // ---- 2. decide whether the data needs protecting ----
  const installed = installedVersionCode(adb);
  const incoming = apkVersionCode(apkPath);
  log(`installed versionCode=${installed ?? "(none)"}  APK versionCode=${incoming ?? "(unknown)"}`);

  // A stale APK (older than what is on the device) must be rebuilt, not
  // force-installed; Android rejects it and nothing good comes of trying.
  if (installed != null && incoming != null && incoming < installed) {
    console.error(
      `\n[android] REFUSING: APK versionCode (${incoming}) is older than the installed ` +
        `one (${installed}).\n          Rebuild so the versionCode advances ` +
        `(--install-only reuses an existing APK and cannot bump it).`,
    );
    return 1;
  }

  const debuggable = (() => {
    try {
      adb(["shell", "run-as", PACKAGE, "id"]);
      return true;
    } catch {
      return false;
    }
  })();

  if (dryRun) {
    log(`debuggable=${debuggable}; would preserve [${PRESERVE.join(", ")}]`);
    log("dry run: nothing installed");
    return 0;
  }

  // ---- 3. back up private data ----
  let backupDir = null;
  if (installed != null && debuggable) {
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "endprotocol-data-"));
    const tarPath = path.join(backupDir, "data.tar");
    log(`backing up private data -> ${backupDir}`);

    // exec-out keeps the stream byte-exact; `shell` would mangle CR/LF on Windows.
    const res = spawnSync(
      ADB,
      [...(serial ? ["-s", serial] : []), "exec-out", "run-as", PACKAGE, "tar", "-cf", "-", ...PRESERVE],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    );
    fs.writeFileSync(tarPath, res.stdout ?? Buffer.alloc(0));

    // A missing optional file (e.g. the .bak before the first save) can make tar
    // exit non-zero; judge by what actually landed in the archive instead.
    const list = spawnSync("tar", ["-tf", tarPath], { encoding: "utf8" });
    const entries = (list.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    if (entries.length === 0) {
      log("WARNING: backup is empty — the reinstall will start from scratch");
      backupDir = null;
    } else {
      log(`backed up ${entries.length} file(s): ${entries.join(", ")}`);
    }
  } else if (installed != null) {
    console.error(
      "[android] REFUSING: the installed app is not debuggable (release build), so its\n" +
        "          private data cannot be archived. Reinstalling a differently-signed APK\n" +
        "          would erase it.",
    );
    return 1;
  }

  // ---- 4. reinstall ----
  try {
    if (installed != null) {
      log("uninstalling (signature/version change cannot be applied in place)");
      adb(["uninstall", PACKAGE]);
    }
    log("installing");
    adb(["install", "-r", apkPath]);
  } catch (error) {
    console.error(`[android] install failed: ${error.message}`);
    if (backupDir) console.error(`[android] data preserved at: ${backupDir}`);
    return 1;
  }

  // ---- 5. restore ----
  if (backupDir) {
    const tarPath = path.join(backupDir, "data.tar");
    log("restoring private data");
    const res = spawnSync(
      ADB,
      [...(serial ? ["-s", serial] : []), "exec-in", "run-as", PACKAGE, "tar", "-xf", "-"],
      { input: fs.readFileSync(tarPath), maxBuffer: 64 * 1024 * 1024 },
    );
    if (res.status !== 0) {
      console.error(
        `[android] restore failed (status ${res.status}).\n` +
          `          Data preserved at: ${backupDir}\n` +
          `          Retry: adb exec-in run-as ${PACKAGE} tar -xf - < "${tarPath}"`,
      );
      return 1;
    }
    log("data restored");
  }

  log("done — launch the app and confirm accounts/cards are intact");
  return 0;
}

process.exit(main());
