"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./ui";

export interface CardPhoto {
  /** Held locally until sync uploads it. */
  blob?: Blob;
  /** Set once the photo is in storage, or when loading a lead from the server. */
  url?: string | null;
}

function PhotoSlot({
  label,
  photo,
  onPick,
  onClear,
  disabled,
}: {
  label: string;
  photo: CardPhoto;
  onPick: (file: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo.blob) {
      setObjectUrl(null);
      return;
    }
    const created = URL.createObjectURL(photo.blob);
    setObjectUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [photo.blob]);

  const preview = objectUrl ?? photo.url ?? null;

  return (
    <div className="flex-1">
      <input
        ref={input}
        type="file"
        accept="image/*"
        // Opens the rear camera straight away on a phone, the file picker on a laptop.
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          // Reset so picking the same file twice still fires a change.
          event.target.value = "";
        }}
      />
      {preview ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: previews cannot go through next/image */}
          <img
            src={preview}
            alt={`${label} of the business card`}
            className="h-28 w-full rounded-lg border border-slate-300 object-cover"
          />
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${label.toLowerCase()} photo`}
            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/80 text-sm font-bold text-white"
          >
            ×
          </button>
          <span className="mt-1 block text-center text-xs font-medium text-slate-500">{label}</span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-slate-400 hover:bg-slate-100 disabled:opacity-50"
        >
          <span className="text-2xl">📷</span>
          <span className="text-xs font-semibold">{label}</span>
        </button>
      )}
    </div>
  );
}

export function CardPhotos({
  front,
  back,
  onPickFront,
  onPickBack,
  onClearFront,
  onClearBack,
  scanning,
}: {
  front: CardPhoto;
  back: CardPhoto;
  onPickFront: (file: File) => void;
  onPickBack: (file: File) => void;
  onClearFront: () => void;
  onClearBack: () => void;
  scanning: boolean;
}) {
  const hasAny = useMemo(
    () => Boolean(front.blob || front.url || back.blob || back.url),
    [front, back],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-slate-700">Business card</span>
        {scanning ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <Spinner className="h-3 w-3" /> Reading card…
          </span>
        ) : hasAny ? null : (
          <span className="text-xs text-slate-400">Optional</span>
        )}
      </div>
      <div className="flex gap-3">
        <PhotoSlot
          label="Front"
          photo={front}
          onPick={onPickFront}
          onClear={onClearFront}
          disabled={scanning}
        />
        <PhotoSlot
          label="Back"
          photo={back}
          onPick={onPickBack}
          onClear={onClearBack}
          disabled={scanning}
        />
      </div>
    </div>
  );
}
