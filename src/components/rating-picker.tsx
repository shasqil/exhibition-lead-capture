"use client";

import { RATINGS, RATING_LABELS, RATING_STYLES, type Rating } from "@/lib/types";

const CAPTIONS: Record<Rating, string> = {
  hot: "Ready to buy",
  warm: "Real interest",
  cold: "Just browsing",
  not_a_lead: "Student, vendor…",
};

/**
 * The single most important thing captured at a booth, so it gets four big
 * targets you can hit without looking while still shaking someone's hand.
 */
export function RatingPicker({
  value,
  onChange,
}: {
  value: Rating;
  onChange: (rating: Rating) => void;
}) {
  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-slate-700">How good is this lead?</span>
      <div className="grid grid-cols-2 gap-2">
        {RATINGS.map((rating) => {
          const selected = value === rating;
          const style = RATING_STYLES[rating];
          return (
            <button
              key={rating}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(rating)}
              className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                selected ? style.on : style.off
              }`}
            >
              <span className="block text-sm font-bold">{RATING_LABELS[rating]}</span>
              <span className={`block text-xs ${selected ? "opacity-80" : "opacity-60"}`}>
                {CAPTIONS[rating]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
