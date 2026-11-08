import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeViewAs, encodeViewAs } from "@/lib/auth/view-as";

describe("view-as token", () => {
  const later = Date.now() + 60_000;

  it("holds the org and expiry for the admin it was issued to", () => {
    expect(decodeViewAs(encodeViewAs("admin", "org-1", later), "admin")).toEqual({ orgId: "org-1", expiresAt: new Date(later).toISOString() });
  });

  it("means nothing to another user", () => {
    expect(decodeViewAs(encodeViewAs("admin", "org-1", later), "someone-else")).toBeNull();
  });

  it("expires", () => {
    const token = encodeViewAs("admin", "org-1", later);
    expect(decodeViewAs(token, "admin", later)).toBeNull();
    expect(decodeViewAs(token, "admin", later - 1)).not.toBeNull();
  });

  it("can't be edited to reach another org or last longer", () => {
    const [user, org, expiry, signature] = encodeViewAs("admin", "org-1", later).split(".");
    expect(decodeViewAs([user, "org-2", expiry, signature].join("."), "admin")).toBeNull();
    expect(decodeViewAs([user, org, later + 3_600_000, signature].join("."), "admin")).toBeNull();
  });

  it("rejects junk", () => {
    for (const token of ["", "a.b.c", "a.b.c.d", "a.b.c.d.e"]) expect(decodeViewAs(token, "a")).toBeNull();
  });
});

// The read-only rule depends on how actions are written, so hold them to it.
describe("server actions in a read-only view", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir)
      .filter((name) => !name.startsWith("._"))
      .flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
      });
  const actionFiles = files("src").filter((file) => /^\s*["']use server["']/.test(readFileSync(file, "utf8")));
  // Own-account and platform actions: they check the session themselves and don't act on the viewed org.
  const OUTSIDE = ["src/features/admin/actions.ts", "src/features/auth/actions.ts"];

  it("every action file on org data goes through getWorkspace", () => {
    expect(actionFiles.length).toBeGreaterThan(10);
    const missing = actionFiles.filter((file) => !OUTSIDE.includes(file) && !readFileSync(file, "utf8").includes("getWorkspace("));
    expect(missing).toEqual([]);
  });

  it("an action marked as a read doesn't write", () => {
    const WRITES = /\.(insert|delete)\(|\.update\(|recordAudit|runJob|saveAsset|deleteAsset|dispatch\w*\(/;
    const offenders = actionFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return source
        .split(/^(?=export (?:async )?function )/m)
        .filter((part) => part.includes("getWorkspace({ read: true })") && WRITES.test(part))
        .map((part) => `${file}: ${part.split("(")[0]}`);
    });
    expect(offenders).toEqual([]);
  });
});
