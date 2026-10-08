import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const tones = {
  info: "border-primary/40 bg-primary/10",
  warn: "border-warn/40 bg-warn/10",
  danger: "border-danger/40 bg-danger/10",
  ok: "border-ok/40 bg-ok/10",
} as const;

export function Alert({
  tone = "info",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: keyof typeof tones }) {
  return (
    <div
      role="alert"
      className={cn("rounded-md border p-3 text-sm", tones[tone], className)}
      {...props}
    />
  );
}
