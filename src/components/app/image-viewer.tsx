"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Check, Download, ImageUpscale, Loader2, Maximize, Minus, Plus, Share2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { blockedReason } from "@/components/app/job-errors";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useJobCost } from "@/features/credits/use-job-cost";
import { upscaleImage } from "@/features/upscale/actions";
import { UPSCALE_SIZES, type UpscaleSize } from "@/lib/ai/types";
import { downloadImage, shareImage } from "@/lib/share-image";

const MIN_ZOOM = 25;
const MAX_ZOOM = 400;

/** A generated image; `sku` / `mode` say where an upscaled copy belongs in History. */
export type ViewerImage = { src: string; alt: string; name: string; sku?: string; mode?: string };

/** Upscale to 2K or 4K (one job each, priced in Admin → Credits); the result is saved to History. */
function UpscaleButton({ image, buttonClass, onUpscaled }: { image: ViewerImage; buttonClass: string; onUpscaled: (image: ViewerImage) => void }) {
  const t = useTranslations("Workspace.viewer");
  const tw = useTranslations("Workspace");
  const cost = useJobCost("upscale");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(size: UpscaleSize) {
    setBusy(true);
    setError(null);
    const result = await upscaleImage({ imageUrl: image.src, size, sku: image.sku, title: image.alt, mode: image.mode }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      const blocked = result ? blockedReason(result.error) : null;
      return setError(blocked ? tw(`blocked.${blocked}.title`) : t("upscaleFailed"));
    }
    onUpscaled({ src: result.image.url, alt: `${image.alt} · ${size}`, name: `${image.name}_${size}`, sku: image.sku, mode: image.mode });
  }

  return (
    <>
      {error && (
        <span role="alert" className="max-w-56 truncate rounded-full bg-danger px-3 py-1.5 text-[11px] font-semibold text-white" title={error}>
          {error}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={busy ? t("upscaling") : t("upscale")} title={busy ? t("upscaling") : t("upscale")} disabled={busy} aria-busy={busy} className={buttonClass}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageUpscale className="size-4" aria-hidden />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {UPSCALE_SIZES.map((size) => (
            <DropdownMenuItem key={size} onClick={() => void run(size)} className="flex items-center justify-between gap-3">
              <span>{t("upscaleTo", { size })}</span>
              <span className="text-xs text-muted-foreground">{t("upscaleCost", { count: cost })}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Download and Share for a generated image (canvas corner, feed, viewer). */
export function ImageActions({
  image,
  tone = "surface",
  className,
  onUpscaled,
}: {
  image: ViewerImage;
  tone?: "surface" | "dark";
  className?: string;
  /** Shows Upscale; called with the upscaled image. */
  onUpscaled?: (image: ViewerImage) => void;
}) {
  const t = useTranslations("Workspace.viewer");
  const [copied, setCopied] = useState(false);
  const button = cn(
    "flex size-9 items-center justify-center rounded-full outline-offset-2 transition-colors",
    tone === "dark" ? "bg-white/10 text-white hover:bg-white/20" : "border bg-background/90 text-foreground shadow-sm backdrop-blur hover:text-primary",
  );
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {onUpscaled && <UpscaleButton image={image} buttonClass={button} onUpscaled={onUpscaled} />}
      <button type="button" aria-label={t("download")} title={t("download")} onClick={() => void downloadImage(image.src, image.name)} className={button}>
        <Download className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={copied ? t("copied") : t("share")}
        title={copied ? t("copied") : t("share")}
        onClick={async () => {
          const outcome = await shareImage(image.src, image.name, image.alt);
          // No share sheet and nothing to link (a data URL): download instead.
          if (outcome === "unsupported") return void downloadImage(image.src, image.name);
          if (outcome === "copied") {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
        }}
        className={button}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4 rtl:-scale-x-100" aria-hidden />}
      </button>
    </div>
  );
}

/** A generated image in a full-window viewer: zoom, fit, download, share. */
export function ImageViewer({ image: opened, onClose }: { image: ViewerImage | null; onClose: () => void }) {
  const t = useTranslations("Workspace");
  const [zoom, setZoom] = useState(100);
  // An upscale made in the viewer replaces the image shown (until another image is opened).
  const [upscaled, setUpscaled] = useState<{ from: string; image: ViewerImage } | null>(null);
  const image = opened && upscaled?.from === opened.src ? upscaled.image : opened;
  const round = "flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20";

  return (
    <DialogPrimitive.Root
      open={image !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setZoom(100);
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Popup className="fixed inset-0 z-50 flex flex-col outline-none data-open:animate-in data-open:fade-in-0">
          <DialogPrimitive.Title className="sr-only">{t("viewer.title")}</DialogPrimitive.Title>
          {image && (
            <>
              <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
                <p dir="auto" className="min-w-0 truncate text-sm font-medium text-white/80">
                  {image.alt}
                </p>
                <div className="flex items-center gap-1.5">
                  <ImageActions image={image} tone="dark" onUpscaled={(next) => opened && setUpscaled({ from: opened.src, image: next })} />
                  <DialogPrimitive.Close aria-label={t("close")} title={t("close")} className={round}>
                    <X className="size-4" aria-hidden />
                  </DialogPrimitive.Close>
                </div>
              </div>
              {/* Click outside the image (the backdrop area) closes, like other lightboxes. */}
              <div
                className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
                onClick={(e) => e.target === e.currentTarget && onClose()}
                onWheel={(e) => {
                  if (!e.ctrlKey) return;
                  setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - Math.sign(e.deltaY) * 10)));
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- generated output */}
                <img
                  src={image.src}
                  alt={image.alt}
                  style={{ transform: `scale(${zoom / 100})` }}
                  className="max-h-full max-w-full origin-center rounded-lg object-contain shadow-2xl transition-transform"
                />
              </div>
              <div className="flex justify-center p-3 sm:p-4">
                <div className="flex items-center gap-1 rounded-full bg-white/10 p-1 text-white backdrop-blur">
                  <button type="button" aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 25))} className={round}>
                    <Minus className="size-4" aria-hidden />
                  </button>
                  <span className="w-14 text-center font-mono text-xs font-semibold" dir="ltr">
                    {zoom}%
                  </span>
                  <button type="button" aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 25))} className={round}>
                    <Plus className="size-4" aria-hidden />
                  </button>
                  <button type="button" aria-label={t("viewer.fit")} title={t("viewer.fit")} onClick={() => setZoom(100)} className={round}>
                    <Maximize className="size-4" aria-hidden />
                  </button>
                </div>
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
