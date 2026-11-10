import { z } from "zod";
import { brandSection } from "./copy-prompt";
import { CAMERA_MOVES, type CameraMove, type DirectorPlan, type DirectorPlanRequest } from "./types";

// What a good AI Director script is, shared by every text provider: the prompt, the output schema
// and the clean-up of what comes back (lengths cut, scene count enforced).

const VISUAL_MAX = 400;
const NARRATION_MAX = 200;
const TITLE_MAX = 80;
/** Spoken words a second, so a scene's line fits its length when read aloud. */
const WORDS_PER_SECOND = 2.3;

export const directorPlanSchema = z.object({
  title: z.string(),
  scenes: z.array(z.object({ visual: z.string(), narration: z.string(), camera: z.enum(CAMERA_MOVES) })),
});

export function directorPrompt(request: DirectorPlanRequest) {
  const words = Math.max(4, Math.floor(request.secondsPerScene * WORDS_PER_SECOND));
  return [
    "You are a commercial video director for an e-commerce brand. Turn the idea below into a short video of separate scenes.",
    `Idea: ${request.idea}`,
    `Exactly ${request.scenes} scenes, each ${request.secondsPerScene} seconds, framed ${request.aspectRatio}. Together they tell one story: open with a hook, show the product or offer, end on a clear closing shot.`,
    "For each scene give:",
    "- visual: one or two English sentences describing a single shot for an image and a video model: subject, setting, lighting, mood and what moves. Photorealistic. Keep the same products, people and style from scene to scene. No text, logos or captions in the picture.",
    `- narration: the voice-over line for that scene, at most ${words} words so it fits ${request.secondsPerScene} seconds when spoken. ${
      request.language === "ar" ? "Write it in Modern Standard Arabic as Gulf brands write it, with Western digits." : "Write it in English."
    } Never invent prices, discounts, sizes or claims that the idea doesn't give.`,
    `- camera: one of ${CAMERA_MOVES.join(", ")}.`,
    `title: a short name for the video (at most ${TITLE_MAX} characters) in the narration's language.`,
    request.brand ? brandSection(request.brand) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max).trim();

/** The model's script tidied: lengths cut, exactly `scenes` scenes (or null when it gave too few). */
export function tidyPlan(raw: z.infer<typeof directorPlanSchema>, scenes: number): DirectorPlan | null {
  const kept = raw.scenes
    .map((s) => ({ visual: clean(s.visual, VISUAL_MAX), narration: clean(s.narration, NARRATION_MAX), camera: (CAMERA_MOVES as readonly string[]).includes(s.camera) ? s.camera : ("static" as CameraMove) }))
    .filter((s) => s.visual)
    .slice(0, scenes);
  if (kept.length < scenes) return null;
  return { title: clean(raw.title, TITLE_MAX) || "Untitled video", scenes: kept };
}
