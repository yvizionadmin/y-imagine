"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { clipOffsets, timelineDuration, type EditTimeline } from "@/lib/editor/timeline";

const RATIO_CLASS = { "9:16": "aspect-[9/16] h-full max-h-[min(60vh,560px)]", "1:1": "aspect-square h-full max-h-[min(60vh,480px)]", "16:9": "aspect-video w-full max-w-2xl" } as const;

export const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Plays the timeline in the browser as an approximation of the export: the clips one after another
 * with their cuts, the subtitles over them, the music track under them and the voice-over from its start, framed like the export
 * size. One <video> switches source per clip. `seek` (a clip index) jumps to that clip's start.
 */
export function EditorPreview({
  timeline,
  urlFor,
  audioUrl,
  voiceUrl = null,
  seek,
  onTime,
}: {
  timeline: EditTimeline;
  urlFor: (assetId: string) => string;
  audioUrl: string | null;
  /** The voice-over, played once from timeline.voice.start. */
  voiceUrl?: string | null;
  seek: { clip: number; nonce: number } | null;
  onTime: (seconds: number) => void;
}) {
  const t = useTranslations("Editor");
  const video = useRef<HTMLVideoElement>(null);
  const music = useRef<HTMLAudioElement>(null);
  const voice = useRef<HTMLAudioElement>(null);
  const [rawIndex, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [lastSeek, setLastSeek] = useState<number | null>(null);
  const clips = timeline.clips;
  const offsets = useMemo(() => clipOffsets(clips), [clips]);
  const total = timelineDuration(timeline);
  // A new seek request moves the playhead to that clip (adjusted while rendering, not in an effect).
  if (seek && seek.nonce !== lastSeek) {
    setLastSeek(seek.nonce);
    setIndex(seek.clip);
    setPlaying(false);
  }
  // Stays valid when clips are removed.
  const index = Math.max(0, Math.min(rawIndex, clips.length - 1));
  const clip = clips[index];

  // The same file as before: its source doesn't change, so jump to the clip's start here.
  useEffect(() => {
    const el = video.current;
    if (seek && el && clips[seek.clip] && el.dataset.asset === clips[seek.clip].assetId) el.currentTime = clips[seek.clip].start;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new seek request moves the playhead
  }, [seek]);

  useEffect(() => {
    if (video.current) video.current.volume = timeline.clipVolume;
    if (music.current) music.current.volume = timeline.audio?.volume ?? 0;
    if (voice.current) voice.current.volume = timeline.voice?.volume ?? 0;
  }, [timeline.clipVolume, timeline.audio?.volume, timeline.voice?.volume]);

  useEffect(() => {
    const el = video.current;
    const track = music.current;
    if (!el) return;
    if (playing) {
      void el.play().catch(() => setPlaying(false));
      if (track && track.duration) {
        track.currentTime = time % track.duration;
        void track.play().catch(() => undefined);
      }
    } else {
      el.pause();
      track?.pause();
      voice.current?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the music only resyncs on play/pause and clip changes
  }, [playing, index]);

  /** Starts the voice-over when the playhead reaches it (and keeps it in step), stops it outside it. */
  function syncVoice(at: number) {
    const el = voice.current;
    const start = timeline.voice?.start ?? 0;
    if (!el || !timeline.voice) return;
    const position = at - start;
    if (!playing || position < 0 || (el.duration && position >= el.duration)) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.paused || Math.abs(el.currentTime - position) > 0.4) {
      el.currentTime = position;
      if (el.paused) void el.play().catch(() => undefined);
    }
  }

  function report(local: number) {
    if (!clip) return;
    const at = offsets[index] + Math.max(0, local - clip.start);
    setTime(at);
    onTime(at);
    syncVoice(at);
  }

  function onTimeUpdate() {
    const el = video.current;
    if (!el || !clip) return;
    if (el.currentTime >= clip.end - 0.04) {
      if (index + 1 < clips.length) setIndex(index + 1);
      else {
        setPlaying(false);
        setIndex(0);
        setTime(0);
        onTime(0);
      }
      return;
    }
    report(el.currentTime);
  }

  function toggle() {
    if (!clips.length) return;
    setPlaying((p) => !p);
  }

  const subtitles = timeline.subtitles.filter((s) => time >= s.start && time < s.end);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex h-[min(60vh,560px)] w-full items-center justify-center rounded-2xl bg-neutral-950 p-3">
        <div className={cn("relative overflow-hidden rounded-lg bg-black", RATIO_CLASS[timeline.aspectRatio])}>
          {clip ? (
            <video
              ref={video}
              key={`${index}-${clip.assetId}`}
              data-asset={clip.assetId}
              src={urlFor(clip.assetId)}
              playsInline
              preload="auto"
              aria-label={t("preview")}
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = clip.start;
                e.currentTarget.volume = timeline.clipVolume;
                if (playing) void e.currentTarget.play().catch(() => setPlaying(false));
              }}
              onTimeUpdate={onTimeUpdate}
              className={cn("size-full", timeline.fit === "cover" ? "object-cover" : "object-contain")}
            />
          ) : (
            <p className="flex size-full items-center justify-center p-6 text-center text-xs text-white/70">{t("previewEmpty")}</p>
          )}
          {subtitles.length > 0 && (
            <div className="pointer-events-none absolute inset-x-[6%] bottom-[8%] flex flex-col items-center gap-1">
              {subtitles.map((s) => (
                <p key={s.id} dir="auto" className="text-center text-[clamp(11px,3.4cqi,18px)] leading-snug font-bold text-white [text-shadow:0_0_3px_#000,0_0_3px_#000]">
                  {s.text}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      {audioUrl && <audio ref={music} src={audioUrl} loop preload="auto" />}
      {voiceUrl && <audio ref={voice} src={voiceUrl} preload="auto" />}
      <div className="flex items-center gap-3">
        {/* Media controls keep their direction in RTL. */}
        <button
          type="button"
          onClick={toggle}
          disabled={!clips.length}
          aria-label={playing ? t("pause") : t("play")}
          className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </button>
        <span className="font-mono text-xs text-muted-foreground tabular-nums" dir="ltr">
          {formatTime(time)} / {formatTime(total)}
        </span>
      </div>
    </div>
  );
}
