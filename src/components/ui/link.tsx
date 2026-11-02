import { cn } from "@/lib/utils";

export interface GlassLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {}

function Link({ className, children, ...rest }: GlassLinkProps) {
  return (
    <a
      className={cn(
        "inline-flex items-center text-foreground",
        "[transition:transform_var(--lg-dur-fast)_var(--lg-ease-standard),color_var(--lg-dur-fast)_var(--lg-ease-standard)]",
        "hover:text-primary-text hover:-translate-y-px",
        "active:translate-y-0",
        className,
      )}
      {...rest}
    >
      {children}
    </a>
  );
}

const GlassLink = Link;

export { Link, GlassLink };
