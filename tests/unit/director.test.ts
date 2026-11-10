import { describe, expect, it } from "vitest";
import { directorPrompt, tidyPlan } from "@/lib/ai/director-prompt";
import { videoCapabilities } from "@/lib/ai/video-models";
import { DEFAULT_CREDIT_RULES } from "@/lib/credits";
import { DEFAULT_DIRECTOR_SETTINGS, directorEstimate, directorOptions, directorSettingsSchema } from "@/lib/director/limits";
import { estimate } from "@/features/director/components/director-form";

describe("AI Director", () => {
  it("asks for the exact scenes, timed narration in the chosen language, and no invented claims", () => {
    const prompt = directorPrompt({ idea: "Oak chair launch", scenes: 4, secondsPerScene: 6, aspectRatio: "9:16", language: "ar", brand: null });
    expect(prompt).toContain("Idea: Oak chair launch");
    expect(prompt).toContain("Exactly 4 scenes, each 6 seconds, framed 9:16");
    expect(prompt).toContain("at most 13 words");
    expect(prompt).toContain("Modern Standard Arabic");
    expect(prompt).toContain("Never invent prices");
    expect(prompt).toContain("No text, logos or captions");
  });

  it("tidies the script: lengths cut, scene count enforced, unknown camera moves made static", () => {
    const scene = (i: number) => ({ visual: `  Shot ${i}  with   spaces `, narration: "x".repeat(300), camera: "orbit" as const });
    const plan = tidyPlan({ title: "  A".padEnd(120, "b"), scenes: [scene(1), scene(2), scene(3)] }, 2);
    expect(plan?.scenes).toHaveLength(2);
    expect(plan?.scenes[0].visual).toBe("Shot 1 with spaces");
    expect(plan?.scenes[0].narration).toHaveLength(200);
    expect(plan?.title.length).toBeLessThanOrEqual(80);
    expect(tidyPlan({ title: "", scenes: [scene(1)] }, 2)).toBeNull();
    expect(tidyPlan({ title: "", scenes: [scene(1), { ...scene(2), camera: "dolly" as never }] }, 2)?.scenes[1].camera).toBe("static");
    expect(tidyPlan({ title: " ", scenes: [scene(1), scene(2)] }, 2)?.title).toBe("Untitled video");
  });

  it("offers only what both the video model and the editor can do", () => {
    expect(directorOptions(videoCapabilities("gemini-omni-1.2-flash"))).toEqual({ aspectRatios: ["9:16", "16:9"], durations: [4, 6, 8, 10, 15], resolutions: ["720p", "1080p"], startFrame: true });
    expect(directorOptions(videoCapabilities("kling-3.0")).aspectRatios).toEqual(["9:16", "1:1", "16:9"]);
    expect(directorOptions(videoCapabilities("dreamina-seedance-2-5-260628")).durations).toEqual([4, 5, 8, 10, 12, 15, 20, 30]);
  });

  it("estimates the same total on the screen as the server checks", () => {
    const settings = { ...DEFAULT_DIRECTOR_SETTINGS, scenes: 4, seconds: 6, resolution: "1080p" as const };
    const server = directorEstimate(DEFAULT_CREDIT_RULES, settings);
    // 1 script + 4 images + 4 × (2 × 6 s × 2 for 1080p) + 1 voice.
    expect(server).toEqual({ script: 1, images: 4, videos: 96, voice: 1, total: 102 });
    const pricing = { director: 1, create: 1, voice: 1, video: DEFAULT_CREDIT_RULES.video };
    expect(estimate(pricing, settings)).toEqual(server);
    expect(estimate(pricing, { ...settings, voiceOver: false }).total).toBe(101);
  });

  it("checks settings", () => {
    expect(directorSettingsSchema.safeParse(DEFAULT_DIRECTOR_SETTINGS).success).toBe(true);
    expect(directorSettingsSchema.safeParse({ ...DEFAULT_DIRECTOR_SETTINGS, scenes: 7 }).success).toBe(false);
    expect(directorSettingsSchema.safeParse({ ...DEFAULT_DIRECTOR_SETTINGS, aspectRatio: "4:3" }).success).toBe(false);
    expect(directorSettingsSchema.safeParse({ ...DEFAULT_DIRECTOR_SETTINGS, resolution: "360p" }).success).toBe(false);
  });
});
