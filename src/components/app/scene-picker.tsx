"use client";

import { useRef, useState } from "react";
import { ImageUp, LayoutGrid, Loader2, PenLine, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PromptChips, PromptTips } from "@/components/app/prompt-assist";
import { useObjectUrl } from "@/components/app/upload-inputs";
import { categoryPresets, CUSTOM_SCENE_MAX, findScene, sceneLibrary, type ScenePreset } from "@/lib/catalog-presets";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";
import { ROOM_TYPES } from "@/features/looks/config";
import type { TeamScene } from "@/features/scenes/actions";
import { TEAM_SCENE_NAME_MAX } from "@/features/scenes/config";

/**
 * A library scene, a scene the merchant describes in words, their own background photo, one of the
 * team's saved scenes, or none (the model decides).
 */
export type SceneChoice =
  | { kind: "preset"; key: string }
  | { kind: "custom"; prompt: string }
  | { kind: "upload"; file: File }
  | { kind: "team"; scene: TeamScene }
  | null;

/** The org's saved scenes for the category, and saving an upload as one (null when that failed). */
export type TeamScenes = {
  scenes: TeamScene[];
  canSave: boolean;
  save: (file: File, name: string, roomType: string) => Promise<TeamScene | null>;
};

export const SCENE_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const SCENE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export function ScenePicker({
  label,
  recommended,
  value,
  onChange,
  chips = [],
  allowUpload = true,
  team,
}: {
  label: string;
  recommended: ScenePreset[];
  value: SceneChoice;
  onChange: (value: SceneChoice) => void;
  /** Suggested scene phrases for the category, shown under "Describe your own". */
  chips?: readonly string[];
  /** Offer "Upload your own" in the library (not in bulk, where one upload can't be stored per run). */
  allowUpload?: boolean;
  /** The team's saved scenes, shown first; without it there are none. */
  team?: TeamScenes;
}) {
  const t = useTranslations("ScenePicker");
  const [libraryOpen, setLibraryOpen] = useState(false);

  // A scene picked from the library stays visible in the row even when it isn't a recommendation.
  const picked = value?.kind === "preset" ? findScene(value.key) : undefined;
  const cards = picked && !recommended.some((s) => s.key === picked.key) ? [picked, ...recommended] : recommended;
  const custom = value?.kind === "custom";
  const uploadPreview = useObjectUrl(value?.kind === "upload" ? value.file : null);
  // A picked team scene stays visible even if the list (re)loads without it.
  const teamCards = value?.kind === "team" && !team?.scenes.some((s) => s.id === value.scene.id) ? [value.scene, ...(team?.scenes ?? [])] : (team?.scenes ?? []);

  return (
    <>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {value?.kind === "upload" && uploadPreview && (
          <button
            type="button"
            role="radio"
            aria-checked
            onClick={() => onChange(null)}
            className="flex h-[110px] w-[118px] flex-col overflow-hidden rounded-xl border-2 border-primary bg-muted text-start"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the merchant's file */}
            <img src={uploadPreview} alt="" className="h-[70px] w-full shrink-0 object-cover" />
            <span className="w-full truncate p-1.5 text-[11px] leading-tight font-semibold" title={value.file.name}>
              {t("uploaded")}
            </span>
          </button>
        )}
        {teamCards.map((scene) => {
          const selected = value?.kind === "team" && value.scene.id === scene.id;
          return <TeamSceneCard key={scene.id} scene={scene} selected={selected} onClick={() => onChange(selected ? null : { kind: "team", scene })} />;
        })}
        {cards.map((scene) => {
          const selected = value?.kind === "preset" && value.key === scene.key;
          return <SceneCard key={scene.key} scene={scene} selected={selected} onClick={() => onChange(selected ? null : { kind: "preset", key: scene.key })} />;
        })}
      </div>

      {value?.kind === "upload" && team?.canSave && (
        <SaveTeamScene key={`${value.file.name}:${value.file.size}`} file={value.file} save={team.save} onSaved={(scene) => onChange({ kind: "team", scene })} />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border bg-muted px-2 py-2 text-xs font-medium"
        >
          <LayoutGrid className="size-3.5" aria-hidden />
          {t("browseAll", { count: sceneLibrary.length })}
        </button>
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => onChange(custom ? null : { kind: "custom", prompt: "" })}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg border bg-muted px-2 py-2 text-xs font-medium",
            custom && "border-primary bg-primary text-primary-foreground",
          )}
        >
          <PenLine className="size-3.5" aria-hidden />
          {t("custom")}
        </button>
      </div>

      {custom && (
        <>
          <Textarea
            aria-label={t("customLabel")}
            autoFocus
            value={value.prompt}
            maxLength={CUSTOM_SCENE_MAX}
            onChange={(e) => onChange({ kind: "custom", prompt: e.target.value })}
            placeholder={t("customPlaceholder")}
            className="h-20 min-h-20 resize-none rounded-lg bg-muted p-3 text-xs leading-[1.4] placeholder:text-subtle md:text-xs"
          />
          <PromptChips chips={chips} value={value.prompt} max={CUSTOM_SCENE_MAX} onChange={(prompt) => onChange({ kind: "custom", prompt })} />
          <PromptTips text={value.prompt} checkShort />
        </>
      )}

      <SceneLibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        selected={value?.kind === "preset" ? value.key : null}
        onSelect={(key) => {
          onChange({ kind: "preset", key });
          setLibraryOpen(false);
        }}
        onUpload={
          allowUpload
            ? (file) => {
                onChange({ kind: "upload", file });
                setLibraryOpen(false);
              }
            : null
        }
      />
    </>
  );
}

