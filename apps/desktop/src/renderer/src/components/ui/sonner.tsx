import type { ComponentProps } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="dark"
    position="top-right"
    className="toaster group"
    toastOptions={{ classNames: { toast: "group-toast rounded-lg border bg-popover text-popover-foreground shadow-lg", description: "text-muted-foreground", actionButton: "bg-primary text-primary-foreground", cancelButton: "bg-muted text-muted-foreground" } }}
    {...props}
  />
);
export { Toaster, type ToasterProps };
export type SonnerToast = ComponentProps<typeof Sonner>;
