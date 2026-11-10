"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Sparkles, Trash2, Upload, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { PageHeader } from "@/components/app/page-header";
import { blockedReason } from "@/components/app/job-errors";
import { Button } from "@/components/ui/button";
import { useJobCost } from "@/features/credits/use-job-cost";
import { Link } from "@/i18n/navigation";
import { thumbnailUrl } from "@/lib/image/thumbnail-url";
import { CHARACTER_DESCRIPTION_MAX, CHARACTER_IMAGE_TYPES, CHARACTER_MAX_IMAGES, CHARACTER_NAME_MAX, type CharacterView } from "@/lib/characters/limits";
import { createCharacterFromDescription, createCharacterFromPhotos, deleteCharacter, getCharacters } from "../actions";

const input = "h-9 w-full rounded-lg border bg-background px-3 text-sm";
const area = "w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm";

/** The team's saved characters (B13), made from photos (with consent) or generated from a description. */
export function CharactersWorkspace() {
  const t = useTranslations("Characters");
  const tw = useTranslations("Workspace");
  const [characters, setCharacters] = useState<CharacterView[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCharacters().then((state) => {
      setCharacters(state.characters);
      setCanEdit(state.canEdit);
    });
  }, []);

  const added = (character: CharacterView) => setCharacters((list) => [character, ...(list ?? [])]);

  async function remove(c: CharacterView) {
    if (!window.confirm(t("deleteConfirm", { name: c.name }))) return;
    const result = await deleteCharacter(c.id);
    if (!result.ok) return setError(result.error);
    setCharacters((list) => (list ?? []).filter((x) => x.id !== c.id));
  }

  const blocked = error ? blockedReason(error) : null;

  return (
    <div className="w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-8">
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Link href="/editor/director" className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted">
              <Sparkles className="size-3.5" aria-hidden />
              {t("director")}
            </Link>
          }
        />
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {blocked ? tw(`blocked.${blocked}.title`) : t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.generic")}
          </p>
        )}
        {canEdit && (
          <div className="grid gap-4 md:grid-cols-2">
            <FromPhotos onError={setError} onAdded={added} />
            <FromDescription onError={setError} onAdded={added} />
          </div>
        )}
        <section aria-labelledby="characters-list" className="flex flex-col gap-3">
          <h2 id="characters-list" className="text-sm font-bold">
            {t("saved")}
          </h2>
          {characters === null ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("loading")} />
          ) : characters.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("none")}</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {characters.map((c) => (
                <CharacterCard key={c.id} character={c} onDelete={() => void remove(c)} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function CharacterCard({ character: c, onDelete }: { character: CharacterView; onDelete: () => void }) {
  const t = useTranslations("Characters");
  const format = useFormatter();
  return (
    <li aria-label={c.name} className="flex flex-col gap-2 rounded-2xl border bg-background p-3">
      <div className="flex gap-1.5">
        {c.images.map((image, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- our asset route, thumbnailed
          <img key={image.assetId} src={thumbnailUrl(image.url, 256)} alt={t("imageAlt", { name: c.name, n: i + 1 })} className="aspect-square min-w-0 flex-1 rounded-lg bg-muted object-cover" />
        ))}
      </div>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p dir="auto" className="text-start text-sm font-semibold">
            {c.name}
          </p>
          {c.description && (
            <p dir="auto" className="text-start text-xs text-muted-foreground">
              {c.description}
            </p>
          )}
        </div>
        {c.canDelete && (
          <Button type="button" size="icon-sm" variant="ghost" aria-label={t("delete", { name: c.name })} onClick={onDelete}>
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {c.source === "upload" ? <ShieldCheck className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
        {c.source === "upload" && c.consentedAt ? t("consented", { date: format.dateTime(new Date(c.consentedAt), { dateStyle: "medium" }) }) : t("generated")}
      </p>
    </li>
  );
}

function FromPhotos({ onAdded, onError }: { onAdded: (c: CharacterView) => void; onError: (code: string | null) => void }) {
  const t = useTranslations("Characters");
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(data: FormData) {
    onError(null);
    setBusy(true);
    data.delete("images");
    for (const file of files) data.append("images", file);
    if (consent) data.set("consent", "yes");
    const result = await createCharacterFromPhotos(data);
    setBusy(false);
    if (!result.ok) return onError(result.error);
    onAdded(result.character);
    form.current?.reset();
    setFiles([]);
    setConsent(false);
    router.refresh();
  }

  return (
    <form ref={form} action={submit} aria-label={t("photos.title")} className="flex flex-col gap-3 rounded-2xl border bg-background p-4">
      <div className="flex items-center gap-2">
        <UserRound className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-bold">{t("photos.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("photos.body")}</p>
      <input name="name" required maxLength={CHARACTER_NAME_MAX} dir="auto" aria-label={t("name")} placeholder={t("namePlaceholder")} className={input} />
      <textarea name="description" maxLength={CHARACTER_DESCRIPTION_MAX} rows={2} dir="auto" aria-label={t("photos.description")} placeholder={t("photos.descriptionPlaceholder")} className={area} />
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs hover:bg-muted">
        <Upload className="size-3.5" aria-hidden />
        {files.length ? t("photos.chosen", { count: files.length }) : t("photos.choose", { max: CHARACTER_MAX_IMAGES })}
        <input
          type="file"
          multiple
          accept={CHARACTER_IMAGE_TYPES.join(",")}
          aria-label={t("photos.choose", { max: CHARACTER_MAX_IMAGES })}
          className="sr-only"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, CHARACTER_MAX_IMAGES))}
        />
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("photos.consent")}</span>
      </label>
      <Button type="submit" disabled={busy || !files.length || !consent}>
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserRound className="size-4" aria-hidden />}
        {t("photos.save")}
      </Button>
    </form>
  );
}

function FromDescription({ onAdded, onError }: { onAdded: (c: CharacterView) => void; onError: (code: string | null) => void }) {
  const t = useTranslations("Characters");
  const router = useRouter();
  const cost = useJobCost("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    onError(null);
    setBusy(true);
    const result = await createCharacterFromDescription({ name, description });
    setBusy(false);
    if (!result.ok) return onError(result.error);
    onAdded(result.character);
    setName("");
    setDescription("");
    router.refresh(); // the credit badge
  }

  return (
    <form
      aria-label={t("generate.title")}
      className="flex flex-col gap-3 rounded-2xl border bg-background p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-bold">{t("generate.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground">{t("generate.body")}</p>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={CHARACTER_NAME_MAX} dir="auto" aria-label={t("name")} placeholder={t("namePlaceholder")} className={input} />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={CHARACTER_DESCRIPTION_MAX}
        rows={4}
        dir="auto"
        aria-label={t("generate.description")}
        placeholder={t("generate.descriptionPlaceholder")}
        className={area}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || !name.trim() || description.trim().length < 10}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {busy ? t("generate.making") : t("generate.save")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("generate.cost", { count: cost })}</span>
      </div>
    </form>
  );
}
