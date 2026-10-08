import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Tabs({
  value,
  onValueChange,
  items,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  items: Array<{ value: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List className="mb-4 inline-flex rounded-md bg-muted p-1">
        {items.map((it) => (
          <RadixTabs.Trigger
            key={it.value}
            value={it.value}
            className={cn(
              "rounded px-3 py-1.5 text-sm data-[state=active]:bg-card data-[state=active]:shadow",
            )}
          >
            {it.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export const TabPanel = RadixTabs.Content;
