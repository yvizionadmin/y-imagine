// Saved characters (B13), shared by the server and the screens (client-safe).

export const CHARACTER_NAME_MAX = 60;
export const CHARACTER_DESCRIPTION_MAX = 400;
export const CHARACTER_MAX_IMAGES = 3;
export const CHARACTER_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHARACTER_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** Characters one org keeps. */
export const MAX_CHARACTERS_PER_ORG = 50;

/** `upload`: photos of a real person (consent recorded); `generated`: an AI portrait from the description. */
export type CharacterSource = "upload" | "generated";
export type CharacterImage = { assetId: string; mimeType: string };

export type CharacterView = {
  id: string;
  name: string;
  description: string;
  source: CharacterSource;
  images: (CharacterImage & { url: string })[];
  consentedAt: string | null;
  createdBy: string;
  createdAt: string;
  /** The viewer may delete it (its creator, or an admin). */
  canDelete: boolean;
};

/** A character as the AI Director keeps it on a project (it still works if the character is deleted later). */
export type CharacterRef = { id: string; name: string; description: string };
