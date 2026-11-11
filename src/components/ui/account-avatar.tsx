import { Img } from "@/utils/imageLoader";
import clsx from "clsx";

interface AccountAvatarProps {
  src?: string;
  alt: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<AccountAvatarProps["size"]>, string> = {
  xs: "w-8 h-8 text-xs",
  sm: "w-10 h-10 text-sm",
  md: "w-12 h-12 text-base",
  lg: "w-16 h-16 text-2xl",
  xl: "w-20 h-20 text-3xl",
};

export function AccountAvatar({
  src,
  alt,
  size = "md",
  className,
}: AccountAvatarProps) {
  const fallbackLetter = alt.charAt(0).toUpperCase();

  return (
    <div
      className={clsx(
        "relative flex-shrink-0 rounded-lg flex items-center justify-center font-bold text-primary-text overflow-hidden",
        SIZE_CLASS[size],
        className,
      )}
    >
      {src ? (
        <Img
          src={src}
          alt={alt}
          className="w-full h-full avatar-feather"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            img.style.display = "none";
            const parent = img.parentElement;
            if (parent) parent.textContent = fallbackLetter;
          }}
        />
      ) : (
        fallbackLetter
      )}
    </div>
  );
}
