"use client";

import type { ReactNode } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 " +
  "shadow-sm outline-none placeholder:text-slate-400 " +
  "focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10";

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1 flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium text-slate-700">{children}</span>
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </span>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "url" | "numeric";
  /** Draws attention to a value the card scanner just filled in. */
  highlighted?: boolean;
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  autoComplete = "off",
  inputMode,
  highlighted,
}: FieldProps) {
  return (
    <label className="block">
      <Label hint={hint}>{label}</Label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className={`${INPUT_CLASS} ${highlighted ? "border-emerald-400 bg-emerald-50/60" : ""}`}
      />
    </label>
  );
}

interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  hint?: string;
}

export function TextArea({ label, value, onChange, rows = 4, placeholder, hint }: TextAreaProps) {
  return (
    <label className="block">
      <Label hint={hint}>{label}</Label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={`${INPUT_CLASS} resize-y leading-relaxed`}
      />
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  children,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <Label hint={hint}>{label}</Label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={INPUT_CLASS}
      >
        {children}
      </select>
    </label>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
  secondary:
    "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-200/70",
  danger: "bg-white text-red-600 border border-red-200 hover:bg-red-50",
};

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
  className = "",
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  full?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm
        font-semibold shadow-sm transition-colors disabled:cursor-not-allowed
        ${VARIANTS[variant]} ${full ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">{children}</h2>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`h-4 w-4 animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

export function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: "error" | "info" | "success";
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${tones[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="flex-1">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 font-bold opacity-60 hover:opacity-100"
          aria-label="Dismiss"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