function SceneCard({ scene, selected, onClick, className }: { scene: ScenePreset; selected: boolean; onClick: () => void; className?: string }) {
  const tp = useTranslations("Presets");
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex h-[110px] w-[118px] flex-col overflow-hidden rounded-xl border bg-muted text-start",
        selected && "border-2 border-primary",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- tenant-configurable preset images */}
      <img src={thumbnailUrl(scene.image, 256)} alt="" loading="lazy" className="h-[70px] w-full shrink-0 object-cover" />
      <span className="line-clamp-2 w-full p-1.5 text-[11px] leading-tight font-semibold">{tp(`scenes.${scene.key}`)}</span>
    </button>
  );
}

function TeamSceneCard({ scene, selected, onClick }: { scene: TeamScene; selected: boolean; onClick: () => void }) {
  const t = useTranslations("ScenePicker");
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={t("teamScene", { name: scene.name })}
      onClick={onClick}
      className={cn("relative flex h-[110px] w-[118px] flex-col overflow-hidden rounded-xl border bg-muted text-start", selected && "border-2 border-primary")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the org's own stored scene */}
      <img src={thumbnailUrl(scene.imageUrl, 256)} alt="" loading="lazy" className="h-[70px] w-full shrink-0 object-cover" />
      <span className="absolute top-1 start-1 flex items-center gap-0.5 rounded-full bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
        <Users className="size-2.5" aria-hidden />
        {t("team")}
      </span>
      <span className="line-clamp-2 w-full p-1.5 text-[11px] leading-tight font-semibold">{scene.name}</span>
    </button>
  );
}

/** Under an uploaded scene: name it and save it to the team's scenes for this category. */
function SaveTeamScene({ file, save, onSaved }: { file: File; save: TeamScenes["save"]; onSaved: (scene: TeamScene) => void }) {
  const t = useTranslations("ScenePicker");
  const tr = useTranslations("Looks.rooms");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim().slice(0, TEAM_SCENE_NAME_MAX));
  const [roomType, setRoomType] = useState<string>(ROOM_TYPES[0]);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 self-start text-xs font-medium text-primary hover:underline">
        <Users className="size-3.5" aria-hidden />
        {t("saveForTeam")}
      </button>
    );
  }

  // Not a <form>: this sits inside the prompt dock's form, and a submit would bubble to it.
  async function submit() {
    if (!name.trim() || state === "saving") return;
    setState("saving");
    const scene = await save(file, name.trim(), roomType).catch(() => null);
    if (scene) onSaved(scene);
    else setState("error");
  }

  return (
    <div role="group" aria-label={t("saveForTeam")} className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5">
      <p className="text-[11px] text-muted-foreground">{t("saveForTeamHint")}</p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={t("teamSceneName")}
          value={name}
          maxLength={TEAM_SCENE_NAME_MAX}
          required
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void submit();
          }}
          className="h-8 min-w-0 flex-1 text-xs"
        />
        <select
          aria-label={t("roomType")}
          value={roomType}
          onChange={(e) => setRoomType(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          {ROOM_TYPES.map((room) => (
            <option key={room} value={room}>
              {tr(room)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={state === "saving" || !name.trim()} onClick={() => void submit()}>
          {state === "saving" && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
        {state === "error" && (
          <p role="alert" className="text-[11px] text-danger">
            {t("saveError")}
          </p>
        )}
      </div>
    </div>
  );
}

function SceneLibraryDialog({
  open,
  onOpenChange,
  selected,
  onSelect,
  onUpload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: string | null;
  onSelect: (key: string) => void;
  onUpload: ((file: File) => void) | null;
}) {
  const t = useTranslations("ScenePicker");
  const tp = useTranslations("Presets");
  const [filter, setFilter] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function pickFile(file: File | undefined) {
    if (!file) return;
    const ok = SCENE_UPLOAD_TYPES.includes(file.type) && file.size <= SCENE_UPLOAD_MAX_BYTES;
    setUploadError(!ok);
    if (ok) onUpload?.(file);
  }
  const scenes = filter ? sceneLibrary.filter((s) => s.categories.includes(filter)) : sceneLibrary;
  const filters = [null, ...categoryPresets.map((c) => c.key)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-[640px]">
        <div className="flex flex-col gap-1 pe-8">
          <DialogTitle className="text-base font-bold">{t("libraryTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{t("libraryDescription")}</DialogDescription>
        </div>

        <div role="radiogroup" aria-label={t("filter")} className="flex flex-wrap gap-1.5">
          {filters.map((key) => (
            <button
              key={key ?? "all"}
              type="button"
              role="radio"
              aria-checked={filter === key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground",
                filter === key && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {key ? tp(`categories.${key}`) : t("all")}
            </button>
          ))}
        </div>

        <div role="radiogroup" aria-label={t("libraryTitle")} className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {onUpload && (
            <>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex h-[110px] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-primary/50 bg-primary/5 p-2 text-center text-primary hover:bg-primary/10"
              >
                <ImageUp className="size-5" aria-hidden />
                <span className="text-[11px] leading-tight font-semibold">{t("upload")}</span>
                <span className="text-[10px] leading-tight text-muted-foreground">{t("uploadHint")}</span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={SCENE_UPLOAD_TYPES.join(",")}
                className="hidden"
                aria-label={t("upload")}
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </>
          )}
          {uploadError && (
            <p role="alert" className="col-span-full text-[11px] text-danger">
              {t("uploadError")}
            </p>
          )}
          {scenes.map((scene) => (
            <SceneCard key={scene.key} scene={scene} selected={selected === scene.key} onClick={() => onSelect(scene.key)} className="w-full" />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
