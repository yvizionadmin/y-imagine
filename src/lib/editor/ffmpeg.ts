import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// FFmpeg for the video editor, run as a child process (worker, or the web process without Redis).
// The binary is FFMPEG_PATH when set (e.g. a system ffmpeg on the server), else the one the
// `ffmpeg-static` package downloads at install, else `ffmpeg` on the PATH.

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly code: "not_installed" | "timed_out" | "failed",
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

export function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const bundled = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  return existsSync(bundled) ? bundled : "ffmpeg";
}

/** Bundled subtitle fonts (Noto Sans + Noto Sans Arabic, SIL OFL), so no system fonts are needed. */
export const fontsDir = () => path.join(process.cwd(), "assets", "fonts");

const STDERR_KEEP = 16_000;

/**
 * Runs ffmpeg with these arguments (never a shell). Resolves with stderr (where ffmpeg logs), rejects
 * with an FfmpegError on a non-zero exit, a missing binary or the timeout (the process is killed).
 */
export function runFfmpeg(args: string[], { timeoutMs = 10 * 60_000, allowFailure = false } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_KEEP);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new FfmpegError(error.code === "ENOENT" ? "ffmpeg not found" : error.message, error.code === "ENOENT" ? "not_installed" : "failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new FfmpegError("ffmpeg timed out", "timed_out"));
      if (code === 0 || allowFailure) return resolve(stderr);
      // The last lines say what went wrong; they hold file paths in the temp folder, never user data.
      reject(new FfmpegError(`ffmpeg exited with ${code}: ${stderr.split("\n").slice(-4).join(" | ")}`, "failed"));
    });
  });
}

export type MediaProbe = { duration: number; hasVideo: boolean; hasAudio: boolean };

/** Reads duration and streams from `ffmpeg -i` output (ffmpeg-static ships without ffprobe). */
export function parseProbe(stderr: string): MediaProbe | null {
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return { duration, hasVideo: /Stream #\d+:\d+[^\n]*: Video:/.test(stderr), hasAudio: /Stream #\d+:\d+[^\n]*: Audio:/.test(stderr) };
}

export async function probeMedia(file: string): Promise<MediaProbe | null> {
  // With no output file ffmpeg exits 1 after printing the input's details, which is all we need.
  return parseProbe(await runFfmpeg(["-i", file], { timeoutMs: 30_000, allowFailure: true }));
}
