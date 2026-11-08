"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Image as ImageIcon, UploadCloud } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "cn";
import { LATN } from "@/lib/format";
import { PRODUCT_IMAGE_TYPES } from "@/lib/image-formats";

export function useObjectUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

function useImageSize(src: string | null) {
  const [size, setSize] = useState<{ src: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setSize({ src, width: img.naturalWidth, height: img.naturalHeight });
    img.src = src;
  }, [src]);
  return size?.src === src ? size : null;
}

export function HiddenFileInput({
  inputRef,
  accept,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      hidden
      onChange={(e) => {
        onChange(e.target.files?.[0] ?? null);
        e.target.value = "";
      }}
    />
  );
}

/** Dashed drop target that accepts a single image file. */
export function Dropzone({
  accept,
  onFile,
  title,
  hint,
  className,
}: {
  accept: string;
  onFile: (file: File) => void;
  title: string;
  hint: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const accepts = (file: File) => accept.split(",").some((type) => file.type === type.trim() || (type.endsWith("/*") && file.type.startsWith(type.slice(0, -1))));

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files[0];
        if (dropped && accepts(dropped)) onFile(dropped);
      }}
      className={cn(
        "flex h-[120px] w-full flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-primary bg-accent",
        dragging && "bg-primary/10",
        className,
      )}
    >
      <UploadCloud className="size-6 text-primary" aria-hidden />
      <span className="flex flex-col items-center gap-0.5">
        <span className="text-[13px] font-semibold text-accent-foreground">{title}</span>
        <span className="text-[11px] text-subtle">{hint}</span>
      </span>
      <HiddenFileInput inputRef={inputRef} accept={accept} onChange={(file) => file && onFile(file)} />
    </button>
  );
}

export function FileActions({ onReplace, onRemove }: { onReplace: () => void; onRemove: () => void }) {
  const t = useTranslations("Workspace");
  return (
    <div className="flex gap-3 text-[11px] font-semibold">
      <button type="button" onClick={onReplace} className="text-primary">
        {t("replace")}
      </button>
      <button type="button" onClick={onRemove} className="text-danger">
        {t("remove")}
      </button>
    </div>
  );
}

/** Product image upload (PNG, JPG or WebP): dropzone when empty, file card (thumb, name, size, Replace/Remove) when set. */
export function ProductDropzone({
  file,
  preview,
  onChange,
  title,
  hint,
  accept = PRODUCT_IMAGE_TYPES.join(","),
}: {
  file: File | null;
  preview: string | null;
  onChange: (file: File | null) => void;
  title: string;
  hint: string;
  accept?: string;
}) {
  const t = useTranslations("Workspace");
  const format = useFormatter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dimensions = useImageSize(preview);

  if (!file || !preview) {
    return <Dropzone accept={accept} onFile={onChange} title={title} hint={hint} />;
  }

  return (
    <FileCard
      thumb={
        // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
        <img src={preview} alt="" className="size-16 shrink-0 rounded-lg bg-background object-cover" />
      }
      name={file.name}
      meta={
        <span className="font-mono" dir="ltr">
          {t("fileMeta", {
            width: dimensions?.width ?? "–",
            height: dimensions?.height ?? "–",
            size: format.number(file.size / 1024 / 1024, { ...LATN, maximumFractionDigits: 1 }) + " MB",
          })}
        </span>
      }
      actions={<FileActions onReplace={() => inputRef.current?.click()} onRemove={() => onChange(null)} />}
    >
      <HiddenFileInput inputRef={inputRef} accept={accept} onChange={onChange} />
    </FileCard>
  );
}

export function FileCard({
  thumb,
  name,
  meta,
  actions,
  children,
}: {
  thumb: ReactNode;
  name: string;
  meta: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-muted p-3">
      {thumb}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold" title={name}>
            {name}
          </span>
          <span className="text-[11px] text-subtle">{meta}</span>
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function FilePickerRow({
  file,
  onChange,
  placeholder,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  placeholder: string;
}) {
  const t = useTranslations("Workspace");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <ImageIcon className="size-4 shrink-0 text-subtle" aria-hidden />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn("min-w-0 flex-1 truncate text-start text-xs", file ? "text-foreground" : "text-subtle")}
      >
        {file ? file.name : placeholder}
      </button>
      {file && (
        <button type="button" onClick={() => onChange(null)} className="text-[11px] font-semibold text-danger">
          {t("remove")}
        </button>
      )}
      <HiddenFileInput inputRef={inputRef} accept="image/*" onChange={onChange} />
    </div>
  );
}
