// A real on/off switch. Extracted from four hand-rolled copies that had drifted
// apart (three used a filled pill that inverted the label, one used an eye icon
// whose two states were equally plausible as "currently hidden" and "tap to
// hide"). A switch has one advantage those never had: its state is legible
// without reading anything.

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  describedBy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Visible labelling is the caller's job, so a switch can
   *  sit at the end of a row whose label is already on screen. */
  label: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-40 dark:focus-visible:ring-paper-100 dark:focus-visible:ring-offset-umber-900 ${
        checked ? "bg-sage-500 dark:bg-sage-400" : "bg-paper-300 dark:bg-umber-700"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-soft transition-transform dark:bg-paper-50 ${
          checked ? "translate-x-[1.375rem]" : "translate-x-0.5"
        }`}
        aria-hidden
      />
    </button>
  );
}
