"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import {
  ANGLE_POSITIONS,
  CAMERA_ANGLES,
  SHOT_SET_ANGLES,
  SHOT_SETS,
  toggleAngle,
  type CameraAngle,
  type ShotSet,
} from "@/lib/camera-angles";
import { GENERATE_COST } from "../config";

export type ShotSettings = { shotSet: ShotSet; angles: CameraAngle[]; keepScene: boolean; minimalProps: boolean };
export type Dimensions = { w: string; h: string; d: string };

const labelClass = "text-[11px] font-semibold text-muted-foreground";
const hintClass = "font-normal text-subtle";

export function ShotFields({ value, onChange }: { value: ShotSettings; onChange: (value: ShotSettings) => void }) {
  const t = useTranslations("Generate.shots");
  const multiple = value.angles.length > 1;

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="shotSet" className={labelClass}>
          {t("shotSet")} <span className={hintClass}>— {t("shotSetHint")}</span>
        </label>
        <div className="relative">
          <select
            id="shotSet"
            value={value.shotSet}
            onChange={(e) => {
              const shotSet = e.target.value as ShotSet;
              onChange({ ...value, shotSet, angles: shotSet === "custom" ? value.angles : SHOT_SET_ANGLES[shotSet] });
            }}
            className="w-full appearance-none rounded-lg border bg-transparent py-2 ps-3 pe-8 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {SHOT_SETS.map((set) => (
              <option key={set} value={set}>
                {t(`sets.${set}`)}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-3.5 -translate-y-1/2" aria-hidden />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="cameraAngle" className={labelClass}>
          {t("angle")} <span className={hintClass}>— {t("angleHint")}</span>
        </span>
        <div role="group" aria-labelledby="cameraAngle" className="grid grid-cols-6 gap-1.5">
          {CAMERA_ANGLES.map((angle) => {
            const selected = value.angles.includes(angle);
            return (
              <button
                key={angle}
                type="button"
                aria-pressed={selected}
                title={t(`angleNames.${angle}`)}
                onClick={() => onChange({ ...value, shotSet: "custom", angles: toggleAngle(value.angles, angle) })}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-lg border bg-background px-1 pt-1.5 pb-1 text-[10px] font-medium text-muted-foreground hover:bg-muted",
                  selected && "border-primary bg-accent font-semibold text-primary hover:bg-accent",
                )}
              >
                <AngleIcon angle={angle} className="size-7" />
                <span className="truncate" dir="ltr">
                  {t(`angles.${angle}`)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          {t("summary", {
            count: value.angles.length,
            list: value.angles.map((a) => t(`angles.${a}`)).join(", "),
            cost: GENERATE_COST,
          })}
        </p>
      </div>

      <CheckField
        checked={multiple && value.keepScene}
        disabled={!multiple}
        onChange={(keepScene) => onChange({ ...value, keepScene })}
        label={t("keepScene")}
        hint={t("keepSceneHint")}
      />
      <CheckField
        checked={value.minimalProps}
        onChange={(minimalProps) => onChange({ ...value, minimalProps })}
        label={t("minimalProps")}
        hint={t("minimalPropsHint")}
      />
    </>
  );
}

function CheckField({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className={cn("flex items-start gap-2 text-xs", disabled && "opacity-50")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-primary"
      />
      <span className="leading-snug">
        <span className="font-semibold">{label}</span> <span className="text-subtle">— {hint}</span>
      </span>
    </label>
  );
}

export function DimensionsField({ value, onChange }: { value: Dimensions; onChange: (value: Dimensions) => void }) {
  const t = useTranslations("Generate.shots");
  return (
    <div className="flex flex-col gap-1">
      <span id="dimensions" className={labelClass}>
        {t("dimensions")} <span className={hintClass}>— {t("dimensionsHint")}</span>
      </span>
      <div role="group" aria-labelledby="dimensions" className="grid grid-cols-3 gap-2">
        {(["w", "h", "d"] as const).map((key) => (
          <Input
            key={key}
            value={value[key]}
            inputMode="decimal"
            maxLength={7}
            aria-label={t(`dimension.${key}`)}
            placeholder={key.toUpperCase()}
            onChange={(e) => onChange({ ...value, [key]: e.target.value.replace(/[^\d.,]/g, "") })}
            className="h-auto rounded-lg px-3 py-2 text-[13px] placeholder:text-subtle md:text-[13px]"
          />
        ))}
      </div>
    </div>
  );
}

/** A product (rounded box) with the camera (triangle) placed around it, pointing at it. */
export function AngleIcon({ angle, className }: { angle: CameraAngle; className?: string }) {
  const position = ANGLE_POSITIONS[angle];
  const box = (x: number, y: number) => (
    <g>
      <rect x={x} y={y} width="12" height="12" rx="2.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.5" />
      <path d={`M${x + 1} ${y + 12}h10`} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
  let extra: ReactNode = null;
  let product = box(14, 14);
  if (position !== undefined) {
    const rad = (position * Math.PI) / 180;
    const [ux, uy] = [Math.cos(rad), Math.sin(rad)];
    const [px, py] = [20 + 13 * ux, 20 + 13 * uy];
    const points = [
      [px - 3.5 * ux, py - 3.5 * uy],
      [px + 3 * ux - 4 * uy, py + 3 * uy + 4 * ux],
      [px + 3 * ux + 4 * uy, py + 3 * uy - 4 * ux],
    ];
    extra = <polygon points={points.map((p) => p.map((n) => n.toFixed(2)).join(",")).join(" ")} fill="currentColor" />;
  } else if (angle === "auto") {
    extra = <circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />;
  } else if (angle === "top") {
    extra = <circle cx="20" cy="19.5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />;
  } else if (angle === "closeup") {
    product = box(10, 16);
    extra = (
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="23" cy="16" r="6" />
        <path d="M27.5 20.5 32 25" />
      </g>
    );
  } else if (angle === "human") {
    product = box(9, 14);
    extra = (
      <g fill="currentColor">
        <circle cx="29" cy="14" r="2.5" />
        <path d="M25.5 26v-5.5a3.5 3.5 0 0 1 7 0V26z" />
      </g>
    );
  }
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      {product}
      {extra}
    </svg>
  );
}
