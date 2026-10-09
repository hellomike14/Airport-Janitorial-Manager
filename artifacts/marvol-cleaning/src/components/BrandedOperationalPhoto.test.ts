import { describe, expect, it } from "vitest";
import { watermarkMetrics } from "./BrandedOperationalPhoto";

describe("operational photo watermark placement", () => {
  it("keeps the logo badge inside landscape and portrait images", () => {
    for (const [width, height] of [[1920, 1080], [800, 1200], [48, 48]]) {
      const badge = watermarkMetrics(width, height);
      expect(badge.x).toBeGreaterThanOrEqual(0);
      expect(badge.y).toBeGreaterThanOrEqual(0);
      expect(badge.x + badge.badgeSize).toBeLessThanOrEqual(width);
      expect(badge.y + badge.badgeSize).toBeLessThanOrEqual(height);
    }
  });
});
