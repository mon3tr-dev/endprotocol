import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import i18n from "@/i18n";
import { addMessage, updateMessage, removeMessage, removeMessagesByTag, type AppMessage } from "./messageStore";
import { pushGlobalAlert } from "@/components/ui/global-alert";
import { getConfig, setConfig } from "./configService";
import logger from "./logger";
import { isWindowsPlatform } from "./platform";

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
}

export interface ManualUpdate {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
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

const REPO_OWNER = "soldiereleven";
const REPO_NAME = "endprotocol";
const GITHUB_API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const MIRROR_BASE = "https://updates.msk-network.cn";
const CHANGELOG_CACHE_TTL = 30 * 1000;
const CHANGELOG_CACHE_KEY_PREFIX = "changelog_cache_";

// ============================================================================
// State
// ============================================================================

let currentUpdate: Update | ManualUpdate | null = null;
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

async function resolvePreviewRelease(): Promise<Update | ManualUpdate | null> {
  const { getVersion } = await import("@tauri-apps/api/app");
  const localVersion = await getVersion();
  const localParsed = parseSemVer(localVersion);
  manualUpdaterEndpoint = null;

  if (!localParsed) {
    logger.error(`Failed to parse local version: ${localVersion}`, "Updater");
    return null;
  }

  // Stable releases also supersede previews with the same major/minor/patch.
  const stableEndpoint = currentSource === "mirror"
    ? `${MIRROR_BASE}/stable/latest.json`
    : `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/latest.json`;
  try {
    const text = await invoke<string>("fetch_url", { url: stableEndpoint });
    const stableJson: {
      version: string;
      pub_date?: string;
      notes?: string;
    } = JSON.parse(text);
    const stableVersion = parseSemVer(stableJson.version);

    if (
      stableVersion &&
      stableVersion.prerelease.length === 0 &&
      compareSemVer(stableVersion, localParsed) > 0
    ) {
      const stableUpdate = await invoke<{
        version: string;
        date?: string;
        body?: string;
      } | null>("check_update_endpoint", { endpoint: stableEndpoint });
      if (stableUpdate) {
        logger.info(
          `Stable update available on preview channel: ${localVersion} → ${stableJson.version}`,
          "Updater",
        );
        manualUpdaterEndpoint = stableEndpoint;
        return {
          version: stableUpdate.version,
          currentVersion: localVersion,
          date: stableUpdate.date ?? stableJson.pub_date,
          body: stableUpdate.body ?? stableJson.notes,
        };
      }
    }
  } catch (error) {
    logger.info(
      `Stable release check failed on preview channel: ${error}`,
      "Updater",
    );
  }

  // Determine preview endpoint based on source
  const endpoint = currentSource === "mirror"
    ? `${MIRROR_BASE}/preview/latest.json`
    : await getLatestPreviewEndpoint();

  if (!endpoint) {
    logger.info("No published preview release was found", "Updater");
    return null;
  }

  logger.info(`Fetching preview endpoint: ${endpoint}`, "Updater");

  let latestJson: {
    version: string;
    pub_date?: string;
    notes?: string;
  };

  try {
    const text = await invoke<string>("fetch_url", { url: endpoint });
    latestJson = JSON.parse(text);
  } catch (error) {
    logger.error("Failed to fetch preview endpoint: " + error, "Updater");

    // Channel-switch fallback
    if (channelSwitchDetected) {
      logger.info("Channel switch detected, performing manual preview check...", "Updater");
      return await resolveChannelSwitchRelease();
    }

    return null;
  }

  const remoteVersion = latestJson.version;
  if (!remoteVersion) {
    logger.error("Preview endpoint returned no version", "Updater");
    return null;
  }

  // Must be a prerelease version
  if (!isPreviewChannel(remoteVersion)) {
    logger.info(`Remote version ${remoteVersion} is not a prerelease, skipping`, "Updater");
    return null;
  }

  // Compare versions
  const remoteParsed = parseSemVer(remoteVersion);
  if (!remoteParsed) {
    logger.error(`Failed to parse remote version: ${remoteVersion}`, "Updater");
    return null;
  }

  if (compareSemVer(remoteParsed, localParsed) <= 0) {
    logger.info(`No preview update: ${localVersion} >= ${remoteVersion}`, "Updater");
    return null;
  }

  const endpointUpdate = await invoke<{
    version: string;
    date?: string;
    body?: string;
  } | null>("check_update_endpoint", { endpoint });
  if (!endpointUpdate) {
    logger.info(
      `No compatible ${remoteVersion} update is available for this platform`,
      "Updater",
    );
    return null;
  }

  logger.info(`Preview update available: ${localVersion} → ${remoteVersion}`, "Updater");

  manualUpdaterEndpoint = endpoint;

  // Return an Update-like object
  return {
    version: endpointUpdate.version,
    currentVersion: localVersion,
    date: endpointUpdate.date ?? latestJson.pub_date,
    body: endpointUpdate.body ?? latestJson.notes,
  };
}

async function resolveChannelSwitchRelease(): Promise<Update | ManualUpdate | null> {
  const { getVersion } = await import("@tauri-apps/api/app");
  const localVersion = await getVersion();
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

  let update: Update | null;

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
  status = "checking";
  emitChange();

  const result = await performUpdateCheck();

  status = result.status;
  emitChange();

  return result;
}

export function getCurrentUpdate(): Update | ManualUpdate | null {
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
    if (updaterEndpoint) {
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

  isDownloading = false;
  downloadProgress = 0;
  downloadTotal = 0;
  removeProgressMessage();
  emitChange();
  logger.info("Download cancelled by user", "Updater");
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
