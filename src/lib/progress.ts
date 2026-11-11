/** How far an estimated progress bar fills after `seconds`: eases toward 90% over a typical job's length, never claiming done. */
export function estimatedProgress(seconds: number, typicalSeconds: number) {
  return Math.round(90 * (1 - Math.exp(-Math.max(0, seconds) / Math.max(1, typicalSeconds))));
}
