import type { ProviderErrorCode } from "@/lib/ai/errors";
import type { VideoCapabilities } from "@/lib/ai/video-models";
import type { CreditRules } from "@/lib/credits";
import type { PlanId } from "@/lib/plans";

export const MEDIA_MODES = ["image", "video"] as const;
export type MediaMode = (typeof MEDIA_MODES)[number];
/** `?mode=` from the URL; anything else is the image mode. */
export const parseMediaMode = (value: string | null | undefined): MediaMode => (value === "video" ? "video" : "image");

export const PROMPT_MAX = 2000;
export const STUDIO_MAX_IMAGES = 4;
export const STUDIO_MAX_REFERENCES = 2;

export type StudioSetup = {
  plan: PlanId;
  /** Viewers can look but not generate. */
  canCreate: boolean;
  /** The plan includes the Studio and it isn't switched off. */
  imageAllowed: boolean;
  /** Paid plans only. */
  videoAllowed: boolean;
  /** Switched off by the platform (Admin → Controls). */
  videoDisabled: boolean;
  /** Why no video model can run for this org (e.g. no Google key), or null. */
  videoProblem: ProviderErrorCode | null;
  /** What the org's video model supports; the options are built from it. */
  videoCaps: VideoCapabilities;
  /** Readable name of the video model jobs run on now (chosen in Settings → API Keys, else Automatic), or null. */
  videoModel: string | null;
  /** Org admins can change the model in Settings → API Keys. */
  canManageModels: boolean;
  imageCost: number;
  video: CreditRules["video"];
  creditsRemaining: number;
};

export type StudioItem = {
  id: string;
  kind: "image" | "video";
  /** Images are always ok; videos move pending → running → ok | failed. */
  status: "pending" | "running" | "ok" | "failed";
  /** The image or finished video; null while a video is still being made. */
  url: string | null;
  width: number;
  height: number;
  prompt: string;
  aspectRatio: string | null;
  seconds: number | null;
  /** Failure code of a video job. */
  error: string | null;
  createdBy: string;
  createdAt: string;
};
