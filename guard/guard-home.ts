import path from "node:path";

export function resolveGuardHome(environmentHome: string | undefined, platformHome: string): string | null {
  const candidate = environmentHome === undefined ? platformHome : environmentHome;
  if (!candidate || candidate.includes("\0") || !path.isAbsolute(candidate)) return null;
  const normalized = path.normalize(candidate);
  if (normalized === path.parse(normalized).root) return null;
  return normalized;
}
