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
          <span aria-hidden="true" className="ml-0.5 text-blush-700 dark:text-blush-300">
            *
          </span>
        )}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? "text" : "password"}
          className={["input pr-12", invalid ? "input-invalid" : "", className ?? ""]
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
          /* `min-w-tap` (44px from tailwind.config) gives the toggle a
           * thumb-sized hit area without pushing the icon away from the
           * right edge. Previously `px-3` gave ~28px width — fine on a
           * trackpad, miss-prone on phones. */
          className="absolute inset-y-0 right-0 inline-flex min-w-tap items-center justify-center text-ink-500 hover:text-ink-800 focus:outline-none focus-visible:rounded-r focus-visible:ring-2 focus-visible:ring-ink-700 focus-visible:ring-offset-2 dark:text-umber-300 dark:hover:text-paper-50"
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
