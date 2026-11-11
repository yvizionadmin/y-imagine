import { describe, expect, it } from "vitest";
import { saveProviderKey } from "@/lib/ai/provider-keys";
import { insertConnection } from "@/lib/catalog/connections";
import { insertGeneration } from "@/lib/generations";
import { setupChecklist } from "@/lib/onboarding";
import { saveAsset } from "@/lib/storage/assets";
import { insertInvite } from "@/lib/team/members";
import { makeOrg } from "../helpers";

// U6: Home's first-run checklist follows what the org has really set up.

describe("setupChecklist", () => {
  it("ticks each step as the org connects a key, makes an image, connects a store and invites someone", async () => {
    const { org } = await makeOrg();
    expect((await setupChecklist(org.id)).steps).toEqual({ key: false, image: false, store: false, team: false });

    await saveProviderKey({ orgId: org.id, provider: "openai", key: "sk-test-aaaa1111", models: null, createdBy: "t" });
    const assetId = await saveAsset(org.id, new Uint8Array([1, 2, 3]), "image/png");
    await insertGeneration({ orgId: org.id, mode: "lifestyle", sku: "S", title: "T", assetId, mimeType: "image/png", width: 1, height: 1, settings: {}, provider: "demo", model: "m", createdBy: "t", createdById: null });
    expect((await setupChecklist(org.id)).steps).toEqual({ key: true, image: true, store: false, team: false });

    await insertConnection({ orgId: org.id, type: "demo", name: "Demo", settings: { config: {}, secrets: {} }, createdBy: "t", lastTest: null });
    await insertInvite({ orgId: org.id, email: "new@example.com", role: "editor", department: "", invitedBy: "t" });
    expect((await setupChecklist(org.id)).steps).toEqual({ key: true, image: true, store: true, team: true });

    const other = await makeOrg();
    expect((await setupChecklist(other.org.id)).steps).toEqual({ key: false, image: false, store: false, team: false });
  });
});
