import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The console's structural primitive.
 *
 * Every surface in the app is a panel with an optional header, an action slot
 * and a body. Having one component means headers, padding and borders stay
 * identical across a dozen screens — and that when the density needs to
 * change, it changes in one file rather than in forty.
 */

export interface PanelProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** Removes body padding, for tables and maps that bleed to the edge. */
  readonly flush?: boolean;
  readonly as?: "section" | "div" | "article" | "aside";
}

export function Panel({ children, className, flush, as = "section" }: PanelProps) {
  const Component = as;
  return (
    <Component
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {flush ? children : <div className="flex min-h-0 flex-col gap-4 p-4">{children}</div>}
    </Component>
  );
}

export interface PanelHeaderProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Right-aligned controls: filters, range pickers, overflow menus. */
  readonly actions?: ReactNode;
  readonly icon?: ReactNode;
  readonly className?: string;
  /** Renders the title as an `h2` by default; override for heading order. */
  readonly headingLevel?: 2 | 3 | 4;
}

export function PanelHeader({
  title,
  description,
  actions,
  icon,
  className,
  headingLevel = 2,
}: PanelHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <Heading className="truncate text-sm font-semibold tracking-tight">
            {title}
          </Heading>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export interface PanelBodyProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly flush?: boolean;
}

export function PanelBody({ children, className, flush }: PanelBodyProps) {
  return (
    <div className={cn("min-h-0 flex-1", flush ? undefined : "p-4", className)}>
      {children}
    </div>
  );
}

export interface PanelFooterProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function PanelFooter({ children, className }: PanelFooterProps) {
  return (
    <footer
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {children}
    </footer>
  );
}

export interface SectionHeadingProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/** The small uppercase label used above groups of fields and stats. */
export function SectionHeading({ children, className }: SectionHeadingProps) {
  return <p className={cn("ops-label", className)}>{children}</p>;
}
