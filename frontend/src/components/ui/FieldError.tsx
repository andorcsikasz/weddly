import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

type FieldErrorProps = {
  id: string;
  children: ReactNode;
  className?: string;
};

export function FieldError({ id, children, className }: FieldErrorProps) {
  return (
    <p
      id={id}
      role="alert"
      aria-live="polite"
      className={["field-error inline-flex items-start gap-1", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
