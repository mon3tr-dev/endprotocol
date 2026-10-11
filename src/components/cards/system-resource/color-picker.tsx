import { RESOURCE_ACCENT_PRESETS } from "@/types/system-resource";

interface SystemResourceColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label: string;
}

const FALLBACK_COLOR = "#6366f1";
const HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

export function SystemResourceColorPicker({
  value,
  onChange,
  label,
}: SystemResourceColorPickerProps) {
  const color = HEX_COLOR_PATTERN.test(value) ? value : FALLBACK_COLOR;
  const isPresetColor = RESOURCE_ACCENT_PRESETS.includes(color.toLowerCase());

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {RESOURCE_ACCENT_PRESETS.map((preset) => {
        const selected = color.toLowerCase() === preset;
        return (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-label={`${label}: ${preset}`}
            aria-pressed={selected}
            title={preset}
            className={`relative w-7 h-7 rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              selected ? "ring-2 ring-offset-2 ring-offset-background" : ""
            }`}
            style={{
              backgroundColor: preset,
              ["--tw-ring-color" as string]: selected ? preset : undefined,
            }}
          >
            {selected && (
              <svg
                viewBox="0 0 20 20"
                className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden
              >
                <path d="m4 10 4 4 8-8" />
              </svg>
            )}
          </button>
        );
      })}

      <label
        className={`relative flex w-7 h-7 items-center justify-center overflow-hidden rounded-full border border-separator/80 cursor-pointer transition-transform hover:scale-110 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary ${
          !isPresetColor
            ? "ring-2 ring-offset-2 ring-offset-background"
            : "bg-default-100"
        }`}
        style={
          !isPresetColor
            ? { backgroundColor: color, ["--tw-ring-color" as string]: color }
            : undefined
        }
        title={`${label}: ${color}`}
      >
        <input
          type="color"
          value={color}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
        {!isPresetColor ? (
          <svg
            viewBox="0 0 20 20"
            className="w-4 h-4 text-white drop-shadow"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden
          >
            <path d="m4 10 4 4 8-8" />
          </svg>
        ) : (
          <span className="text-sm leading-none text-muted" aria-hidden>
            +
          </span>
        )}
      </label>
    </div>
  );
}
