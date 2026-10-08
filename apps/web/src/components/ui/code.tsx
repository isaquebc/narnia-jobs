import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { CopyButton } from "./copy-button";

export function Code({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]", className)}
      {...props}
    />
  );
}

export function CommandLine({ command }: { command: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2">
      <code className="font-mono text-sm">{command}</code>
      <CopyButton text={command} />
    </div>
  );
}
