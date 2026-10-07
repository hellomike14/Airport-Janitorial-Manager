export type WatchRange = [number, number];

export function mergeWatchRanges(ranges: WatchRange[], duration: number): WatchRange[] {
  const sorted = ranges.map(([a, b]): WatchRange => [Math.max(0, a), Math.min(duration, b)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0]);
  const merged: WatchRange[] = [];
  for (const [start, end] of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && start <= previous[1] + 0.05) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function watchedSeconds(ranges: WatchRange[]) {
  return ranges.reduce((sum, [start, end]) => sum + end - start, 0);
}

export function fullyWatched(ranges: WatchRange[], duration: number) {
  // Browser media timestamps can round at the first/last frame. No internal gaps.
  return ranges.length === 1 && ranges[0][0] <= 0.25 &&
    ranges[0][1] >= duration - 0.25;
}

export function watchInterval(previous: { lastPosition: number; wasPlaying: boolean; updatedAt: Date },
  current: { position: number; seeking: boolean; rate: number }, now: Date): WatchRange | null {
  const elapsed = (now.getTime() - previous.updatedAt.getTime()) / 1000;
  const advance = current.position - previous.lastPosition;
  // Discontinuities and explicit seeks never add coverage. Long gaps do not
  // accumulate unlimited credit, and parallel tabs cannot run separate sessions.
  if (!previous.wasPlaying || current.seeking || advance <= 0 ||
      advance > Math.min(12 * current.rate, elapsed * current.rate + 0.75)) return null;
  return [previous.lastPosition, current.position];
}

// Borrow timing tolerance once, rather than granting it anew on every request.
// A short-lived future clock represents borrowed time that subsequent reports,
// pauses and session resets must repay before earning more coverage.
export function watchCreditClock(previous: Date, interval: WatchRange | null, rate: number, now: Date): Date {
  const creditMs = interval ? (interval[1] - interval[0]) / rate * 1000 : 0;
  return new Date(Math.max(now.getTime(), previous.getTime() + creditMs));
}

export function normalizedSignature(name: string) {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
