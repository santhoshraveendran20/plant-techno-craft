import { LANGUAGES, t, useLanguage } from "@/i18n";
import { cn } from "@/lib/utils";

/** English / Tamil switch for the top bar: one tap changes every screen, the choice is remembered. */
export function LanguageToggle({ className }) {
  const { lang, setLang } = useLanguage();
  return (
    <div
      role="radiogroup"
      aria-label={t("Language")}
      className={cn("inline-flex h-8 shrink-0 items-center rounded-full border bg-muted/60 p-0.5 text-xs font-medium", className)}
    >
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={lang === l.code}
          title={l.label}
          onClick={() => setLang(l.code)}
          className={cn(
            "h-7 rounded-full px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            lang === l.code ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="sm:hidden">{l.short}</span>
          <span className="hidden sm:inline">{l.label}</span>
        </button>
      ))}
    </div>
  );
}
