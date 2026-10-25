import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GlassAlertDialogCompound as GlassAlertDialog,
  GlassButton,
  GlassChip,
  GlassInput,
  GlassRadioGroup,
  GlassSkeleton,
  GlassSwitch,
} from "@/components/ui/glass";
import {
  CheckIcon,
  CloseIcon,
  GlobeIcon,
  LoadingIcon,
} from "@/components/ui/app-icon";
import { SettingsDivider } from "@/components/ui/settings-row";
import { isTauri } from "@tauri-apps/api/core";
import type { ProxyConfig, ProxyType } from "@/utils/proxyService";
import {
  DEFAULT_PROXY_CONFIG,
  DEFAULT_PROXY_PORT,
  autoDetectProxy,
  getProxySettings,
  normalizeProxyConfig,
  readSystemProxy,
  saveProxySettings,
  testProxyConnection,
} from "@/utils/proxyService";
import { logError } from "@/utils/logger";

type Notice = { tone: "success" | "danger" | "info"; text: string };

/** 端口是否合法（1-65535）。 */
function isValidPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** 自动保存防抖间隔（毫秒）。 */
const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * 设置页「网络」分区：自定义代理的完整表单。
 *
 * 所有字段一次性列出并为每个字段标注「是否必填」；只有协议特有的字段
 * （如认证信息）才会随协议切换显隐。协议切换使用单选组。
 */
