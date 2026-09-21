"use client";

import { joinProducts, parseProducts } from "@/lib/types";

/**
 * Tap-to-toggle chips rather than a `<select multiple>`.
 *
 * A native multi-select on a phone means a long-press or a fiddly modal, one
 * hand, while talking to someone. Chips are one tap each and show the whole
 * choice at a glance. The stored value is the same either way: a comma list.
 */
export function ProductPicker({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = parseProducts(value);

  function toggle(product: string) {
    const next = selected.includes(product)
      ? selected.filter((item) => item !== product)
      : // Keep the configured order rather than tap order, so two leads with
        // the same products read identically in the spreadsheet.
        options.filter((item) => item === product || selected.includes(item));
    onChange(joinProducts(next));
  }

  // Anything stored that is no longer on the list — a renamed product, or a
  // lead captured before the list changed — still has to be visible and
  // removable, or it would silently vanish on the next edit.
  const extras = selected.filter((item) => !options.includes(item));

  return (
    <div>
      <span className="mb-2 block text-sm font-medium text-slate-700">Products discussed</span>
      <div className="flex flex-wrap gap-2">
        {[...options, ...extras].map((product) => {
          const on = selected.includes(product);
          const retired = !options.includes(product);
          return (
            <button
              key={product}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(product)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                on
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              } ${retired ? "italic" : ""}`}
              title={retired ? "No longer on the product list" : undefined}
            >
              {on ? "✓ " : ""}
              {product}
            </button>
          );
        })}
      </div>
      {selected.length === 0 ? (
        <p className="mt-1.5 text-xs text-slate-400">Tap any that came up. Leave blank if none.</p>
      ) : null}
    </div>
  );
}
