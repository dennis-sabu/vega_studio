"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IdeButtonVariant = "ghost" | "subtle" | "accent" | "danger";
export type IdeButtonSize = "xs" | "sm" | "md";

interface IdeActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IdeButtonVariant;
  size?: IdeButtonSize;
  active?: boolean;
}

const VARIANT_CLASSES: Record<IdeButtonVariant, string> = {
  ghost:
    "border border-transparent bg-transparent text-[#E4E4E7] hover:bg-[#2A2A2D] hover:text-[#F4F4F5]",
  subtle:
    "border border-[#2E2E32] bg-[#242427] text-[#F4F4F5] hover:border-[#3F3F46] hover:bg-[#2E2E32] hover:text-[#FFFFFF]",
  accent:
    "border border-[#7AA2FF]/45 bg-[#7AA2FF]/16 text-[#F4F4F5] hover:border-[#7AA2FF]/70 hover:bg-[#7AA2FF]/26 hover:text-white",
  danger:
    "border border-red-400/40 bg-red-500/14 text-red-200 hover:border-red-400/65 hover:bg-red-500/24 hover:text-white",
};

const SIZE_CLASSES: Record<IdeButtonSize, string> = {
  xs: "h-6 px-2 text-[11px] gap-1 rounded-[5px]",
  sm: "h-7 px-2.5 text-[11.5px] gap-1.5 rounded-[6px]",
  md: "h-8 px-3 text-[12px] gap-1.5 rounded-[6px]",
};

export function IdeActionButton({
  variant = "subtle",
  size = "sm",
  active = false,
  className = "",
  type = "button",
  children,
  ...props
}: IdeActionButtonProps) {
  const activeStyle = active
    ? "border-[#7AA2FF]/65 bg-[#7AA2FF]/22 text-[#F4F4F5]"
    : VARIANT_CLASSES[variant];

  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center font-medium transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7AA2FF] disabled:pointer-events-none disabled:opacity-50 ${SIZE_CLASSES[size]} ${activeStyle} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({
  title,
  subtitle,
  leading,
  actions,
  className = "",
}: PanelHeaderProps) {
  return (
    <div
      className={`flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-[#2B2B2E] bg-[#181818] px-3 py-1.5 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-[#F4F4F5]">
            {title}
          </div>
          {subtitle ? (
            <div className="truncate text-[11px] text-[#B4B4BC]">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </div>
  );
}

interface IdeEmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function IdeEmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = "",
}: IdeEmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? "px-3 py-5" : "px-5 py-8"
      } ${className}`}
    >
      {icon ? (
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#2E2E32] bg-[#242427] text-[#7AA2FF]">
          {icon}
        </div>
      ) : null}
      <p className="text-[12.5px] font-medium text-[#F4F4F5]">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-[11.5px] leading-relaxed text-[#B4B4BC]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
