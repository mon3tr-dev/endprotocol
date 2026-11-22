import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { addMessage, updateMessage, removeMessage, removeMessagesByTag, type AppMessage } from "./messageStore";
import { pushGlobalAlert } from "@/components/ui/global-alert";
import { getConfig, setConfig } from "./configService";
import logger from "./logger";
import { isAndroidApp, isWindowsPlatform, isMobileApp } from "./platform";
// 本地版本也走容错封装：getVersion() 直接 reject 时，更新检查会整条链路失败。
import { getAppVersion } from "./appInfoService";

// ============================================================================
// Types
// ============================================================================

export type UpdateChannel = "stable" | "preview";

export type UpdateSource = "github" | "mirror";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "error";

export type ChangelogStatus =
  | "idle"
  | "loading"
  | "success"
  | "failed"
  | "unavailable";

export type UpdateErrorCode =
  | "UPDATE_CHECK_FAILED"
  | "CHANGELOG_FETCH_FAILED"
  | "DOWNLOAD_FAILED"
  | "INSTALL_FAILED";

export interface UpdateInfo {
  currentVersion: string;
  newVersion: string;
  date?: string;
  body?: string;
  apkUrl?: string;
}

export interface ManualUpdate {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
}

export interface AndroidUpdate extends ManualUpdate {
  apkUrl: string;
}

/**
 * Result of handing a downloaded APK to Android's package installer.
 *
 * `permissionRequired` means the app is not yet allowed to install unknown apps; the
 * plugin has already opened the system settings screen for the user to grant it.
 */
export type AndroidInstallStatus = "opened" | "permissionRequired";

export interface AndroidInstallResult {
  status: AndroidInstallStatus;
}

/** Narrow an update to the Android manual-update shape (which always has an APK URL). */
function isAndroidUpdate(
  update: Update | ManualUpdate,
): update is AndroidUpdate {
  return "apkUrl" in update && typeof update.apkUrl === "string";
}

export interface UpdateCheckResult {
  available: boolean;
  update: UpdateInfo | null;
  changelog: string | null;
  changelogStatus: ChangelogStatus;
  status: UpdateStatus;
  errorCode?: UpdateErrorCode;
  errorMessage?: string;
}

interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  body: string;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

interface ChangelogCacheEntry {
  changelog: string;
  timestamp: number;
}

// ============================================================================
// Constants
// ============================================================================

const REPO_OWNER = "mon3tr-dev";
const REPO_NAME = "endprotocol";
const GITHUB_API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const MIRROR_BASE = "https://updates.msk-network.cn";
const CHANGELOG_CACHE_TTL = 30 * 1000;
const CHANGELOG_CACHE_KEY_PREFIX = "changelog_cache_";

// ============================================================================
// State
// ============================================================================

let currentUpdate: Update | ManualUpdate | AndroidUpdate | null = null;
let currentUpdateInfo: UpdateInfo | null = null;
let isDownloading = false;
let downloadProgress = 0;
let downloadTotal = 0;
let downloadAbortController: AbortController | null = null;
let currentChannel: UpdateChannel = "stable";
let currentSource: UpdateSource = "github";
let previousChannel: UpdateChannel | null = null;
let channelSwitchDetected = false;
let changelogCache: Map<string, ChangelogCacheEntry> = new Map();
let status: UpdateStatus = "idle";
let listeners: Array<() => void> = [];

// Android: path of the APK downloaded during the current update attempt. Retained so a
// user who had to grant "install unknown apps" can retry the install without
// re-downloading the package.
let lastAndroidApkPath: string | null = null;

// The updater plugin installs manual channel updates from this manifest endpoint.
let manualUpdaterEndpoint: string | null = null;

// ============================================================================
// SemVer Helpers
// ============================================================================

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemVer(version: string): SemVer | null {
  const match = version.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/,
  );
  if (!match) return null;

  const prerelease = match[4]
    ? match[4].split(".").map((p) => p.toLowerCase())
    : [];

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease,
  };
}

function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;

  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;

  const maxLen = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < maxLen; i++) {
    const aId = a.prerelease[i];
    const bId = b.prerelease[i];

    if (aId === undefined) return -1;
    if (bId === undefined) return 1;

    const aNum = /^\d+$/.test(aId) ? parseInt(aId, 10) : null;
    const bNum = /^\d+$/.test(bId) ? parseInt(bId, 10) : null;

    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      if (aId !== bId) return aId < bId ? -1 : 1;
    }
  }

  return 0;
}

function isPreviewChannel(version: string): boolean {
  const semver = parseSemVer(version);
  return semver !== null && semver.prerelease.length > 0;
}

function stripVPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function channelFromVersion(version: string): UpdateChannel {
  return isPreviewChannel(version) ? "preview" : "stable";
}

// ============================================================================
// GitHub API
// ============================================================================

