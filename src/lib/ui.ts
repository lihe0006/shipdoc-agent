import type { Status } from "./schemas";

export const STATUS_LABEL: Record<Status, string> = {
  match: "Match",
  minor: "Minor difference",
  mismatch: "Mismatch",
  missing: "Missing",
  single_source: "Single source",
};

export const STATUS_ORDER: Status[] = ["mismatch", "missing", "minor", "match", "single_source"];

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
