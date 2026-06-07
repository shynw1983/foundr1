"use client";

import { ChevronDown, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type MemberAccountMenuProps = {
  label: string;
  signedInLabel: string;
  displayName: string;
  detail: string;
  memberNumberLabel: string;
  memberNumber?: string | null;
  children: ReactNode;
};

export function MemberAccountMenu({
  label,
  signedInLabel,
  displayName,
  detail,
  memberNumberLabel,
  memberNumber,
  children
}: MemberAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <details ref={menuRef} className="member-account-menu" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={label}>
        <span className="member-account-avatar"><UserRound size={18} /></span>
        <span className="member-account-summary-text">
          <strong>{displayName}</strong>
          <small>{detail}</small>
        </span>
        <ChevronDown size={16} />
      </summary>
      <div className="member-account-popover">
        <div className="member-account-card">
          <span>{signedInLabel}</span>
          <strong>{displayName}</strong>
          {memberNumber ? <small>{memberNumberLabel} {memberNumber}</small> : null}
        </div>
        {children}
      </div>
    </details>
  );
}
