import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, type Ref, useState } from "react";
import { useT } from "../../lib/i18n";
import { FieldError } from "./FieldError";
import { HelperText } from "./HelperText";

type PasswordFieldProps = {
  id: string;
  label: string;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  ref?: Ref<HTMLInputElement>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required" | "type">;

export function PasswordField({
  id,
  label,
  helperText,
  errorText,
  required = false,
  className,
  ref,
  ...rest
}: PasswordFieldProps) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
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
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          className={["input pr-11", invalid ? "input-invalid" : "", className ?? ""]
            .filter(Boolean)
            .join(" ")}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t("auth.hide_password") : t("auth.show_password")}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-500 hover:text-ink-800"
          tabIndex={-1}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {helperText && !errorText && <HelperText id={helperId as string}>{helperText}</HelperText>}
      {errorText && <FieldError id={errorId as string}>{errorText}</FieldError>}
    </div>
  );
}
