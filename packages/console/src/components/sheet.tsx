"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="sheet-overlay">
      <button
        aria-label="关闭"
        className="sheet-backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section aria-label={title} aria-modal="true" className="sheet" role="dialog">
        <header className="sheet-head">
          <h2>{title}</h2>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button">
            <CloseIcon size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-foot">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}