async function fetchGitHubReleases(): Promise<GitHubRelease[]> {
  const response = await fetch(`${GITHUB_API_BASE}/releases?per_page=100`);
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

async function fetchGitHubReleaseByTag(
  tag: string,
): Promise<GitHubRelease | null> {
  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/releases/tags/${encodeURIComponent(tag)}`,
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function getLatestPreviewEndpoint(): Promise<string | null> {
  const releases = await fetchGitHubReleases();
  const latest = releases
    .filter((release) => release.prerelease && !release.draft)
    .map((release) => ({
      release,
      version: parseSemVer(stripVPrefix(release.tag_name)),
    }))
    .filter(
      (item): item is { release: GitHubRelease; version: SemVer } =>
        item.version !== null,
    )
    .sort((a, b) => compareSemVer(b.version, a.version))[0]?.release;

  if (!latest) return null;
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${encodeURIComponent(latest.tag_name)}/latest.json`;
}

/** A manifest that passed `fetchReleaseManifest`: the version is guaranteed. */
type ManifestWithVersion = ReleaseManifest & { version: string };

/** Fetch a `latest.json`; any failure (network, JSON) becomes `null`. */
async function fetchReleaseManifest(
  endpoint: string,
): Promise<ManifestWithVersion | null> {
  try {
    const text = await invoke<string>("fetch_url", { url: endpoint });
    const manifest = JSON.parse(text) as ReleaseManifest;
    // The mirror manifest is generated by a Worker, so `version` is not
    // guaranteed; normalise it here instead of letting `undefined` reach
    // `parseSemVer` and throw the whole check.
    if (typeof manifest.version !== "string" || manifest.version === "") {
      logger.warn(`Update manifest ${endpoint} carries no version`, "Updater");
      return null;
    }
    return manifest as ManifestWithVersion;
  } catch (error) {
    logger.info(`Update manifest unavailable (${endpoint}): ${error}`, "Updater");
    return null;
  }
}

// ============================================================================
// Changelog Cache
// ============================================================================

function getCacheKey(channel: UpdateChannel, version: string): string {
  return `${CHANGELOG_CACHE_KEY_PREFIX}${channel}_${version}`;
}

function getChangelogFromCache(
  channel: UpdateChannel,
  version: string,
): string | null {
  const key = getCacheKey(channel, version);
  const entry = changelogCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CHANGELOG_CACHE_TTL) {
    changelogCache.delete(key);
    return null;
  }
  return entry.changelog;
}

function setChangelogCache(
  channel: UpdateChannel,
  version: string,
  changelog: string,
): void {
  const key = getCacheKey(channel, version);
  changelogCache.set(key, { changelog, timestamp: Date.now() });
}

// ============================================================================
// Channel Switch Detection
// ============================================================================

function isChannelSwitchUpdateRequired(
  localVersion: string,
  remoteVersion: string,
  targetChannel: UpdateChannel,
): boolean {
  const localChannel = channelFromVersion(localVersion);
  const remoteChannel = channelFromVersion(remoteVersion);

  if (localChannel === remoteChannel) return false;
  if (remoteChannel !== targetChannel) return false;

  return localVersion !== remoteVersion;
}

// ============================================================================
// Get Mirror Changelog URL
// ============================================================================

async function fetchMirrorChangelogUrl(channel: UpdateChannel): Promise<string | null> {
  const endpoint = channel === "stable"
    ? `${MIRROR_BASE}/stable/latest.json`
    : `${MIRROR_BASE}/preview/latest.json`;
  try {
    const text = await invoke<string>("fetch_url", { url: endpoint });
    const json: { notes?: string } = JSON.parse(text);
    if (json.notes?.startsWith("http")) {
      return json.notes;
    }
  } catch {
    // Ignore
  }
  return null;
}

// ============================================================================
// Resolve Release (Unified)
// ============================================================================

async function resolveRelease(): Promise<Update | ManualUpdate | null> {
  const channel = currentChannel;
  logger.info(`Resolving ${channel} release (source: ${currentSource})...`, "Updater");

  if (isAndroidApp()) {
    return await resolveAndroidRelease();
  }

  // Preview channel: bypass Tauri plugin, fetch preview endpoint directly.
  // The plugin tries endpoints in order and returns the first newer version,
  // so on preview channel it always returns the stable update (listed first),
  // which our filter then discards.
  if (channel === "preview") {
    return await resolvePreviewRelease();
  }

  // Stable channel: use Tauri updater plugin (reads endpoints from tauri.conf.json)
  const update = await check();

  if (!update) {
    logger.info(`No ${channel} update available via Tauri updater`, "Updater");

    if (channelSwitchDetected) {
      logger.info(`Channel switch detected, performing manual ${channel} check...`, "Updater");
      return await resolveChannelSwitchRelease();
    }

    return null;
  }

  if (isPreviewChannel(update.version)) {
    logger.info(`Skipping preview version ${update.version} on stable channel`, "Updater");
    return null;
  }

  return update;
}

// ============================================================================
// Android APK Selection
// ============================================================================

/** Android ABI of the running app, reported by the backend (`get_android_abi`). */
let androidAbi: string | null = null;

/**
 * Resolve the ABI of the installed APK once.
 *
 * Releases are split per ABI (`endprotocol-android-<arch>-release.apk`), so the
 * update check must not just take "an APK" from the release: picking the wrong
 * split means downloading ~30 MB for a foreign architecture and then failing to
 * install. Any failure leaves `androidAbi` null, which makes selection fall back
 * to the old "whatever single APK exists" behaviour.
 */
async function resolveAndroidAbi(): Promise<string | null> {
  if (androidAbi !== null) return androidAbi;
  try {
    androidAbi = await invoke<string | null>("get_android_abi");
  } catch (error) {
    logger.warn("Failed to resolve the Android ABI: " + error, "Updater");
    androidAbi = null;
  }
  return androidAbi;
}

/** Map an `endprotocol-android-<part>-release.apk` asset name to its ABI. */
const ANDROID_APK_ARCHES: Record<string, string> = {
  arm64: "arm64-v8a",
  x86_64: "x86_64",
  armeabi: "armeabi-v7a",
  armv7: "armeabi-v7a",
  x86: "x86",
  universal: "universal",
};

