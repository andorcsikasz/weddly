import type { ReactNode } from "react";

type HelperTextProps = {
  id: string;
  children: ReactNode;
  className?: string;
};

export function HelperText({ id, children, className }: HelperTextProps) {
  return (
    <p id={id} className={["field-help", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </p>
  );
}
