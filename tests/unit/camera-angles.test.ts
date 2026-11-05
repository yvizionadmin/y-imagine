import { describe, expect, it } from "vitest";
import { anglePrompt, CAMERA_ANGLES, formatDimensions, isCameraAngle, SHOT_SET_ANGLES, toggleAngle } from "@/lib/camera-angles";

describe("camera angles", () => {
  it("Auto stands alone and an empty pick falls back to it", () => {
    expect(toggleAngle(["auto"], "front")).toEqual(["front"]);
    expect(toggleAngle(["front", "left90"], "auto")).toEqual(["auto"]);
    expect(toggleAngle(["front"], "front")).toEqual(["auto"]);
    // Picks keep the grid's order, not the click order.
    expect(toggleAngle(["human"], "front")).toEqual(["front", "human"]);
  });

  it("every angle but Auto adds a prompt line", () => {
    expect(anglePrompt("auto")).toBe("");
    expect(anglePrompt(null)).toBe("");
    for (const angle of CAMERA_ANGLES.filter((a) => a !== "auto")) expect(anglePrompt(angle)).not.toBe("");
    expect(Object.values(SHOT_SET_ANGLES).flat().every(isCameraAngle)).toBe(true);
    expect(isCameraAngle("sideways")).toBe(false);
  });

  it("formats only the dimensions given", () => {
    expect(formatDimensions({ w: "220", h: " 95 ", d: "85" })).toBe("220 W × 95 H × 85 D cm");
    expect(formatDimensions({ w: "", h: "120", d: "" })).toBe("120 H cm");
    expect(formatDimensions({ w: "", h: "", d: "" })).toBe("");
  });
});
