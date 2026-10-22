import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
        success: "border-transparent bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
        warning: "border-transparent bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
        info: "border-transparent bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
