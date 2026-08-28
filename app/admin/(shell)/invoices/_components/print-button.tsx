"use client";

/**
 * Printing is a browser capability, so this is the one client component the
 * invoice needs. Hidden when printing — nobody wants a button in the paper.
 */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-9 rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800 print:hidden dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
    >
      Print invoice
    </button>
  );
}
