/**
 * Normalizes a business_name + town pair into a fallback merge key,
 * used only when a lead has no phone number.
 *
 * Returns null when the name is empty or literally "Unknown"
 * (case-insensitive), since that value carries no identifying signal.
 */
export function normalizeBusinessKey(
  name: string | null | undefined,
  town: string | null | undefined
): string | null {
  if (!name) return null;

  const cleanName = name.trim().toLowerCase().replace(/\s+/g, " ");
  const cleanTown = (town ?? "").trim().toLowerCase().replace(/\s+/g, " ");

  if (!cleanName || cleanName === "unknown") {
    return null;
  }

  return `${cleanName}|${cleanTown}`;
}
