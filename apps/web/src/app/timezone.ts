let current: string | null = null;

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function setUserTimezone(tz: string | null) {
  current = tz;
}

export function currentTimezone(): string {
  return current ?? browserTimezone();
}
