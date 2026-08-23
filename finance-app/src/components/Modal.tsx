"use client";

import React, { useEffect, useId, useRef } from "react";

/**
 * The overlay shell all six modals share.
 *
 * The overlay string was repeated seven times and the panel strings four, two
 * and one time respectively. `size` maps to those exact strings rather than
 * composing them from parts, so every existing modal keeps byte-identical
 * markup.
 *
 * Centralising it also fixes the accessibility gap in all six at once: there
 * was no role="dialog", no focus trap, no Escape-to-close (the codebase had no
 * keydown listener at all), no focus restore and no scroll lock.
 */
const PANELS = {
  /** The four form modals. */
  form: "bg-white rounded-lg p-6 w-[90vw] max-w-md",
  /** AccountModal's transaction list. */
  wide: "bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto",
  /** SettingsModal. */
  settings: "bg-white p-8 rounded-3xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto",
} as const;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// Nested modals would otherwise each restore overflow on unmount.
let scrollLocks = 0;

export interface ModalProps {
  onClose: () => void;
  size?: keyof typeof PANELS;
  /** Renders the standard header. Omit to supply your own inside children. */
  title?: string;
  description?: string;
  closeLabel?: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({
  onClose,
  size = "form",
  title,
  description,
  closeLabel = "Close",
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the panel itself rather than the first field: programmatic focus
    // on a tabindex="-1" container shows no focus ring, so nothing moves.
    panelRef.current?.focus();

    if (scrollLocks === 0) {
      document.body.style.overflow = "hidden";
    }
    scrollLocks += 1;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      scrollLocks -= 1;
      if (scrollLocks === 0) {
        document.body.style.overflow = "";
      }
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`${PANELS[size]} focus:outline-none`}
        onClick={(event) => event.stopPropagation()}
      >
        {title && (
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 id={titleId} className="text-2xl font-bold">{title}</h2>
              {description && <p className="text-sm text-gray-500">{description}</p>}
            </div>
            <button
              type="button"
              className="text-gray-500 hover:text-gray-900"
              onClick={onClose}
            >
              {closeLabel}
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
};

export default Modal;
