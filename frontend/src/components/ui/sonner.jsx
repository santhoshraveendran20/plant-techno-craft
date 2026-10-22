import { Toaster as Sonner } from "sonner";

const Toaster = (props) => (
  <Sonner
    theme="light"
    position="top-right"
    richColors
    closeButton
    className="toaster group"
    toastOptions={{
      classNames: {
        toast: "group toast group-[.toaster]:shadow-lg",
        description: "group-[.toast]:text-muted-foreground",
      },
    }}
    {...props}
  />
);

export { Toaster };
