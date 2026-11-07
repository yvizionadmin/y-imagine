/** What a feed turn needs from a saved result (a HistoryItem). */
export type FeedItem = { id: string; sku: string; createdAt: string; settings: Record<string, string | null> };

const TURN_GAP_MS = 10 * 60 * 1000;

/** The prompt a result was made with: its instructions, notes or described scene. */
export const promptOf = (item: FeedItem) => item.settings.instructions || item.settings.notes || item.settings.customScene || "";

/** Groups consecutive results of one job (same SKU and prompt, minutes apart) into the turns of a results feed. */
export function feedTurns<T extends FeedItem>(items: T[]): T[][] {
  const turns: T[][] = [];
  for (const item of items) {
    const turn = turns.at(-1);
    const last = turn?.at(-1);
    const sameJob =
      last !== undefined &&
      last.sku === item.sku &&
      promptOf(last) === promptOf(item) &&
      Math.abs(Date.parse(item.createdAt) - Date.parse(last.createdAt)) < TURN_GAP_MS;
    if (turn && sameJob) turn.push(item);
    else turns.push([item]);
  }
  return turns;
}
