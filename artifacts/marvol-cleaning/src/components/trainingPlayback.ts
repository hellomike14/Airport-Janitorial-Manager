export function shouldReportTrainingPause({
  currentTime,
  ended,
  seeking,
}: {
  currentTime: number;
  ended: boolean;
  seeking: boolean;
}): boolean {
  if (ended || seeking || !Number.isFinite(currentTime) || currentTime < 0) return false;
  return true;
}

export function finalTrainingPosition(currentTime: number, duration: number): number | null {
  if (Number.isFinite(duration) && duration > 0) return duration;
  if (Number.isFinite(currentTime) && currentTime >= 0) return currentTime;
  return null;
}
