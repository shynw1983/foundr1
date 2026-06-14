"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

const modalHistoryFlag = "__foundr1Modal";

export function useModalHistory(enabled: boolean, onClose: () => void, key: string) {
  const onCloseRef = useRef(onClose);
  const isClosingFromPopRef = useRef(false);
  const isActiveRef = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const modalKey = `${modalHistoryFlag}:${key}:${Date.now()}`;
    const previousState = window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {};

    window.history.pushState({
      ...previousState,
      [modalHistoryFlag]: modalKey
    }, "", window.location.href);

    isActiveRef.current = true;
    isClosingFromPopRef.current = false;

    function handlePopState(event: PopStateEvent) {
      if (!isActiveRef.current) return;
      if (event.state?.[modalHistoryFlag] === modalKey) return;
      isClosingFromPopRef.current = true;
      isActiveRef.current = false;
      onCloseRef.current();
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (!isActiveRef.current || isClosingFromPopRef.current) return;

      isActiveRef.current = false;
      if (window.history.state?.[modalHistoryFlag] === modalKey) {
        window.history.back();
      }
    };
  }, [enabled, key]);
}

export function ModalHistoryScope({
  children,
  enabled = true,
  historyKey,
  onClose
}: {
  children: ReactNode;
  enabled?: boolean;
  historyKey: string;
  onClose: () => void;
}) {
  useModalHistory(enabled, onClose, historyKey);
  return <>{children}</>;
}
