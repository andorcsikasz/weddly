import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { TextField } from "./TextField";

export type EntryOptions = {
  title: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  helperText?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Optional client-side validator. Return null when valid, error string otherwise. */
  validate?: (value: string) => string | null;
};

type Pending = {
  opts: EntryOptions;
  resolve: (v: string | null) => void;
};

const EntryContext = createContext<((opts: EntryOptions) => Promise<string | null>) | null>(null);

export function EntryDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending) {
      setValue(pending.opts.defaultValue ?? "");
      setError(null);
    }
  }, [pending]);

  const prompt = useCallback(
    (opts: EntryOptions): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        setPending({ opts, resolve });
      }),
    [],
  );

  const cancel = useCallback(() => {
    setPending((cur) => {
      cur?.resolve(null);
      return null;
    });
  }, []);

  const submit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!pending) return;
      const trimmed = value.trim();
      const validationError = pending.opts.validate?.(trimmed) ?? null;
      if (validationError) {
        setError(validationError);
        return;
      }
      pending.resolve(trimmed);
      setPending(null);
    },
    [pending, value],
  );

  const ctxValue = useMemo(() => prompt, [prompt]);

  return (
    <EntryContext.Provider value={ctxValue}>
      {children}
      <Dialog
        open={pending !== null}
        title={pending?.opts.title ?? ""}
        role="dialog"
        onClose={cancel}
        footer={
          <>
            <Button variant="outline" type="button" onClick={cancel}>
              {pending?.opts.cancelLabel}
            </Button>
            <Button variant="primary" type="submit" form="entry-dialog-form">
              {pending?.opts.confirmLabel}
            </Button>
          </>
        }
      >
        {pending && (
          <form id="entry-dialog-form" onSubmit={submit}>
            <TextField
              id="entry-dialog-input"
              label={pending.opts.label}
              placeholder={pending.opts.placeholder}
              helperText={pending.opts.helperText}
              errorText={error ?? undefined}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              autoFocus
            />
          </form>
        )}
      </Dialog>
    </EntryContext.Provider>
  );
}

export function useEntryPrompt() {
  const ctx = useContext(EntryContext);
  if (!ctx) throw new Error("useEntryPrompt must be used inside <EntryDialogProvider>");
  return ctx;
}
