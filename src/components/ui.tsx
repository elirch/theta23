"use client";

import { X } from "lucide-react";
import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { MilestoneStatus } from "@/lib/schedule";
import type { FieldError } from "@/lib/validation";
import { STATUS_META } from "./status";

export function StatusBadge({ status, className = "" }: { status: MilestoneStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider ${meta.text} ${meta.border} ${meta.bg} ${className}`}
    >
      {meta.label}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "border-accent/60 bg-accent/15 text-accent hover:bg-accent/25",
  secondary: "border-line bg-raised text-ink hover:border-faint",
  ghost: "border-transparent text-muted hover:text-ink hover:bg-raised",
  danger: "border-miss/50 bg-miss/10 text-miss hover:bg-miss/20",
};

export function Button({
  variant = "secondary", className = "", children, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none";

export function Field({
  label, error, hint, children,
}: { label: string; error?: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-[11px] text-faint">{hint}</p>}
      {error && <p className="text-[11px] text-miss">{error}</p>}
    </div>
  );
}

export function errorFor(errors: FieldError[] | undefined, field: string): string | undefined {
  return errors?.find((e) => e.field === field)?.message;
}

export function Modal({
  title, onClose, children, footer, wide = false,
}: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-xl border border-line bg-panel shadow-2xl sm:rounded-xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:bg-raised hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-md border border-miss/40 bg-miss/10 px-3 py-2 text-xs text-miss">{children}</p>;
}
