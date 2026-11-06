import { describe, expect, it } from "vitest";
import { parseRange } from "@/lib/storage/range";

describe("byte ranges for video playback", () => {
  it("reads closed, open-ended and suffix ranges", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual([0, 9]);
    expect(parseRange("bytes=90-", 100)).toEqual([90, 99]);
    expect(parseRange("bytes=-10", 100)).toEqual([90, 99]);
    expect(parseRange("bytes=50-500", 100)).toEqual([50, 99]);
  });

  it("refuses ranges it can't serve", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=9-3", 100)).toBe("invalid");
    expect(parseRange("bytes=-", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-9", 100)).toBe("invalid");
  });
});
