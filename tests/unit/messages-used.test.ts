import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { JOB_FEATURES } from "@/features/analytics/config";

// Some messages are lists (scene suggestions), which count as one key.
type Tree = { [key: string]: string | string[] | Tree };

const has = (tree: Tree, path: string) => {
  let node: Tree[string] | undefined = tree;
  for (const part of path.split(".")) node = typeof node === "object" && !Array.isArray(node) ? node[part] : undefined;
  return node !== undefined;
};

const leaves = (tree: Tree, prefix = ""): string[] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === "string" || Array.isArray(value) ? [prefix + key] : leaves(value, `${prefix}${key}.`)));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => !name.startsWith("._"))
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });

/** Keys written literally as `t("key")`, each resolved against the nearest `const t = useTranslations("Namespace")` above it. */
function usedKeys(source: string) {
  const hooks = [...source.matchAll(/const (\w+) = (?:await )?(?:useTranslations|getTranslations)\(\s*"([\w.]+)"\s*\)/g)].map((m) => ({
    at: m.index,
    name: m[1],
    namespace: m[2],
  }));
  const keys: string[] = [];
  for (const name of new Set(hooks.map((h) => h.name))) {
    for (const call of source.matchAll(new RegExp(`(?<![\\w.])${name}(?:\\.rich)?\\(\\s*"([\\w.]+)"`, "g"))) {
      const hook = hooks.filter((h) => h.name === name && h.at < call.index).at(-1);
      if (hook) keys.push(`${hook.namespace}.${call[1]}`);
    }
  }
  return keys;
}

describe("translations", () => {
  const used = [...new Set(sourceFiles("src").flatMap((file) => usedKeys(readFileSync(file, "utf8"))))];

  it("finds the keys in the code", () => {
    expect(used).toContain("CopyBulk.sourcePaste");
    expect(used.length).toBeGreaterThan(500);
  });

  it.each([
    ["en", en as Tree],
    ["ar", ar as Tree],
  ])("%s has every key the code asks for", (_locale, messages) => {
    expect(used.filter((key) => !has(messages, key))).toEqual([]);
  });

  // Labels looked up dynamically (`tTools(feature)`) are invisible to the scan above.
  it.each([
    ["en", en as Tree],
    ["ar", ar as Tree],
  ])("%s labels every job feature", (_locale, messages) => {
    expect(JOB_FEATURES.filter((f) => !has(messages, `Analytics.tools.${f}`))).toEqual([]);
  });

  it("en and ar have the same keys", () => {
    const enKeys = new Set(leaves(en as Tree));
    const arKeys = new Set(leaves(ar as Tree));
    expect([...enKeys].filter((key) => !arKeys.has(key))).toEqual([]);
    expect([...arKeys].filter((key) => !enKeys.has(key))).toEqual([]);
  });
});
