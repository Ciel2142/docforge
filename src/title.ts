export function extractTitle(
  h1Text: string | null,
  soupTitleText: string | null,
  fallbackStem: string,
): string {
  if (h1Text && h1Text.trim()) return h1Text.trim();
  if (soupTitleText && soupTitleText.trim()) return soupTitleText.trim();
  return fallbackStem;
}
