"use client";

import { HandHeart } from "lucide-react";
import { useEffect, useRef } from "react";

export type TimecardFarewell = {
  employeeName: string;
  storeName: string;
  companyName: string;
};

export function FarewellDialog({ farewell, onClose }: { farewell: TimecardFarewell; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="timecard-farewell-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="timecard-farewell-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="timecard-farewell-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="timecard-farewell-icon" aria-hidden="true">
          <HandHeart />
        </div>
        <p className="timecard-farewell-eyebrow">おつかれさまでした</p>
        <h2 id="timecard-farewell-title">{farewell.employeeName}さまへ</h2>
        <p className="timecard-farewell-message">
          これまで{farewell.storeName}を支えていただき、<br />本当にありがとうございました。
        </p>
        <p className="timecard-farewell-note">これからの新しい一歩を、心より応援しています。</p>
        <div className="timecard-farewell-signature" aria-label="会社・店舗署名">
          {farewell.companyName ? <span>{farewell.companyName}</span> : null}
          <strong>{farewell.storeName}一同</strong>
        </div>
        <button ref={closeButtonRef} className="primary-button timecard-farewell-close" type="button" onClick={onClose}>
          閉じる
        </button>
      </section>
    </div>
  );
}
