import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto/secrets";

describe("org secrets (envelope encryption)", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encryptSecret("sk-test-very-secret-1234");
    expect(JSON.stringify(sealed)).not.toContain("very-secret");
    expect(decryptSecret(sealed)).toBe("sk-test-very-secret-1234");
  });

  it("uses a fresh data key and nonce each time", () => {
    expect(JSON.stringify(encryptSecret("same"))).not.toBe(JSON.stringify(encryptSecret("same")));
  });

  it("rejects a tampered secret or data key", () => {
    const sealed = encryptSecret("sk-test-very-secret-1234");
    const flip = (part: string) => {
      const [iv, tag, ct] = part.split(".");
      const bytes = Buffer.from(ct, "base64");
      bytes[0] ^= 0xff;
      return [iv, tag, bytes.toString("base64")].join(".");
    };
    expect(() => decryptSecret({ ...sealed, data: flip(sealed.data) })).toThrow();
    expect(() => decryptSecret({ ...sealed, dek: flip(sealed.dek) })).toThrow();
  });

  it("masks to the last four characters", () => {
    expect(maskSecret("sk-test-abcd1234")).toMatch(/1234$/);
    expect(maskSecret("sk-test-abcd1234")).not.toContain("abcd");
  });
});
