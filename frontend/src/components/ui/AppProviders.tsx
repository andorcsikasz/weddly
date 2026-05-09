import type { ReactNode } from "react";
import { ConfirmDialogProvider } from "./ConfirmDialogProvider";
import { EntryDialogProvider } from "./EntryDialogProvider";
import { ToastProvider } from "./ToastProvider";

/** Single mount point for the imperative UI providers (toast + confirm + entry).
 *  Mounted in main.tsx between <I18nProvider> and <BrowserRouter>. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <EntryDialogProvider>{children}</EntryDialogProvider>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}
