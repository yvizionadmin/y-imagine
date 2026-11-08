import { describe, expect, it } from "vitest";
import { LENS_PRESETS, LIGHTING_PRESETS, type VideoRequest } from "@/lib/ai/types";
import { videoCapabilities } from "@/lib/ai/video-models";
import { videoPrompt } from "@/lib/ai/video-prompt";

// Cinema presets (roadmap B2): direction in the prompt, unless the model has its own setting.

const request = (over: Partial<VideoRequest> = {}) =>
  ({ prompt: "A linen dress on a hanger", camera: "pan", motion: "low", lens: "auto", lighting: "auto", startFrame: null, ...over }) as Parameters<typeof videoPrompt>[0];

describe("videoPrompt", () => {
  it("adds nothing for Auto", () => {
    const text = videoPrompt(request());
    expect(text).toContain("A linen dress");
    expect(text).toContain("Camera:");
    expect(text).not.toContain("Lens:");
    expect(text).not.toContain("Lighting:");
    expect(text).not.toContain("undefined");
  });

  it("describes every lens and lighting preset", () => {
    for (const lens of LENS_PRESETS.filter((l) => l !== "auto")) {
      expect(videoPrompt(request({ lens })), lens).toMatch(/Lens: \S+/);
      expect(videoPrompt(request({ lens })), lens).not.toContain("undefined");
    }
    for (const lighting of LIGHTING_PRESETS.filter((l) => l !== "auto")) {
      expect(videoPrompt(request({ lighting })), lighting).toMatch(/Lighting: \S+/);
      expect(videoPrompt(request({ lighting })), lighting).not.toContain("undefined");
    }
  });

  it("leaves the camera out when the model sets it itself, and keeps the rest", () => {
    const text = videoPrompt(request({ camera: "static", lens: "macro" }), { nativeCamera: true });
    expect(text).not.toContain("Camera:");
    expect(text).toContain("Motion:");
    expect(text).toContain("Lens: Macro");
  });

  it("stays within Kling's prompt limit at the Studio's longest prompt", () => {
    const text = videoPrompt(request({ prompt: "x".repeat(2000), lens: "telephoto", lighting: "dramatic", camera: "tracking" }));
    expect(text.length).toBeLessThanOrEqual(3072);
  });
});

describe("native camera settings", () => {
  it("only Seedance has one, and only for a still camera", () => {
    expect(videoCapabilities("dreamina-seedance-2-5-260628").nativeCamera).toEqual(["static"]);
    expect(videoCapabilities("kling-3.0").nativeCamera).toEqual([]);
    expect(videoCapabilities("gemini-omni-1.2-flash").nativeCamera).toEqual([]);
  });
});
