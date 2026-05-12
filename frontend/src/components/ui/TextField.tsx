import type { InputHTMLAttributes, ReactNode, Ref } from "react";
import { FieldError } from "./FieldError";
import { HelperText } from "./HelperText";

type TextFieldProps = {
  id: string;
  label: ReactNode;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  ref?: Ref<HTMLInputElement>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required">;

export function TextField({
  id,
  label,
  helperText,
  errorText,
  required = false,
  className,
  ref,
  ...rest
}: TextFieldProps) {
  const helperId = helperText ? `${id}-help` : undefined;
  const errorId = errorText ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(errorText);

  return (
    <div className="block">
      <label htmlFor={id} className="field-label">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-blush-700">
            *
          </span>
        )}
      </label>
      <input
        ref={ref}
        id={id}
        className={["input", invalid ? "input-invalid" : "", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        {...rest}
      />
      {helperText && !errorText && <HelperText id={helperId as string}>{helperText}</HelperText>}
      {errorText && <FieldError id={errorId as string}>{errorText}</FieldError>}
    </div>
  );
}
