import { cn } from "@/lib/utils";

export const BRAND = { name: "Plant Technocrat", tagline: "Growing Green Futures" };

/** The "P with leaves" emblem from the logo (transparent background). */
export function BrandMark({ className, alt = "" }) {
  return (
    <img
      src="/brand/mark.webp"
      alt={alt}
      width={256}
      height={256}
      draggable={false}
      className={cn("h-9 w-9 shrink-0 select-none object-contain", className)}
    />
  );
}

/** Full logo: emblem, "PLANT TECHNOCRAT" wordmark and tagline. */
export function BrandLogo({ className }) {
  return (
    <img
      src="/brand/logo.webp"
      alt={`${BRAND.name} — ${BRAND.tagline}`}
      width={640}
      height={603}
      draggable={false}
      className={cn("h-auto w-full select-none object-contain", className)}
    />
  );
}