/** `endprotocol-android-<arch>-release.apk` → arch token, or null if not a split. */
function androidApkArch(name: string): string | null {
  const match = /android-([a-z0-9_]+?)(?:-release)?\.apk$/i.exec(name);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Pick the APK in `names` that belongs on `abi`, or null when none does.
 *
 * Correctness matters more than finding *an* APK: installing a foreign-ABI split
 * fails, so a release that ships splits without one for this device must yield
 * "no update" rather than fall back to another architecture. Only releases
 * without any split at all (a single universal APK, i.e. `v0.1.7-pre3` and
 * earlier) may use that universal asset.
 */
function selectAndroidApkName(
  names: string[],
  abi: string | null,
): string | null {
  const splitArchs = names
    .map((name) => androidApkArch(name))
    .filter((arch): arch is string => arch !== null && arch !== "universal");

  if (splitArchs.length > 0) {
    if (!abi) return null;
    return (
      names.find((name) => {
        const arch = androidApkArch(name);
        return arch !== null && ANDROID_APK_ARCHES[arch] === abi;
      }) ?? null
    );
  }

  // No per-ABI splits: a universal APK runs on every ABI.
  return names.find((name) => /universal|all-abi/i.test(name)) ?? null;
}

function getAndroidApkAsset(
  release: GitHubRelease,
  abi: string | null,
): string | null {
  const apkAssets = release.assets.filter((asset) =>
    asset.name.toLowerCase().endsWith(".apk"),
  );
  if (apkAssets.length === 0) return null;

  const chosen = selectAndroidApkName(
    apkAssets.map((asset) => asset.name),
    abi,
  );
  if (!chosen) return null;
  const selected = apkAssets.find((asset) => asset.name === chosen);
  if (!selected) return null;

  try {
    const url = new URL(selected.browser_download_url);
    if (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(`/${REPO_OWNER}/${REPO_NAME}/releases/download/`) &&
      url.pathname.toLowerCase().endsWith(".apk")
    ) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Rewrite a GitHub Release APK URL onto the mirror, when the mirror source is
 * selected.
 *
 * The mirror serves the same release assets under
 * `<base>/<channel>/<tag>/<asset>`, which is exactly what its `latest.json`
 * references for desktop builds — Android was the only platform still pinned to
 * GitHub. Returns the URL untouched when the asset is not a release download of
 * this repository or the source is GitHub.
 */
function mirrorAndroidApkUrl(githubUrl: string, tag: string): string {
  if (currentSource !== "mirror") return githubUrl;
  try {
    const url = new URL(githubUrl);
    const prefix = `/${REPO_OWNER}/${REPO_NAME}/releases/download/${encodeURIComponent(tag)}/`;
    if (!url.pathname.startsWith(prefix)) return githubUrl;
    const asset = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!asset.toLowerCase().endsWith(".apk")) return githubUrl;
    return `${MIRROR_BASE}/${currentChannel}/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
  } catch {
    return githubUrl;
  }
}

/** Shape of the `android` entry in a release `latest.json` (see release.yml). */
interface AndroidManifestEntry {
  url: string;
  assetName?: string;
}

interface AndroidManifest extends AndroidManifestEntry {
  apks?: Record<string, AndroidManifestEntry>;
}

interface ReleaseManifest {
  version?: string;
  pub_date?: string;
  notes?: string;
  android?: AndroidManifest;
}

/**
 * Pick the manifest entry matching `abi`, falling back to the legacy single APK.
 *
 * The mirror's manifest is regenerated by a Worker that may not preserve the
 * nested `apks` map, so the top-level `url` cannot be trusted blindly: on a
 * per-ABI release it points at the arm64 split, which would install-fail on an
 * x86_64 device. Fall back to it only when it is a universal asset.
 */
function pickAndroidManifestEntry(
  android: AndroidManifest | undefined,
  abi: string | null,
): string | null {
  if (!android) return null;

  const candidates: string[] = [];
  if (abi && android.apks?.[abi]?.url) candidates.push(android.apks[abi].url);

  // Names available via `assetName` on the top-level entry and the `apks` map.
  const named = new Map<string, string>();
  for (const entry of [android, ...Object.values(android.apks ?? {})]) {
    if (entry.assetName && entry.url) named.set(entry.assetName, entry.url);
  }
  if (named.size > 0) {
    const chosen = selectAndroidApkName([...named.keys()], abi);
    if (chosen && named.has(chosen)) candidates.push(named.get(chosen)!);
  }

  // Legacy manifests carry a bare `url` with no ABIs at all.
  if (android.url && named.size === 0) candidates.push(android.url);

  return candidates[0] ?? null;
}

/**
 * Resolve an Android update from the mirror manifest.
 *
 * Only the channel manifest is fetched (no GitHub API round-trip), which is the
 * point of selecting the mirror: GitHub API and `objects.githubusercontent.com`
 * are regularly unreachable exactly where the mirror is needed. Returns null on
 * any failure so the caller can fall back to the GitHub path.
 */
async function resolveAndroidReleaseFromMirror(
  localParsed: SemVer,
  localVersion: string,
): Promise<AndroidUpdate | null> {
  const abi = await resolveAndroidAbi();
  const endpoint = `${MIRROR_BASE}/${currentChannel}/latest.json`;

  let manifest: ReleaseManifest;
  try {
    const text = await invoke<string>("fetch_url", { url: endpoint });
    manifest = JSON.parse(text);
  } catch (error) {
    logger.warn(`Mirror manifest unavailable (${endpoint}): ${error}`, "Updater");
    return null;
  }

  // 镜像清单由 Worker 生成，`version` 可能缺失；先归一成字符串，避免
  // `stripVPrefix(undefined)` 在清单异常时把整条更新链路抛崩。
  const remoteVersionRaw = manifest.version ?? "";
  const remoteParsed = remoteVersionRaw ? parseSemVer(remoteVersionRaw) : null;
  if (!remoteParsed) {
    logger.warn("Mirror manifest carries no parseable version", "Updater");
    return null;
  }
  if (currentChannel === "stable" && remoteParsed.prerelease.length > 0) {
    return null;
  }
  if (compareSemVer(remoteParsed, localParsed) <= 0) {
    logger.info(
      `No mirror Android update: ${localVersion} >= ${remoteVersionRaw}`,
      "Updater",
    );
    return null;
  }

  const apkUrl = pickAndroidManifestEntry(manifest.android, abi);
  if (!apkUrl) {
    // A manifest without an `android` entry predates Android releases; fall
    // back to GitHub so an installable build is still found.
    logger.info("Mirror manifest has no Android APK entry", "Updater");
    return null;
  }

  logger.info(
    `Mirror Android update available: ${localVersion} → ${remoteVersionRaw} (ABI ${abi ?? "unknown"})`,
    "Updater",
  );

  return {
    currentVersion: localVersion,
    version: stripVPrefix(remoteVersionRaw),
    date: manifest.pub_date,
    body: manifest.notes,
    apkUrl,
  };
}

async function resolveAndroidRelease(): Promise<AndroidUpdate | null> {
  currentUpdate = null;
  currentUpdateInfo = null;
  manualUpdaterEndpoint = null;

  const localVersion = await getAppVersion();
  const localParsed = parseSemVer(localVersion);
  if (!localParsed) return null;

  if (currentSource === "mirror") {
    const mirrored = await resolveAndroidReleaseFromMirror(localParsed, localVersion);
    if (mirrored) return mirrored;
    logger.info("Falling back to GitHub Releases for the Android update", "Updater");
  }

  const abi = await resolveAndroidAbi();

  const releases = (await fetchGitHubReleases())
    .filter((release) => !release.draft && release.tag_name.startsWith("v"))
    .map((release) => ({
      release,
      version: parseSemVer(stripVPrefix(release.tag_name)),
    }))
    .filter(
      (item): item is { release: GitHubRelease; version: SemVer } =>
        item.version !== null &&
        (currentChannel === "preview"
          ? true
          : item.version.prerelease.length === 0),
    )
    .sort((a, b) => compareSemVer(b.version, a.version));

  // Releases published before the Android pipeline existed (v0.1.6 and older)
  // carry no APK. Picking one of those would resolve to "no update" and the UI
  // would claim the app is up to date even though a newer installable build
  // exists, so only consider releases that actually ship an APK for this ABI.
  const installable = releases
    .map((item) => ({
      ...item,
      apkUrl: getAndroidApkAsset(item.release, abi),
    }))
    .filter(
      (item): item is { release: GitHubRelease; version: SemVer; apkUrl: string } =>
        item.apkUrl !== null,
    );

  if (installable.length === 0) {
    logger.info(
      "No release with an Android APK asset was found",
      "Updater",
    );
    return null;
  }

  // `installable` is sorted newest-first, so the head is the highest version
  // across both channels. On the preview channel that is the right candidate:
  // a release only supersedes a prerelease when it is actually higher, so
  // 0.1.7-pre6 must win over 0.1.6 rather than the other way round.
  const newestStable = installable.find(
    (item) => item.version.prerelease.length === 0,
  );
  const candidate = currentChannel === "preview"
    ? installable[0]
    : newestStable;

  if (!candidate || compareSemVer(candidate.version, localParsed) <= 0) {
    return null;
  }

  const apkUrl = candidate.apkUrl;
  if (!apkUrl) {
    logger.info(
      `Release ${candidate.release.tag_name} has no supported Android APK asset`,
      "Updater",
    );
    return null;
  }

  const tag = candidate.release.tag_name;
  const downloadUrl = mirrorAndroidApkUrl(apkUrl, tag);
  logger.info(
    `Resolved Android APK for ${tag} (ABI ${abi ?? "unknown"}, source ${currentSource}): ${downloadUrl}`,
    "Updater",
  );

  return {
    currentVersion: localVersion,
    version: stripVPrefix(tag),
    date: candidate.release.published_at,
    body: candidate.release.body,
    apkUrl: downloadUrl,
  };
}

/** A resolved update candidate: its manifest endpoint plus what it advertises. */
interface UpdateCandidate {
  endpoint: string;
  version: string;
  parsed: SemVer;
  pubDate?: string;
  notes?: string;
}

async function resolvePreviewRelease(): Promise<Update | ManualUpdate | null> {
  const localVersion = await getAppVersion();
  const localParsed = parseSemVer(localVersion);
  manualUpdaterEndpoint = null;

  if (!localParsed) {
    logger.error(`Failed to parse local version: ${localVersion}`, "Updater");
    return null;
  }

  // Both channels are checked, and the newer one wins. A stable release only
  // supersedes a preview of the same major/minor/patch — it must never shadow a
  // higher prerelease, which is exactly what "stable first, return early" did:
  // on 0.1.0 the mirror's 0.1.6 looked newer than everything and was offered
  // even though 0.1.7-pre6 existed.
  const stableEndpoint = currentSource === "mirror"
    ? `${MIRROR_BASE}/stable/latest.json`
    : `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/latest.json`;

  let previewEndpoint: string | null;
  try {
    previewEndpoint = currentSource === "mirror"
      ? `${MIRROR_BASE}/preview/latest.json`
      : await getLatestPreviewEndpoint();
  } catch (error) {
    logger.warn(`Failed to resolve the preview endpoint: ${error}`, "Updater");
    previewEndpoint = null;
  }

  const [stableManifest, previewManifest] = await Promise.all([
    fetchReleaseManifest(stableEndpoint),
    previewEndpoint
      ? fetchReleaseManifest(previewEndpoint)
      : Promise.resolve(null),
  ]);

  const candidates: UpdateCandidate[] = [];

  if (stableManifest) {
    const parsed = parseSemVer(stableManifest.version);
    if (!parsed) {
      logger.warn(
        `Failed to parse the stable version ${stableManifest.version}`,
        "Updater",
      );
    } else if (parsed.prerelease.length > 0) {
      // A stable endpoint pointing at a prerelease is a mirror publishing bug;
      // the preview endpoint is the one that owns prereleases.
      logger.warn(
        `Stable endpoint advertises the prerelease ${stableManifest.version}; ignoring it`,
        "Updater",
      );
    } else if (compareSemVer(parsed, localParsed) > 0) {
      candidates.push({
        endpoint: stableEndpoint,
        version: stableManifest.version,
        parsed,
        pubDate: stableManifest.pub_date,
        notes: stableManifest.notes,
      });
    }
  }

  if (previewEndpoint && previewManifest) {
    const parsed = parseSemVer(previewManifest.version);
    if (!parsed) {
      logger.warn(
        `Failed to parse the preview version ${previewManifest.version}`,
        "Updater",
      );
    } else if (parsed.prerelease.length === 0) {
      logger.info(
        `Preview endpoint advertises the stable version ${previewManifest.version}`,
        "Updater",
      );
    } else if (compareSemVer(parsed, localParsed) > 0) {
      candidates.push({
        endpoint: previewEndpoint,
        version: previewManifest.version,
        parsed,
        pubDate: previewManifest.pub_date,
        notes: previewManifest.notes,
      });
    }
  }

  if (candidates.length === 0) {
    if (!previewEndpoint) {
      logger.info("No published preview release was found", "Updater");
    } else {
      logger.info(
        `No preview update: nothing on the stable or preview channel is newer than ${localVersion}`,
        "Updater",
      );
    }

    // Channel-switch fallback
    if (channelSwitchDetected) {
      logger.info("Channel switch detected, performing manual preview check...", "Updater");
      return await resolveChannelSwitchRelease();
    }

    return null;
  }

  candidates.sort((a, b) => compareSemVer(b.parsed, a.parsed));
  const winner = candidates[0];

  const endpointUpdate = await invoke<{
    version: string;
    date?: string;
    body?: string;
  } | null>("check_update_endpoint", { endpoint: winner.endpoint });
  if (!endpointUpdate) {
    logger.info(
      `No compatible ${winner.version} update is available for this platform`,
      "Updater",
    );
    return null;
  }

  logger.info(
    `Preview channel update available: ${localVersion} → ${winner.version} (endpoint: ${winner.endpoint})`,
    "Updater",
  );

  manualUpdaterEndpoint = winner.endpoint;

  // Return an Update-like object
  return {
    version: endpointUpdate.version,
    currentVersion: localVersion,
    date: endpointUpdate.date ?? winner.pubDate,
    body: endpointUpdate.body ?? winner.notes,
  };
}

async function resolveChannelSwitchRelease(): Promise<Update | ManualUpdate | null> {
  const localVersion = await getAppVersion();
  const channel = currentChannel;

  let releases: GitHubRelease[];
  try {
    releases = await fetchGitHubReleases();
  } catch (error) {
    logger.error("Failed to fetch GitHub releases: " + error, "Updater");
    return null;
  }

  const filtered = releases.filter((r) => {
    if (r.draft) return false;
    if (!r.tag_name.startsWith("v")) return false;
    return channel === "stable" ? !r.prerelease : r.prerelease;
  });

  if (filtered.length === 0) return null;

  filtered.sort((a, b) => {
    const aVer = parseSemVer(stripVPrefix(a.tag_name));
    const bVer = parseSemVer(stripVPrefix(b.tag_name));
    if (!aVer || !bVer) return 0;
    return compareSemVer(bVer, aVer);
  });

  const latest = filtered[0];
  const remoteVersion = stripVPrefix(latest.tag_name);

  if (!isChannelSwitchUpdateRequired(localVersion, remoteVersion, channel)) {
    return null;
  }

  logger.info(`Channel switch update: ${localVersion} → ${remoteVersion}`, "Updater");

  const latestJsonUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${latest.tag_name}/latest.json`;

  try {
    const response = await fetch(latestJsonUrl);
    if (!response.ok) return null;
    const latestJson: { version: string; pub_date: string; notes: string } = await response.json();
    const endpointUpdate = await invoke<{
      version: string;
      date?: string;
      body?: string;
    } | null>("check_update_endpoint", { endpoint: latestJsonUrl });
    if (!endpointUpdate) return null;

    manualUpdaterEndpoint = latestJsonUrl;
    return {
      version: endpointUpdate.version,
      currentVersion: localVersion,
      date: endpointUpdate.date ?? latestJson.pub_date,
      body: endpointUpdate.body ?? latestJson.notes,
    };
  } catch (error) {
    logger.error("Failed to fetch latest.json for channel switch: " + error, "Updater");
    return null;
  }
}

// ============================================================================
// Changelog Fetching
// ============================================================================

async function fetchChangelog(
  channel: UpdateChannel,
  version: string,
  tag: string,
): Promise<{ changelog: string | null; status: ChangelogStatus }> {
  const cached = getChangelogFromCache(channel, version);
  if (cached !== null) {
    logger.debug(`Changelog cache hit for ${tag}`, "Updater");
    return { changelog: cached, status: "success" };
  }

  logger.info(`Fetching changelog for ${tag}...`, "Updater");

  // Strategy 1: Mirror source - fetch notes URL from mirror's latest.json
  if (currentSource === "mirror") {
    try {
      const notesUrl = await fetchMirrorChangelogUrl(channel);
      if (notesUrl) {
        const text = await invoke<string>("fetch_url", { url: notesUrl });
        if (text.trim().length > 0) {
          logger.info("Changelog fetched from mirror notes URL", "Updater");
          setChangelogCache(channel, version, text);
          return { changelog: text, status: "success" };
        }
      }
    } catch (error) {
      logger.warn("Failed to fetch changelog from mirror: " + error, "Updater");
    }
  }

  // Strategy 2: GitHub Release body
  try {
    const release = await fetchGitHubReleaseByTag(tag);
    if (release?.body && release.body.trim().length > 0) {
      logger.info("Changelog fetched from Release body", "Updater");
      setChangelogCache(channel, version, release.body);
      return { changelog: release.body, status: "success" };
    }
  } catch (error) {
    logger.warn("Failed to fetch changelog from Release body: " + error, "Updater");
  }

  // Strategy 3: CHANGELOG.md release asset
  try {
    const assetUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${tag}/CHANGELOG.md`;
    const response = await fetch(assetUrl);
    if (response.ok) {
      const text = await response.text();
      if (text.trim().length > 0) {
        logger.info("Changelog fetched from Release asset", "Updater");
        setChangelogCache(channel, version, text);
        return { changelog: text, status: "success" };
      }
    }
  } catch (error) {
    logger.warn("Failed to fetch changelog from Release asset: " + error, "Updater");
  }

  logger.warn(`Changelog not available for ${tag}`, "Updater");
  return { changelog: null, status: "failed" };
}

// ============================================================================
// Core Update Logic
// ============================================================================

async function performUpdateCheck(): Promise<UpdateCheckResult> {
  const channel = currentChannel;
  logger.info(`Checking for updates on ${channel} channel (source: ${currentSource})...`, "Updater");

  let update: Update | ManualUpdate | null;

  try {
    update = await resolveRelease();
  } catch (error) {
    logger.error("Update check failed: " + error, "Updater");
    return {
      available: false,
      update: null,
      changelog: null,
      changelogStatus: "unavailable",
      status: "error",
      errorCode: "UPDATE_CHECK_FAILED",
      errorMessage: String(error),
    };
  }

  if (!update) {
    return {
      available: false,
      update: null,
      changelog: null,
      changelogStatus: "unavailable",
      status: "not-available",
    };
  }

  const updateInfo: UpdateInfo = {
    currentVersion: update.currentVersion,
    newVersion: update.version,
    date: update.date,
    body: update.body,
    apkUrl: isAndroidUpdate(update) ? update.apkUrl : undefined,
  };

  currentUpdate = update;
  currentUpdateInfo = updateInfo;

  let changelog: string | null = null;
  let changelogStatus: ChangelogStatus = "loading";

  try {
    const tag = `v${update.version}`;
    const updateChannel = isPreviewChannel(update.version) ? "preview" : "stable";
    const result = await fetchChangelog(updateChannel, update.version, tag);
    changelog = result.changelog;
    changelogStatus = result.status;
  } catch (error) {
    logger.error("Changelog fetch error: " + error, "Updater");
    changelogStatus = "failed";
  }

  return {
    available: true,
    update: updateInfo,
    changelog,
    changelogStatus,
    status: "available",
  };
}

// ============================================================================
// Public API
// ============================================================================

export function getChannel(): UpdateChannel {
  return currentChannel;
}

export function getSource(): UpdateSource {
  return currentSource;
}

export async function setChannel(channel: UpdateChannel): Promise<void> {
  if (currentChannel === channel) return;

  previousChannel = currentChannel;
  channelSwitchDetected = true;

  currentChannel = channel;
  await setConfig("update_channel", channel);

  currentUpdate = null;
  currentUpdateInfo = null;
  manualUpdaterEndpoint = null;
  changelogCache.clear();
  status = "idle";

  remoteState = {
    version: null,
    date: null,
    body: null,
    checked: false,
    loading: false,
    error: false,
    hasUpdate: false,
  };
  emitRemoteChange();

  logger.info(
    `Update channel set to: ${channel} (previous: ${previousChannel})`,
    "Updater",
  );
  emitChange();

  const result = await checkForUpdate();

  if (result.available && result.update) {
    remoteState = {
      version: result.update.newVersion,
      date: result.update.date ?? null,
      body: result.changelog ?? result.update.body ?? null,
      checked: true,
      loading: false,
      error: false,
      hasUpdate: true,
    };
    removeMessagesByTag("app-update");
    addUpdateMessage(result.update);
  } else {
    remoteState = {
      ...remoteState,
      checked: true,
      loading: false,
      hasUpdate: false,
    };
    removeMessagesByTag("app-update");
  }
  emitRemoteChange();

  channelSwitchDetected = false;
  previousChannel = null;
}

export async function initializeChannel(): Promise<void> {
  try {
    const [savedChannel, savedSource] = await Promise.all([
      getConfig<UpdateChannel>("update_channel"),
      getConfig<UpdateSource>("update_source"),
    ]);
    if (savedChannel === "stable" || savedChannel === "preview") {
      currentChannel = savedChannel;
    }
    if (savedSource === "github" || savedSource === "mirror") {
      currentSource = savedSource;
    }
  } catch {
    // Use defaults
  }
  logger.info(`Initialized update channel: ${currentChannel}, source: ${currentSource}`, "Updater");
}

export async function setSource(source: UpdateSource): Promise<void> {
  if (currentSource === source) return;
  currentSource = source;
  await setConfig("update_source", source);

  currentUpdate = null;
  currentUpdateInfo = null;
  manualUpdaterEndpoint = null;
  changelogCache.clear();
  status = "idle";

  remoteState = {
    version: null,
    date: null,
    body: null,
    checked: false,
    loading: false,
    error: false,
    hasUpdate: false,
  };
  emitRemoteChange();

  logger.info(`Update source set to: ${source}`, "Updater");
  emitChange();

  const result = await checkForUpdate();
  if (result.available && result.update) {
    remoteState = {
      version: result.update.newVersion,
      date: result.update.date ?? null,
      body: result.changelog ?? result.update.body ?? null,
      checked: true,
      loading: false,
      error: false,
      hasUpdate: true,
    };
    removeMessagesByTag("app-update");
    addUpdateMessage(result.update);
  } else {
    remoteState = {
      ...remoteState,
      checked: true,
      loading: false,
      hasUpdate: false,
    };
    removeMessagesByTag("app-update");
  }
  emitRemoteChange();
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  // iOS doesn't support in-app package installation; Android uses signed APK assets.
  if (isMobileApp() && !isAndroidApp()) {
    return {
      available: false,
      update: null,
      changelog: null,
      changelogStatus: "idle",
      status: "not-available",
    };
  }
  status = "checking";
  emitChange();

  const result = await performUpdateCheck();

  status = result.status;
  emitChange();

  return result;
}

export function getCurrentUpdate(): Update | ManualUpdate | AndroidUpdate | null {
  return currentUpdate;
}

export function getCurrentUpdateInfo(): UpdateInfo | null {
  return currentUpdateInfo;
}

export function getStatus(): UpdateStatus {
  return status;
}

export function getIsDownloading(): boolean {
  return isDownloading;
}

export function getDownloadProgress(): number {
  return downloadProgress;
}

export function getDownloadTotal(): number {
  return downloadTotal;
}

export async function downloadUpdate(): Promise<void> {
  const update = currentUpdate;
  const updaterEndpoint = manualUpdaterEndpoint;
  if (!update) {
    pushGlobalAlert("warning", "No update available");
    return;
  }

  if (isDownloading) return;
  isDownloading = true;
  downloadProgress = 0;
  downloadTotal = 0;
  lastAndroidApkPath = null;
  addProgressMessage(
    i18n.t("messages.downloading"),
    i18n.t("messages.preparing"),
    false,
    undefined,
    "update-progress",
    0,
  );
  const controller = new AbortController();
  downloadAbortController = controller;
  emitChange();

  try {
    // Reset backend cancellation flag so a previously cancelled download
    // does not block this one.
    await invoke("reset_download_cancel");

    if (isAndroidApp()) {
      if (!isAndroidUpdate(update)) {
        throw new Error("No Android APK is available for this update");
      }

      logger.info("Downloading Android APK update...", "Updater");
      const unlisten = await listen<{ downloaded: number; total: number }>(
        "download-progress",
        (event) => {
          downloadProgress = event.payload.downloaded;
          downloadTotal = event.payload.total;
          updateProgressMessage(
            i18n.t("messages.downloading"),
            downloadTotal > 0
              ? `${downloadProgress} / ${downloadTotal} bytes`
              : undefined,
            downloadTotal > 0
              ? (downloadProgress / downloadTotal) * 100
              : undefined,
          );
          emitChange();
        },
      );
      let apkPath: string;
      try {
        apkPath = await invoke<string>("download_android_apk", {
          url: update.apkUrl,
        });
      } finally {
        unlisten();
      }
      // Keep the downloaded APK so a denied "install unknown apps" permission can be
      // retried without re-downloading the whole package.
      lastAndroidApkPath = apkPath;
      const installResult = await invoke<AndroidInstallResult>(
        "plugin:apk-installer|install_apk",
        { path: apkPath },
      );
      if (installResult.status === "permissionRequired") {
        logger.info(
          "Android package installer permission missing; settings opened",
          "Updater",
        );
        removeProgressMessage();
        pushGlobalAlert("warning", i18n.t("settings.update.android_permission_hint"));
        return;
      }
      logger.info("Android package installer opened", "Updater");
      removeProgressMessage();
    } else if (updaterEndpoint) {
      logger.info("Starting channel update via Tauri updater...", "Updater");
      const unlisten = await listen<{ downloaded: number; total: number }>(
        "download-progress",
        (event) => {
          downloadProgress = event.payload.downloaded;
          downloadTotal = event.payload.total;
          updateProgressMessage(
            i18n.t("messages.downloading"),
            downloadTotal > 0 ? `${downloadProgress} / ${downloadTotal} bytes` : undefined,
            downloadTotal > 0 ? (downloadProgress / downloadTotal) * 100 : undefined,
          );
          emitChange();
        },
      );
      try {
        await invoke("install_update_endpoint", { endpoint: updaterEndpoint });
      } finally {
        unlisten();
      }

      if (!isWindowsPlatform()) {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      }
    } else {
      // Standard Tauri updater plugin download + install
      if (!("download" in update)) {
        throw new Error("No Tauri updater is available for this update");
      }
      logger.info("Starting update download via Tauri updater...", "Updater");
      await update.download((event) => {
        if (event.event === "Started") {
          downloadTotal = event.data.contentLength ?? 0;
          updateProgressMessage(
            i18n.t("messages.downloading"),
            downloadTotal > 0 ? `${downloadTotal} bytes` : undefined,
            0,
          );
        } else if (event.event === "Progress") {
          downloadProgress += event.data.chunkLength;
          const percent = downloadTotal > 0
            ? (downloadProgress / downloadTotal) * 100
            : undefined;
          updateProgressMessage(
            i18n.t("messages.downloading"),
            undefined,
            percent,
          );
        }
        emitChange();
      });
      logger.info("Download complete, installing...", "Updater");
      await update.install();
      logger.info("Install complete, restarting...", "Updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    }
  } catch (error) {
    if (controller.signal.aborted) {
      logger.info("Download cancelled", "Updater");
      removeProgressMessage();
      return;
    }
    logger.error("Update failed: " + error, "Updater");
    removeProgressMessage();
    pushGlobalAlert("danger", "Update failed: " + String(error));
  } finally {
    isDownloading = false;
    downloadAbortController = null;
    downloadProgress = 0;
    downloadTotal = 0;
    manualUpdaterEndpoint = null;
    emitChange();
  }
}

export function cancelDownload(): void {
  if (downloadAbortController) {
    downloadAbortController.abort();
    downloadAbortController = null;
  }

  // Signal the backend to stop the in-progress download as well.
  void invoke("cancel_download");

  isDownloading = false;
  downloadProgress = 0;
  downloadTotal = 0;
  removeProgressMessage();
  emitChange();
  logger.info("Download cancelled by user", "Updater");
}

/** Whether an Android APK from a previous attempt is still on disk and installable. */
export function hasPendingAndroidApk(): boolean {
  return isAndroidApp() && lastAndroidApkPath !== null;
}

/**
 * Re-open Android's package installer for an already downloaded APK.
 *
 * The usual reason this is needed: the first `install_apk` call found the app was not
 * yet allowed to install unknown apps, so the plugin opened the settings screen. Once
 * the user grants it, retrying must not download the APK again.
 */
export async function retryAndroidInstall(): Promise<boolean> {
  if (!isAndroidApp() || !lastAndroidApkPath) return false;

  try {
    const result = await invoke<AndroidInstallResult>(
      "plugin:apk-installer|install_apk",
      { path: lastAndroidApkPath },
    );
    if (result.status === "permissionRequired") {
      pushGlobalAlert(
        "warning",
        i18n.t("settings.update.android_permission_hint"),
      );
      return false;
    }
    logger.info("Android package installer reopened", "Updater");
    return true;
  } catch (error) {
    logger.error("Failed to reopen the Android package installer: " + error, "Updater");
    pushGlobalAlert("danger", "Update failed: " + String(error));
    return false;
  }
}

export function openUpdateDialog(): void {
  window.dispatchEvent(new CustomEvent("openUpdateDialog"));
}

// ============================================================================
// Subscription System
// ============================================================================

function emitChange() {
  listeners.forEach((fn) => fn());
  window.dispatchEvent(new CustomEvent("remoteVersionChanged"));
}

export function subscribeUpdateState(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

export function subscribeDownloadProgress(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

// Legacy API - for backward compatibility
export interface RemoteVersionState {
  version: string | null;
  date: string | null;
  body: string | null;
  checked: boolean;
  loading: boolean;
  error: boolean;
  hasUpdate: boolean;
}

let remoteState: RemoteVersionState = {
  version: null,
  date: null,
  body: null,
  checked: false,
  loading: false,
  error: false,
  hasUpdate: false,
};

let remoteListeners: Array<() => void> = [];

function emitRemoteChange() {
  remoteListeners.forEach((fn) => fn());
  window.dispatchEvent(new CustomEvent("remoteVersionChanged"));
}

export function getRemoteVersion(): RemoteVersionState {
  return remoteState;
}

export function subscribeRemoteVersion(fn: () => void): () => void {
  remoteListeners.push(fn);
  return () => {
    remoteListeners = remoteListeners.filter((l) => l !== fn);
  };
}

export async function fetchRemoteVersion(): Promise<void> {
  if (remoteState.loading) return;

  remoteState = { ...remoteState, loading: true, error: false };
  emitRemoteChange();

  try {
    const result = await checkForUpdate();
    if (result.available && result.update) {
      remoteState = {
        version: result.update.newVersion,
        date: result.update.date ?? null,
        body: result.changelog ?? result.update.body ?? null,
        checked: true,
        loading: false,
        error: false,
        hasUpdate: true,
      };
    } else {
      remoteState = {
        ...remoteState,
        checked: true,
        loading: false,
        hasUpdate: false,
      };
    }
  } catch {
    remoteState = {
      ...remoteState,
      loading: false,
      error: true,
      checked: true,
    };
  }

  emitRemoteChange();
}

export function addUpdateMessage(info: UpdateInfo): AppMessage {
  const dateStr = info.date
    ? new Date(info.date).toLocaleDateString()
    : "";

  const bodyParts: string[] = [];
  bodyParts.push(`v${info.currentVersion} → v${info.newVersion}`);
  if (dateStr) bodyParts.push(dateStr);
  if (info.body) bodyParts.push(info.body);

  return addMessage({
    type: "urgent",
    title: `${i18n.t("settings.update.update_available")}: v${info.newVersion}`,
    body: bodyParts.join(" · "),
    tag: "app-update",
    actions: [
      {
        label: i18n.t("settings.update.update_now"),
        variant: "primary",
        onClick: () => {
          window.dispatchEvent(new CustomEvent("openUpdateDialog"));
        },
      },
    ],
  });
}

export async function checkAndNotify(): Promise<void> {
  await initializeChannel();
  const result = await checkForUpdate();
  if (result.available && result.update) {
    addUpdateMessage(result.update);
  }
}

let progressMessageId: string | null = null;

export function addProgressMessage(title: string, body?: string, dismissable = false, actions?: AppMessage['actions'], tag = "update-progress", progress?: number): void {
  if (progressMessageId) return;
  const msg = addMessage({
    type: "info",
    title,
    body,
    tag,
    dismissable,
    actions,
    progress,
  });
  progressMessageId = msg.id;
}

export function updateProgressMessage(title: string, body?: string, progress?: number): void {
  if (!progressMessageId) return;
  const updates: Partial<Pick<AppMessage, "title" | "body" | "progress">> = { title, body };
  if (typeof progress === "number") updates.progress = progress;
  updateMessage(progressMessageId, updates);
}

export function removeProgressMessage(): void {
  if (!progressMessageId) return;
  removeMessage(progressMessageId);
  progressMessageId = null;
}
