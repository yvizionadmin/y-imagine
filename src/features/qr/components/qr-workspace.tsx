"use client";

import { useMemo, useRef, useState } from "react";
import { zipSync } from "fflate";
import { CircleAlert, Download, ImagePlus, Layers, QrCode, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { cn } from "cn";
import { ConfigPanel, DockToolbar, Field, MODE_SWITCH, modeSwitchItem, OptionalTag, PanelBody, PanelFooter, PanelHeader, Section } from "@/components/app/config-panel";
import { CanvasEmptyState, CanvasShell } from "@/components/app/workspace-canvas";
import { Button } from "@/components/ui/button";
import { LATN } from "@/lib/format";
import {
  LOGO_SCALE,
  MAX_TEXT,
  QR_LEVELS,
  QR_MARGINS,
  QR_SIZES,
  buildMatrix,
  isHex,
  parseBatch,
  safeFileName,
  scanCheck,
  toPng,
  toSvg,
  type QrLevel,
  type QrStyle,
} from "../qr";

const MAX_BATCH = 200;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

type Mode = "single" | "batch";

/** QR code generator (rail "QR Gen"). Everything renders in the browser; no credits are used. */
export function QrWorkspace() {
  const t = useTranslations("QrGen");
  const format = useFormatter();
  const params = useSearchParams();
  const logoInput = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("single");
  const [text, setText] = useState(() => params.get("url")?.slice(0, MAX_TEXT) ?? "");
  const [batch, setBatch] = useState("");
  const [fg, setFg] = useState("#111827");
  const [bg, setBg] = useState("#ffffff");
  const [margin, setMargin] = useState<number>(4);
  const [level, setLevel] = useState<QrLevel>("M");
  const [logo, setLogo] = useState<{ url: string; name: string } | null>(null);
  const [logoScale, setLogoScale] = useState<number>(LOGO_SCALE.default);
  const [size, setSize] = useState<number>(1024);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A logo hides the middle of the code, so it needs the highest error correction.
  const effectiveLevel: QrLevel = logo ? "H" : level;
  const colorsValid = isHex(fg) && isHex(bg);
  const style: QrStyle = {
    fg: isHex(fg) ? fg : "#000000",
    bg: isHex(bg) ? bg : "#ffffff",
    margin,
    level: effectiveLevel,
    logo: logo ? { url: logo.url, scale: logoScale } : null,
  };
  const check = colorsValid ? scanCheck(style.fg, style.bg) : "ok";

  const single = useMemo(() => buildMatrix(text.trim(), effectiveLevel), [text, effectiveLevel]);
  const rows = useMemo(() => parseBatch(batch).slice(0, MAX_BATCH + 1), [batch]);
  const batchItems = useMemo(
    () => rows.slice(0, MAX_BATCH).map((row, i) => ({ ...row, index: i + 1, result: buildMatrix(row.text, effectiveLevel) })),
    [rows, effectiveLevel],
  );
  const batchErrors = batchItems.filter((item) => !item.result.ok);
  const canDownload = colorsValid && (mode === "single" ? single.ok : batchItems.length > 0 && batchErrors.length === 0);
  const baseName = mode === "single" ? safeFileName(text.trim(), "qr-code") : "qr-codes";

  async function downloadPng() {
    if (!canDownload || mode !== "single" || !single.ok) return;
    setBusy(true);
    saveBlob(await toPng(single.matrix, style, size), `${baseName}.png`);
    setBusy(false);
  }

  function downloadSvg() {
    if (!canDownload || mode !== "single" || !single.ok) return;
    saveBlob(new Blob([toSvg(single.matrix, style)], { type: "image/svg+xml" }), `${baseName}.svg`);
  }

  async function downloadZip() {
    if (!canDownload || mode !== "batch") return;
    setBusy(true);
    const taken = new Set<string>();
    const files: Record<string, Uint8Array> = {};
    for (const item of batchItems) {
      if (!item.result.ok) continue;
      let name = safeFileName(item.name || item.text, `qr-${item.index}`);
      for (let n = 2; taken.has(name); n++) name = `${safeFileName(item.name || item.text, `qr-${item.index}`)}-${n}`;
      taken.add(name);
      files[`${name}.png`] = new Uint8Array(await (await toPng(item.result.matrix, style, size)).arrayBuffer());
    }
    // PNGs are already compressed; store them as-is.
    saveBlob(new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `qr-codes_${new Date().toISOString().slice(0, 10)}.zip`);
    setBusy(false);
  }

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > MAX_LOGO_BYTES) {
      setNotice(t("logoRejected"));
      return;
    }
    setNotice(null);
    const reader = new FileReader();
    // A data URL (not an object URL) so the logo is embedded in downloaded SVGs.
    reader.onload = () => setLogo({ url: String(reader.result), name: file.name });
    reader.readAsDataURL(file);
  }

  function reset() {
    setText("");
    setBatch("");
    setFg("#111827");
    setBg("#ffffff");
    setMargin(4);
    setLevel("M");
    setLogo(null);
    setLogoScale(LOGO_SCALE.default);
    setSize(1024);
    setNotice(null);
  }

  return (
    <>
      <ConfigPanel tool="qr" onSubmit={() => (mode === "single" ? downloadPng() : downloadZip())}>
        <PanelHeader title={t("title")} />
        <PanelBody>
          <DockToolbar>
            <div role="radiogroup" aria-label={t("mode")} className={MODE_SWITCH}>
              {(["single", "batch"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={modeSwitchItem(mode === m)}
                >
                  {m === "single" ? <QrCode className="size-4" aria-hidden /> : <Layers className="size-4" aria-hidden />}
                  {t(`modes.${m}`)}
                </button>
              ))}
            </div>
          </DockToolbar>

          <Section title={t("content")} inline>
            {mode === "single" ? (
              <Field label={t("contentLabel")} htmlFor="qr-text">
                <textarea
                  id="qr-text"
                  rows={3}
                  maxLength={MAX_TEXT}
                  dir="auto"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="https://www.example.com/products/sofa-12345"
                  className="resize-none rounded-lg border bg-background px-3 py-2 text-[13px] outline-none focus-visible:border-ring"
                />
                <span className="text-[11px] text-subtle">{t("contentHint")}</span>
              </Field>
            ) : (
              <Field label={t("batchLabel")} htmlFor="qr-batch">
                <textarea
                  id="qr-batch"
                  rows={8}
                  dir="ltr"
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  placeholder={"SOFA-12345, https://www.example.com/p/sofa-12345\nCHAIR-OAK-99, https://www.example.com/p/chair-oak-99"}
                  className="resize-y rounded-lg border bg-background px-3 py-2 font-mono text-[12px] outline-none focus-visible:border-ring"
                />
                <span className="text-[11px] text-subtle">
                  {t("batchHint", { max: format.number(MAX_BATCH, LATN) })}
                </span>
                {rows.length > MAX_BATCH && <span className="text-[11px] text-danger">{t("batchLimit", { max: format.number(MAX_BATCH, LATN) })}</span>}
                {batchErrors.length > 0 && (
                  <span className="text-[11px] text-danger">
                    {t("batchErrors", { lines: batchErrors.map((e) => format.number(e.index, LATN)).slice(0, 8).join(", ") })}
                  </span>
                )}
              </Field>
            )}
          </Section>

          <Section title={t("style")}>
            <div className="grid grid-cols-2 gap-3">
              <ColorField id="qr-fg" label={t("foreground")} value={fg} onChange={setFg} />
              <ColorField id="qr-bg" label={t("background")} value={bg} onChange={setBg} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("margin")} htmlFor="qr-margin">
                <Select id="qr-margin" value={String(margin)} onChange={(v) => setMargin(Number(v))}>
                  {QR_MARGINS.map((m) => (
                    <option key={m} value={m}>
                      {t(`margins.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("errorCorrection")} htmlFor="qr-level">
                <Select id="qr-level" value={effectiveLevel} disabled={!!logo} onChange={(v) => setLevel(v as QrLevel)}>
                  {QR_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {t(`levels.${l}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {logo && <span className="text-[11px] text-subtle">{t("levelLocked")}</span>}
          </Section>

          <Section title={t("logo")} aside={<OptionalTag />}>
            {logo ? (
              <div className="flex flex-col gap-3 rounded-xl border bg-muted p-3">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                  <img src={logo.url} alt="" className="size-10 shrink-0 rounded bg-background object-contain" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{logo.name}</span>
                  <button type="button" onClick={() => setLogo(null)} className="text-[11px] font-semibold text-danger">
                    {t("removeLogo")}
                  </button>
                </div>
                <Field label={t("logoSize", { value: format.number(logoScale, { ...LATN, style: "percent", maximumFractionDigits: 0 }) })} htmlFor="qr-logo-size">
                  <input
                    id="qr-logo-size"
                    type="range"
                    min={LOGO_SCALE.min * 100}
                    max={LOGO_SCALE.max * 100}
                    value={Math.round(logoScale * 100)}
                    onChange={(e) => setLogoScale(Number(e.target.value) / 100)}
                    className="accent-primary"
                  />
                </Field>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => logoInput.current?.click()}
                className="flex h-16 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-primary bg-accent text-[13px] font-semibold text-accent-foreground"
              >
                <ImagePlus className="size-4 text-primary" aria-hidden />
                {t("addLogo")}
              </button>
            )}
            <input
              ref={logoInput}
              type="file"
              accept={LOGO_TYPES.join(",")}
              hidden
              onChange={(e) => {
                pickLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </Section>

          <Section title={t("output")}>
            <Field label={t("pngSize")} htmlFor="qr-size">
              <Select id="qr-size" value={String(size)} onChange={(v) => setSize(Number(v))}>
                {QR_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {`${s} × ${s}`}
                  </option>
                ))}
              </Select>
            </Field>
          </Section>

          {notice && (
            <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-[11px] text-danger">
              {notice}
            </p>
          )}
        </PanelBody>

        <PanelFooter
          note={t("free")}
          actions={
            mode === "single" && (
              <Button type="button" variant="outline" disabled={!canDownload} onClick={downloadSvg} className="h-9 rounded-full px-3 text-xs font-semibold">
                SVG
              </Button>
            )
          }
          submitIcon={<Download className="size-4" aria-hidden />}
          submitLabel={mode === "single" ? t("downloadPng") : t("downloadZip", { count: batchItems.length, display: format.number(batchItems.length, LATN) })}
          canSubmit={canDownload}
          busy={busy}
          onReset={reset}
        />
      </ConfigPanel>

      <CanvasShell>
        {mode === "single" ? (
          single.ok ? (
            <Preview svg={toSvg(single.matrix, style)} caption={t("version", { version: String(single.matrix.version), modules: String(single.matrix.size) })} check={check} />
          ) : single.error === "too_long" ? (
            <CanvasEmptyState icon={<CircleAlert className="size-6 text-danger" aria-hidden />} title={t("tooLongTitle")} body={t("tooLongBody")} placeholder={false} />
          ) : (
            <CanvasEmptyState icon={<QrCode className="size-6 text-primary" aria-hidden />} title={t("emptyTitle")} body={t("emptyBody")} />
          )
        ) : batchItems.length === 0 ? (
          <CanvasEmptyState icon={<QrCode className="size-6 text-primary" aria-hidden />} title={t("batchEmptyTitle")} body={t("batchEmptyBody")} />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <ul className="grid grid-cols-3 gap-4">
              {batchItems.slice(0, 9).map((item) => (
                <li key={item.index} className="flex w-40 flex-col items-center gap-2 rounded-xl border bg-background p-3">
                  {item.result.ok ? (
                    <QrImage svg={toSvg(item.result.matrix, style)} className="size-32" />
                  ) : (
                    <span className="flex size-32 items-center justify-center text-center text-[11px] text-danger">{t("tooLongTitle")}</span>
                  )}
                  <span className="w-full truncate text-center text-[11px] font-semibold" dir="auto">
                    {item.name || item.text}
                  </span>
                </li>
              ))}
            </ul>
            {batchItems.length > 9 && (
              <span className="text-xs text-muted-foreground">{t("more", { count: batchItems.length - 9, display: format.number(batchItems.length - 9, LATN) })}</span>
            )}
            <ScanWarning check={check} />
          </div>
        )}
      </CanvasShell>
    </>
  );
}

function Preview({ svg, caption, check }: { svg: string; caption: string; check: ReturnType<typeof scanCheck> }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-2xl border bg-background p-4 shadow-sm">
        <QrImage svg={svg} className="size-80" />
      </div>
      <span className="text-xs text-muted-foreground">{caption}</span>
      <ScanWarning check={check} />
    </div>
  );
}

function QrImage({ svg, className }: { svg: string; className?: string }) {
  // Rendered as an <img> from a data URL so user text never becomes live markup in the page.
  // eslint-disable-next-line @next/next/no-img-element -- generated SVG data URL
  return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="" className={cn("[image-rendering:pixelated]", className)} />;
}

function ScanWarning({ check }: { check: ReturnType<typeof scanCheck> }) {
  const t = useTranslations("QrGen");
  if (check === "ok") return null;
  return (
    <p role="status" className="flex max-w-sm items-start gap-2 rounded-lg border bg-background px-3 py-2 text-xs">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
      {t(`scan.${check}`)}
    </p>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex h-9 items-center gap-2 rounded-lg border bg-background px-2">
        <input
          type="color"
          aria-label={label}
          value={isHex(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
        />
        <input
          id={id}
          value={value}
          dir="ltr"
          maxLength={7}
          aria-invalid={!isHex(value)}
          onChange={(e) => onChange(e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs uppercase outline-none aria-invalid:text-danger"
        />
      </div>
    </Field>
  );
}

function Select({ id, value, disabled, onChange, children }: { id: string; value: string; disabled?: boolean; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border bg-background px-2 text-[13px] outline-none focus-visible:border-ring disabled:opacity-60"
    >
      {children}
    </select>
  );
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