export function NetworkSettings() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ProxyConfig>(DEFAULT_PROXY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pacUrl, setPacUrl] = useState("");
  const [showEnableWarning, setShowEnableWarning] = useState(false);
  const [dontShowEnableWarning, setDontShowEnableWarning] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const autosaveTimer = useRef<number | null>(null);

  const showNotice = useCallback((next: Notice) => {
    setNotice(next);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getProxySettings().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setConfig(result.value);
      } else {
        logError(`[NetworkSettings] load failed: ${result.error}`, "Settings");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (next: ProxyConfig, options?: { silent?: boolean }) => {
      setSaving(true);
      const result = await saveProxySettings(next);
      setSaving(false);
      if (!result.ok) {
        showNotice({ tone: "danger", text: t("settings.network.proxy_save_failed") });
        logError(`[NetworkSettings] save failed: ${result.error}`, "Settings");
        return false;
      }
      if (!options?.silent) {
        showNotice({ tone: "success", text: t("settings.network.proxy_saved") });
      }
      return true;
    },
    [showNotice, t],
  );

  const patch = useCallback((next: Partial<ProxyConfig>) => {
    setConfig((prev) => ({ ...prev, ...next }));

    // 配置更改后自动保存（防抖），无需手动点保存。
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(async () => {
      const merged = normalizeProxyConfig({ ...config, ...next });
      await persist(merged, { silent: true });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [config, persist]);

  /** 切换协议时若端口仍是上一个协议的默认值，则同步为新协议默认端口。 */
  const handleTypeChange = (type: string) => {
    const nextType = type as ProxyType;
    if (nextType === config.type) return;
    const port =
      config.port === DEFAULT_PROXY_PORT[config.type]
        ? DEFAULT_PROXY_PORT[nextType]
        : config.port;
    patch({ type: nextType, port });
  };

  const handleToggle = async (enabled: boolean) => {
    // 开启前先弹警告：此时不改变 config.enabled，避免遮罩与选项同时出现。
    if (enabled && !dontShowEnableWarning) {
      setShowEnableWarning(true);
      return;
    }

    const next = { ...config, enabled };
    setConfig(next);
    await persist(next, { silent: true });
  };

  const confirmEnable = async () => {
    setShowEnableWarning(false);
    const next = { ...config, enabled: true };
    setConfig(next);
    await persist(next, { silent: true });
  };

  const cancelEnable = () => {
    setShowEnableWarning(false);
    // 取消后保持关闭状态，并同步落盘（若此前已开启过）。
    const next = { ...config, enabled: false };
    setConfig(next);
    void persist(next, { silent: true });
  };

  const handleImportSystem = async () => {
    setImporting(true);
    const result = await readSystemProxy();
    setImporting(false);

    if (!result.ok) {
      showNotice({ tone: "danger", text: t("settings.network.proxy_import_failed") });
      logError(`[NetworkSettings] read system proxy failed: ${result.error}`, "Settings");
      return;
    }

    const info = result.value;
    setPacUrl(info.pac_url);

    if (!info.enabled || !info.host) {
      showNotice({ tone: "info", text: t("settings.network.proxy_import_empty") });
      return;
    }

    const next = normalizeProxyConfig({
      ...config,
      enabled: true,
      type: info.proxy_type,
      host: info.host,
      port: info.port,
      username: info.username || config.username,
      password: info.password || config.password,
    });

    setConfig(next);
    await persist(next, { silent: true });
    showNotice({
      tone: "success",
      text: t("settings.network.proxy_import_success", {
        host: info.host,
        port: info.port,
      }),
    });
    if (info.from_env) {
      setPacUrl("");
    }
  };

  const handleAutoDetect = async () => {
    setAutoDetecting(true);
    const result = await autoDetectProxy();
    setAutoDetecting(false);

    if (!result.ok) {
      showNotice({ tone: "danger", text: t("settings.network.proxy_auto_detect_failed") });
      logError(`[NetworkSettings] auto detect failed: ${result.error}`, "Settings");
      return;
    }

    const next = result.value;
    setConfig(next);
    await persist(next, { silent: true });
    showNotice({
      tone: "success",
      text: t("settings.network.proxy_auto_detected", {
        type: next.type,
        host: next.host,
        port: next.port,
      }),
    });
  };

  const handleTest = async () => {
    if (!config.host.trim()) {
      showNotice({ tone: "danger", text: t("settings.network.proxy_invalid_host") });
      return;
    }
    if (!isValidPort(config.port)) {
      showNotice({ tone: "danger", text: t("settings.network.proxy_invalid_port") });
      return;
    }

    setTesting(true);
    const result = await testProxyConnection(config);
    setTesting(false);

    if (!result.ok) {
      const text = t("settings.network.proxy_test_failed");
      showNotice({ tone: "danger", text: `${text}: ${result.error}` });
      return;
    }

    showNotice({
      tone: "success",
      text: t("settings.network.proxy_test_ok", {
        status: result.value.status,
        ms: result.value.duration_ms,
      }),
    });
  };

  const handleReset = async () => {
    const next = { ...DEFAULT_PROXY_CONFIG, type: config.type, port: DEFAULT_PROXY_PORT[config.type] };
    setConfig(next);
    setPacUrl("");
    await persist(next, { silent: true });
    showNotice({ tone: "success", text: t("settings.network.proxy_saved") });
  };

  const handleSave = async () => {
    if (config.enabled) {
      if (!config.host.trim()) {
        showNotice({ tone: "danger", text: t("settings.network.proxy_invalid_host") });
        return;
      }
      if (!isValidPort(config.port)) {
        showNotice({ tone: "danger", text: t("settings.network.proxy_invalid_port") });
        return;
      }
    }
    await persist(normalizeProxyConfig(config));
  };

  const protocolOptions = useMemo(
    () => [
      { value: "http", label: t("settings.general.proxy_type_http") },
      { value: "socks5", label: t("settings.general.proxy_type_socks5") },
    ],
    [t],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <GlassSkeleton className="h-4 w-28 rounded-lg" />
            <GlassSkeleton className="h-3 w-48 rounded-lg" />
          </div>
          <GlassSkeleton className="h-6 w-12 shrink-0 rounded-full" />
        </div>
        <SettingsDivider />
        <div className="space-y-3">
          <GlassSkeleton className="h-3 w-20 rounded-lg" />
          <GlassSkeleton className="h-10 w-full rounded-xl" />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
          <GlassSkeleton className="h-10 w-full rounded-xl" />
          <GlassSkeleton className="h-10 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        {/* 总开关 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {t("settings.general.proxy_enable")}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {t("settings.general.proxy_enable_desc")}
            </p>
          </div>
          <GlassSwitch isSelected={config.enabled} onValueChange={handleToggle}>
            <GlassSwitch.Control>
              <GlassSwitch.Thumb />
            </GlassSwitch.Control>
          </GlassSwitch>
        </div>

        {/*
          可展开区域：容器始终挂载，用 grid-template-rows 0fr ↔ 1fr 做高度过渡，
          内层 overflow-hidden 负责裁切。上间距也做成 0 ↔ 24px 的过渡，
          这样收起时不会残留空白行。
        */}
        <div
          className="grid transition-all duration-300 ease-in-out"
          style={{
            gridTemplateRows: config.enabled ? "1fr" : "0fr",
            opacity: config.enabled ? 1 : 0,
            pointerEvents: config.enabled ? undefined : "none",
          }}
          aria-hidden={!config.enabled}
        >
          <div className="overflow-hidden">
            <div
              className="space-y-6 transition-[padding] duration-300 ease-in-out"
              style={{ paddingTop: config.enabled ? 24 : 0 }}
            >
              <SettingsDivider />

              {/* 协议 */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {t("settings.general.proxy_protocol")}
                    <span className="ml-1.5 align-middle text-[11px] font-normal text-muted">
                      ({t("settings.general.proxy_protocol_required")})
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {t("settings.general.proxy_protocol_desc")}
                  </p>
                </div>
                <GlassRadioGroup
                  value={config.type}
                  onValueChange={handleTypeChange}
                  isDisabled={saving}
                  aria-label={t("settings.general.proxy_protocol")}
                  className="shrink-0"
                >
                  {protocolOptions.map((option) => (
                    <GlassRadioGroup.Item key={option.value} value={option.value}>
                      {option.label}
                    </GlassRadioGroup.Item>
                  ))}
                </GlassRadioGroup>
              </div>

              <SettingsDivider />

              {/* 主机 + 端口 */}
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-end">
                <Field
                  label={t("settings.general.proxy_host")}
                  badge={t("settings.general.proxy_host_required")}
                  htmlFor="proxy-host"
                >
                  <GlassInput
                    id="proxy-host"
                    value={config.host}
                    placeholder={t("settings.general.proxy_host_placeholder")}
                    autoComplete="off"
                    spellCheck={false}
                    onValueChange={(value) => patch({ host: value })}
                  />
                </Field>
                <Field
                  label={t("settings.general.proxy_port")}
                  badge={t("settings.general.proxy_port_required")}
                  htmlFor="proxy-port"
                >
                  <GlassInput
                    id="proxy-port"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={65535}
                    value={String(config.port)}
                    placeholder={String(DEFAULT_PROXY_PORT[config.type])}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      patch({ port: Number.isNaN(parsed) ? 0 : parsed });
                    }}
                    isInvalid={!isValidPort(config.port)}
                  />
                </Field>
              </div>

              <SettingsDivider />

              {/* 排除主机（直连不走代理） */}
              <Field
                label={t("settings.general.proxy_exclude")}
                badge={t("settings.general.proxy_exclude_optional")}
                htmlFor="proxy-exclude"
              >
                <GlassInput
                  id="proxy-exclude"
                  value={config.exclude ?? ""}
                  placeholder={t("settings.general.proxy_exclude_placeholder")}
                  autoComplete="off"
                  spellCheck={false}
                  onValueChange={(value) => patch({ exclude: value })}
                />
              </Field>

              <SettingsDivider />

              {/* 认证：HTTP 与 SOCKS5 都支持，但文案不同 */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-foreground">
                    {t("settings.general.proxy_auth")}
                  </p>
                  <GlassChip size="sm" color="default">
                    {t("settings.general.proxy_username_optional")}
                  </GlassChip>
                </div>
                <p className="text-sm text-muted">
                  {config.type === "socks5"
                    ? t("settings.general.proxy_auth_socks5_desc")
                    : t("settings.general.proxy_auth_http_desc")}
                </p>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t("settings.general.proxy_username")}
                    badge={t("settings.general.proxy_username_optional")}
                    htmlFor="proxy-username"
                  >
                    <GlassInput
                      id="proxy-username"
                      value={config.username ?? ""}
                      placeholder={t("settings.general.proxy_username_optional")}
                      autoComplete="off"
                      spellCheck={false}
                      onValueChange={(value) => patch({ username: value })}
                    />
                  </Field>
                  <Field
                    label={t("settings.general.proxy_password")}
                    badge={t("settings.general.proxy_password_optional")}
                    htmlFor="proxy-password"
                  >
                    <GlassInput
                      id="proxy-password"
                      type="password"
                      value={config.password ?? ""}
                      placeholder={t("settings.general.proxy_password_optional")}
                      autoComplete="new-password"
                      onValueChange={(value) => patch({ password: value })}
                    />
                  </Field>
                </div>
              </div>

              {/* SOCKS5 专有：远程 DNS 解析（同样用展开动画） */}
              <div
                className="grid transition-all duration-300 ease-in-out"
                style={{
                  gridTemplateRows: config.type === "socks5" ? "1fr" : "0fr",
                  opacity: config.type === "socks5" ? 1 : 0,
                }}
                aria-hidden={config.type !== "socks5"}
              >
                <div className="overflow-hidden">
                  {/* 外层 space-y-6 已负责上间距；这里的分隔线只在展开时可见 */}
                  <div className="space-y-6">
                    <SettingsDivider />
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                          {t("settings.general.proxy_remote_dns")}
                          <GlassChip size="sm" color="primary">
                            {t("settings.general.proxy_socks5_only")}
                          </GlassChip>
                        </p>
                        <p className="mt-0.5 text-sm text-muted">
                          {t("settings.general.proxy_remote_dns_desc")}
                        </p>
                      </div>
                      <GlassSwitch
                        isSelected={Boolean(config.remoteDns)}
                        onValueChange={(value) => patch({ remoteDns: value })}
                        isDisabled={config.type !== "socks5"}
                      >
                        <GlassSwitch.Control>
                          <GlassSwitch.Thumb />
                        </GlassSwitch.Control>
                      </GlassSwitch>
                    </div>
                  </div>
                </div>
              </div>

              <SettingsDivider />

              {/* 系统代理读取 + 自动嗅探 */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {t("settings.general.proxy_import_system")}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {t("settings.general.proxy_import_system_desc")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <GlassButton
                    variant="outline"
                    isDisabled={importing || saving || !isTauri()}
                    onPress={handleImportSystem}
                    className="whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      {importing ? (
                        <LoadingIcon size={16} className="animate-spin" />
                      ) : (
                        <GlobeIcon size={16} />
                      )}
                      {t("settings.general.proxy_import_action")}
                    </span>
                  </GlassButton>
                  <GlassButton
                    variant="outline"
                    isDisabled={autoDetecting || saving || !isTauri()}
                    onPress={handleAutoDetect}
                    className="whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      {autoDetecting ? (
                        <LoadingIcon size={16} className="animate-spin" />
                      ) : (
                        <GlobeIcon size={16} className="rotate-90" />
                      )}
                      {t("settings.general.proxy_auto_detect")}
                    </span>
                  </GlassButton>
                </div>
              </div>

              {/* PAC 提示（淡入；无内容时整块高度归零，不残留间距） */}
              <div
                className="grid transition-all duration-200 ease-in-out"
                style={{
                  gridTemplateRows: pacUrl ? "1fr" : "0fr",
                  opacity: pacUrl ? 1 : 0,
                }}
                aria-hidden={!pacUrl}
              >
                <div className="overflow-hidden">
                  {pacUrl && (
                    <div className="space-y-6">
                      <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                        {t("settings.general.proxy_pac_notice")}
                        <span className="mt-1 block break-all font-mono text-[11px] text-muted">
                          {pacUrl}
                        </span>
                      </p>
                      <SettingsDivider />
                    </div>
                  )}
                </div>
              </div>

              {/* 操作区 + 即时反馈 */}
              <div className="flex flex-wrap items-center gap-2">
                <GlassButton
                  variant="primary"
                  isDisabled={saving}
                  onPress={handleSave}
                  className="whitespace-nowrap"
                >
                  {t("common.save")}
                </GlassButton>
                <GlassButton
                  variant="outline"
                  isDisabled={testing || saving}
                  onPress={handleTest}
                  className="whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-2">
                    {testing && <LoadingIcon size={16} className="animate-spin" />}
                    {testing
                      ? t("settings.general.proxy_testing")
                      : t("settings.general.proxy_test")}
                  </span>
                </GlassButton>
                <GlassButton
                  variant="ghost"
                  isDisabled={saving}
                  onPress={handleReset}
                  className="whitespace-nowrap"
                >
                  {t("common.reset")}
                </GlassButton>

                {notice && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      notice.tone === "success"
                        ? "bg-success/10 text-success"
                        : notice.tone === "danger"
                          ? "bg-danger/10 text-danger"
                          : "bg-default-100 text-muted"
                    }`}
                  >
                    {notice.tone === "success" && <CheckIcon size={14} />}
                    {notice.tone === "danger" && <CloseIcon size={14} />}
                    {notice.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 启用代理警告对话框 */}
      <GlassAlertDialog
        isOpen={showEnableWarning}
        onOpenChange={(open) => {
          if (!open) setShowEnableWarning(false);
        }}
      >
        <GlassAlertDialog.Backdrop>
          <GlassAlertDialog.Container>
            <GlassAlertDialog.Dialog className="relative sm:max-w-[420px]">
              <GlassAlertDialog.CloseTrigger />
              <GlassAlertDialog.Header>
                <GlassAlertDialog.Icon status="warning" />
                <GlassAlertDialog.Heading>
                  {t("settings.network.proxy_enable_warning_title")}
                </GlassAlertDialog.Heading>
              </GlassAlertDialog.Header>
              <GlassAlertDialog.Body>
                <p className="mb-4">
                  {t("settings.network.proxy_enable_warning_body")}
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={dontShowEnableWarning}
                    onChange={(e) => setDontShowEnableWarning(e.target.checked)}
                  />
                  <span className="text-sm text-muted">
                    {t("settings.network.proxy_enable_dont_show")}
                  </span>
                </label>
              </GlassAlertDialog.Body>
              <GlassAlertDialog.Footer>
                <GlassButton
                  variant="tertiary"
                  onPress={cancelEnable}
                  className="whitespace-nowrap"
                >
                  {t("common.cancel")}
                </GlassButton>
                <GlassButton
                  variant="primary"
                  onPress={confirmEnable}
                  className="whitespace-nowrap"
                >
                  {t("common.confirm")}
                </GlassButton>
              </GlassAlertDialog.Footer>
            </GlassAlertDialog.Dialog>
          </GlassAlertDialog.Container>
        </GlassAlertDialog.Backdrop>
      </GlassAlertDialog>
    </>
  );
}

/** 字段外壳：标题 + 必填/可选徽标 + 控件。 */
function Field({
  label,
  badge,
  htmlFor,
  children,
}: {
  label: string;
  badge?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {badge && (
          <span className="text-[11px] font-normal text-muted">({badge})</span>
        )}
      </div>
      {children}
    </div>
  );
}
