import { cn } from "@/lib/utils";

export const BRAND = { name: "Plant Technocrat", tagline: "Growing Green Futures" };

// The logo artwork is deep green on transparent, so in dark mode it sits on a paper-coloured plate.
// Pass plate={false} where it is already on a light surface (receipt paper, a paper panel).

/** The "P with leaves" emblem from the logo (transparent background). */
export function BrandMark({ className, alt = "", plate = true }) {
  return (
    <img
      src="/brand/mark.webp"
      alt={alt}
      width={256}
      height={256}
      draggable={false}
      className={cn("h-9 w-9 shrink-0 select-none object-contain", plate && "dark:rounded-lg dark:bg-brand-paper dark:p-1", className)}
    />
  );
}

/** Full logo: emblem, "PLANT TECHNOCRAT" wordmark and tagline. */
export function BrandLogo({ className, plate = true }) {
  return (
    <img
      src="/brand/logo.webp"
      alt={`${BRAND.name} — ${BRAND.tagline}`}
      width={640}
      height={603}
      draggable={false}
      className={cn("h-auto w-full select-none object-contain", plate && "dark:rounded-2xl dark:bg-brand-paper dark:p-3", className)}
    />
  );
}
