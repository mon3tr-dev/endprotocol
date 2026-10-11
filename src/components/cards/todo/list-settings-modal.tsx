import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassButton, GlassInput, GlassSelect, GlassSwitch } from "@/components/ui/glass";
import { MorphIcon } from "morphicons/react";
import { Check, Plus } from "lucide";
import {
  CustomModal,
  CustomModalBody,
  CustomModalFooter,
  CustomModalHeader,
} from "@/components/custom-modal";
import { useTodoLists, updateTodoList } from "@/stores/todoStore";
import { SORT_MODE_OPTIONS, TODO_COLORS, TODO_ICONS } from "@/types/todo";
import type { TodoSortMode } from "@/types/todo";
import { TodoIcon } from "./todo-icon";

const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

function normalizeHexColor(value: string): string {
  return HEX_COLOR_PATTERN.test(value) ? value : "#6366f1";
}

function hexToRgb(value: string): [number, number, number] {
  const hex = normalizeHexColor(value).slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function setRgbChannel(color: string, channel: number, value: string): string {
  const rgb = hexToRgb(color);
  const parsed = Number.parseInt(value, 10);
  rgb[channel] = Number.isFinite(parsed)
    ? Math.max(0, Math.min(255, parsed))
    : 0;
  return `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface ListSettingsModalProps {
  isOpen: boolean;
  listId: string | null;
  onClose: () => void;
  /** 打开时聚焦的分区 */
  focus?: "general" | "sort" | "appearance";
}

export function TodoListSettingsModal({
  isOpen,
  listId,
  onClose,
}: ListSettingsModalProps) {
  const { t } = useTranslation();
  const { lists } = useTodoLists();
  const list = lists.find((l) => l.id === listId) ?? null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [color, setColor] = useState(TODO_COLORS[0]);
  const [customColorDraft, setCustomColorDraft] = useState(TODO_COLORS[0]);
  const [hexDraft, setHexDraft] = useState(TODO_COLORS[0].slice(1));
  const [icon, setIcon] = useState(TODO_ICONS[0]);
  const [sortMode, setSortMode] = useState<TodoSortMode>("manual");
  const [hideCompleted, setHideCompleted] = useState(false);
  const [dailyResetEnabled, setDailyResetEnabled] = useState(false);
  const [dailyResetTime, setDailyResetTime] = useState("00:00");
  const [isCustomColorOpen, setIsCustomColorOpen] = useState(false);

  useEffect(() => {
    if (isOpen && list) {
      setTitle(list.title);
      setDescription(list.description ?? "");
      setGroup(list.group ?? "");
      setColor(list.color ?? TODO_COLORS[0]);
      setCustomColorDraft(list.color ?? TODO_COLORS[0]);
      setHexDraft(normalizeHexColor(list.color ?? TODO_COLORS[0]).slice(1));
      setIcon(list.icon ?? TODO_ICONS[0]);
      setSortMode(list.sortMode);
      setHideCompleted(list.hideCompleted);
      setDailyResetEnabled(list.dailyResetEnabled);
      setDailyResetTime(list.dailyResetTime);
      setIsCustomColorOpen(false);
    }
  }, [isOpen, list]);

  if (!list) return null;

  const handleSave = async () => {
    const resetScheduleChanged =
      dailyResetEnabled !== list.dailyResetEnabled ||
      (dailyResetEnabled && dailyResetTime !== list.dailyResetTime);
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(
      now.getMinutes(),
    ).padStart(2, "0")}`;
    await updateTodoList(list.id, {
      title: title.trim() || list.title,
      description: description.trim() || undefined,
      group: group.trim() || undefined,
      color,
      icon,
      sortMode,
      hideCompleted,
      dailyResetEnabled,
      dailyResetTime,
      lastDailyResetDate:
        dailyResetEnabled && resetScheduleChanged
          ? dailyResetTime <= currentTime
            ? getLocalDateKey(now)
            : undefined
          : list.lastDailyResetDate,
    });
    onClose();
  };

  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="md">
      <CustomModalHeader onClose={onClose}>
        {t("card:todo_list_settings")}
      </CustomModalHeader>
      <CustomModalBody>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex w-9 h-9 shrink-0 items-center justify-center text-primary">
              <TodoIcon icon={icon} size={24} />
            </span>
            <GlassInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("card:todo_list_title")}
            />
          </div>

          <div>
            <label className="text-xs text-muted">
              {t("card:todo_list_description")}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-xl border border-separator bg-field px-3 py-2 text-sm text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              placeholder={t("card:todo_list_description_placeholder")}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("card:todo_list_group")}</span>
            <GlassInput
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={t("card:todo_list_group_placeholder")}
              className="w-40"
              size="sm"
            />
          </div>

          <div>
            <p className="text-sm mb-2">{t("card:todo_color")}</p>
            <div className="flex flex-wrap items-center gap-3">
              {TODO_COLORS.map((preset) => {
                const selected = color.toLowerCase() === preset.toLowerCase();
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setColor(preset)}
                    className={`relative h-9 w-9 rounded-full transition-all duration-200 ${
                      selected
                        ? "scale-110 ring-2 ring-offset-2 ring-offset-background"
                        : "hover:scale-105"
                    }`}
                    style={{
                      backgroundColor: preset,
                      ["--tw-ring-color" as string]: selected ? preset : undefined,
                    }}
                    aria-label={`${t("card:todo_color")}: ${preset}`}
                    aria-pressed={selected}
                    title={preset}
                  >
                    {selected && (
                      <MorphIcon
                        icon={Check}
                        size={18}
                        className="absolute inset-0 m-auto drop-shadow-md"
                        color="white"
                        strokeWidth={2.5}
                      />
                    )}
                  </button>
                );
              })}
              {!TODO_COLORS.some(
                (preset) => preset.toLowerCase() === color.toLowerCase(),
              ) && (
                <button
                  type="button"
                  onClick={() => setColor(color)}
                  className="relative h-9 w-9 scale-110 rounded-full ring-2 ring-offset-2 ring-offset-background"
                  style={{
                    backgroundColor: normalizeHexColor(color),
                    ["--tw-ring-color" as string]: color,
                  }}
                  aria-label={`${t("card:todo_color")}: ${color}`}
                  aria-pressed
                  title={color}
                >
                  <MorphIcon
                    icon={Check}
                    size={18}
                    className="absolute inset-0 m-auto drop-shadow-md"
                    color="white"
                    strokeWidth={2.5}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!isCustomColorOpen) {
                    setCustomColorDraft(color);
                    setHexDraft(normalizeHexColor(color).slice(1));
                  }
                  setIsCustomColorOpen((open) => !open);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-default-300 text-muted transition-all hover:scale-105 hover:border-primary/60 hover:text-primary"
                aria-label={t("card:todo_color_custom")}
                aria-expanded={isCustomColorOpen}
                title={t("card:todo_color_custom")}
              >
                <MorphIcon icon={Plus} size={18} strokeWidth={2} />
              </button>
            </div>
            {isCustomColorOpen && (
              <div className="mt-3 max-w-sm rounded-2xl border border-separator/80 glass-surface-strong p-4 shadow-xl">
                <p className="mb-3 text-sm font-medium text-foreground">
                  {t("card:todo_color_custom")}
                </p>
                <div className="mb-3 flex items-center gap-3">
                  <label
                    className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-xl ring-1 ring-separator shadow-inner"
                    style={{
                      backgroundColor: normalizeHexColor(customColorDraft),
                    }}
                    title={t("card:todo_color_custom")}
                  >
                    <input
                      type="color"
                      value={normalizeHexColor(customColorDraft)}
                      onChange={(event) => {
                        setCustomColorDraft(event.target.value);
                        setHexDraft(event.target.value.slice(1));
                      }}
                      aria-label={t("card:todo_color_custom")}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>
                  <div className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-xl glass-field px-3">
                    <span className="shrink-0 font-mono text-sm text-muted/70">
                      #
                    </span>
                    <input
                      type="text"
                      value={hexDraft.toUpperCase()}
                      onChange={(event) => {
                        const hex = event.target.value
                          .replace(/[^0-9a-f]/gi, "")
                          .slice(0, 6);
                        setHexDraft(hex);
                        if (/^[\da-f]{6}$/i.test(hex)) {
                          setCustomColorDraft(`#${hex}`);
                        }
                      }}
                      onBlur={() =>
                        setHexDraft(normalizeHexColor(customColorDraft).slice(1))
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          /^[\da-f]{6}$/i.test(hexDraft)
                        ) {
                          setCustomColorDraft(`#${hexDraft}`);
                        }
                      }}
                      aria-label="HEX"
                      maxLength={6}
                      className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground focus:outline-none"
                    />
                  </div>
                </div>
                <div className="mb-3 flex items-center gap-2">
                  {hexToRgb(customColorDraft).map((value, channel) => (
                    <label
                      key={channel}
                      className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-xl glass-field px-2"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted/60">
                        {(["R", "G", "B"] as const)[channel]}
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={value}
                        onChange={(event) => {
                          const nextColor = setRgbChannel(
                            customColorDraft,
                            channel,
                            event.target.value,
                          );
                          setCustomColorDraft(nextColor);
                          setHexDraft(nextColor.slice(1));
                        }}
                        aria-label={(["Red", "Green", "Blue"] as const)[channel]}
                        className="min-w-0 w-full bg-transparent font-mono text-sm text-foreground focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <GlassButton
                    size="sm"
                    variant="secondary"
                    className="flex-1"
                    onPress={() => setIsCustomColorOpen(false)}
                  >
                    {t("common.cancel")}
                  </GlassButton>
                  <GlassButton
                    size="sm"
                    variant="primary"
                    className="flex-1"
                    onPress={() => {
                      setColor(normalizeHexColor(customColorDraft));
                      setIsCustomColorOpen(false);
                    }}
                  >
                    {t("common.confirm")}
                  </GlassButton>
                </div>
              </div>
            )}
          </div>

          <div>
            <p className="text-sm mb-2">{t("card:todo_icon")}</p>
            <div className="flex flex-wrap gap-1.5">
              {TODO_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all hover:scale-110 ${
                    icon === i
                      ? "border-primary bg-primary/10"
                      : "border-separator"
                  }`}
                  aria-label={i}
                  aria-pressed={icon === i}
                >
                  <TodoIcon icon={i} size={18} />
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("card:todo_sort_mode")}</span>
            <GlassSelect
              value={sortMode}
              options={SORT_MODE_OPTIONS.map((o) => ({
                value: o.value,
                label: t(`card:${o.labelKey}`),
              }))}
              onChange={(v) => setSortMode(v as TodoSortMode)}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("card:todo_hide_completed")}</span>
            <GlassSwitch isSelected={hideCompleted} onValueChange={setHideCompleted}>
              <GlassSwitch.Control>
                <GlassSwitch.Thumb />
              </GlassSwitch.Control>
            </GlassSwitch>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("card:todo_daily_reset")}</span>
              <GlassSwitch
                isSelected={dailyResetEnabled}
                onValueChange={setDailyResetEnabled}
              >
                <GlassSwitch.Control>
                  <GlassSwitch.Thumb />
                </GlassSwitch.Control>
              </GlassSwitch>
            </div>
            {dailyResetEnabled && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted">
                  {t("card:todo_daily_reset_time")}
                </span>
                <input
                  type="time"
                  value={dailyResetTime}
                  onChange={(event) =>
                    setDailyResetTime(event.target.value || "00:00")
                  }
                  aria-label={t("card:todo_daily_reset_time")}
                  className="h-9 rounded-xl border border-separator bg-field px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )}
            <p className="text-xs text-muted">
              {t("card:todo_daily_reset_description")}
            </p>
          </div>
        </div>
      </CustomModalBody>
      <CustomModalFooter>
        <GlassButton variant="secondary" onPress={onClose}>
          {t("common.cancel")}
        </GlassButton>
        <GlassButton variant="primary" onPress={handleSave}>
          {t("common.save")}
        </GlassButton>
      </CustomModalFooter>
    </CustomModal>
  );
}
