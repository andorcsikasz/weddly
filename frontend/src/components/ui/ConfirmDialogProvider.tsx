import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Renders confirm in the accent / blush variant for destructive actions. */
  destructive?: boolean;
};

type Pending = {
  opts: ConfirmOptions;
  resolve: (v: boolean) => void;
};

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const bodyId = useId();

  const confirm = useCallback(
    (opts: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setPending({ opts, resolve });
      }),
    [],
  );

  const settle = useCallback((value: boolean) => {
    setPending((cur) => {
      cur?.resolve(value);
      return null;
    });
  }, []);

  const onClose = useCallback(() => settle(false), [settle]);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={pending !== null}
        title={pending?.opts.title ?? ""}
        describedById={bodyId}
        onClose={onClose}
        footer={
          <>
            <Button variant="outline" onClick={() => settle(false)}>
              {pending?.opts.cancelLabel}
            </Button>
            <Button
              variant={pending?.opts.destructive ? "accent" : "primary"}
              onClick={() => settle(true)}
            >
              {pending?.opts.confirmLabel}
            </Button>
          </>
        }
      >
        {pending?.opts.body && <div id={bodyId}>{pending.opts.body}</div>}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmDialogProvider>");
  return ctx;
}
