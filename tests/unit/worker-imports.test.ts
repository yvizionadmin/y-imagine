import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The worker runs with `tsx --conditions=react-server`, outside Next. Modules it reaches must load there:
// next-intl's main entry (React client context) and next-intl/server crashed it on startup.
// Loading them in a child process with the worker's flags catches that, which Vitest's own resolution does not.

const root = path.resolve(__dirname, "../..");
const tsx = path.join(root, "node_modules/.bin/tsx");

function loadLikeWorker(file: string) {
  const target = JSON.stringify(path.join(root, file));
  return execFileSync(tsx, ["--conditions=react-server", "-e", `import(${target}).then(() => { console.log("loaded"); process.exit(0); })`], {
    cwd: root,
    // A database that is never contacted: importing must not need one.
    env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("worker imports", () => {
  it.each(["src/lib/email/templates.ts", "src/lib/email/notify.ts"])("%s loads under the worker's react-server runtime", (file) => {
    expect(loadLikeWorker(file)).toContain("loaded");
  }, 60_000);
});
