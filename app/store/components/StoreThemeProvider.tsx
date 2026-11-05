"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createReadError } from "../../../components/useReadRequest";
import { usePathname } from "next/navigation";
import { createStoreThemePalette, getDefaultStoreTheme, normalizeStoreThemeColor, normalizeStoreThemeTarget, storeThemeTargetForPath, type StoreThemeContext, type StoreThemeMode, type StoreThemeTarget } from "../../../lib/store-theme";
import { getStoredStoreSelection, setStoredStoreSelection, storeSelectionEventName } from "./store-selection";
import { createStoreRefreshCoordinator } from "../../../lib/store-polling-client";

const storeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const selectionKey = "foundr1:store:selectedStoreId";
const cachePrefix = "foundr1:store:theme:v2:";
const themeUpdatedEvent = "foundr1:store:theme-updated";

export class StoreThemeRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type ThemeState = {
  employeeId: string;
  context: StoreThemeContext | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  previewColor: string | null;
  setPreviewColor: (color: string | null) => void;
  saveTheme: (primaryColor: string, expectedRevision: string | null, mode?: StoreThemeMode) => Promise<void>;
};
const ThemeContext = createContext<ThemeState | null>(null);

function selectedStore() {
  const explicit = new URLSearchParams(window.location.search).get("storeId");
  if (explicit !== null) return { storeId: explicit.trim(), explicit: true };
  try { return { storeId: getStoredStoreSelection(), explicit: false }; }
  catch { return { storeId: "", explicit: false }; }
}
function cacheKey(employeeId: string, storeId: string, target: StoreThemeTarget) { return `${cachePrefix}${employeeId}:${storeId}:${target}`; }
function cachedColor(employeeId: string, storeId: string, target: StoreThemeTarget): string | null {
  if (!employeeId || !storeIdPattern.test(storeId)) return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(cacheKey(employeeId, storeId, target)) ?? "null");
    return saved?.storeId === storeId && saved?.target === target ? normalizeStoreThemeColor(saved.primaryColor) : null;
  } catch { return null; }
}
function rememberTheme(employeeId: string, context: StoreThemeContext) {
  if (!employeeId) return;
  try {
    const key = cacheKey(employeeId, context.storeId, context.target);
    const value = JSON.stringify({ storeId: context.storeId, target: context.target, primaryColor: context.theme.primaryColor, revision: context.revision });
    if (window.localStorage.getItem(key) !== value) window.localStorage.setItem(key, value);
  } catch { /* Theme delivery continues when browser storage is unavailable. */ }
}
function isThemeContext(value: unknown, target: StoreThemeTarget): value is StoreThemeContext {
  if (!value || typeof value !== "object") return false;
  const context = value as StoreThemeContext;
  return context.target === target && normalizeStoreThemeTarget(context.target) !== null
    && (context.theme?.mode === "custom" || (target !== "operations" && context.theme?.mode === "brand"))
    && (context.brand === null || (typeof context.brand?.name === "string" && Boolean(normalizeStoreThemeColor(context.brand.primaryColor))
      && (context.brand.logoUrl === null || typeof context.brand.logoUrl === "string")))
    && typeof context.storeId === "string" && storeIdPattern.test(context.storeId)
    && typeof context.storeName === "string" && typeof context.canManageTheme === "boolean"
    && Boolean(normalizeStoreThemeColor(context.theme?.primaryColor))
    && context.theme?.paletteVersion === 1 && Array.isArray(context.stores)
    && context.stores.every(store => typeof store?.id === "string" && storeIdPattern.test(store.id) && typeof store.name === "string")
    && (context.updatedAt === null || (typeof context.updatedAt === "string" && Number.isFinite(Date.parse(context.updatedAt))))
    && (context.revision === null || typeof context.revision === "string");
}

export function StoreThemeProvider({ children, employeeId, target, applyToDocument = true }: {
  children: React.ReactNode; employeeId: string; target?: StoreThemeTarget; applyToDocument?: boolean;
}) {
  const pathname = usePathname();
  const themeTarget = target ?? storeThemeTargetForPath(pathname);
  const defaultColor = getDefaultStoreTheme(themeTarget).primaryColor;
  const isLogin = pathname === "/store/login" || pathname === "/store/logout";
  const [context, setContext] = useState<StoreThemeContext | null>(null);
  const [loading, setLoading] = useState(!isLogin);
  const [error, setError] = useState("");
  const [committedColor, setCommittedColor] = useState(defaultColor);
  const [previewColor, changePreviewColor] = useState<string | null>(null);
  const contextRef = useRef<StoreThemeContext | null>(null);
  const requestSequence = useRef(0);
  const requestedStore = useRef("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const coordinator = useRef<{ scope: string; reader: ReturnType<typeof createStoreRefreshCoordinator> } | null>(null);
  const lastRefreshError = useRef<unknown>(null);
  const principalGeneration = useRef(0);
  const previewPath = "/store/settings/appearance";

  useLayoutEffect(() => {
    principalGeneration.current += 1;
    requestSequence.current += 1;
    controller.current?.abort(); coordinator.current?.reader.stop(); coordinator.current = null; lastRefreshError.current = null;
    contextRef.current = null;
    requestedStore.current = "";
    setContext(null);
    changePreviewColor(null);
    setError("");
    setLoading(!isLogin && Boolean(employeeId));
    setCommittedColor(!isLogin ? cachedColor(employeeId, selectedStore().storeId, themeTarget) ?? defaultColor : defaultColor);
  }, [employeeId, isLogin, themeTarget, defaultColor]);

  const readTheme = useCallback(async (signal: AbortSignal) => {
    if (isLogin || !employeeId) { setLoading(false); return; }
    const target = selectedStore();
    const sequence = ++requestSequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const cancel = () => abort.abort();
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) abort.abort();
    lastRefreshError.current = null;
    const changedStore = requestedStore.current !== target.storeId;
    requestedStore.current = target.storeId;
    if (changedStore || !contextRef.current) {
      contextRef.current = null;
      setContext(null);
      changePreviewColor(null);
      setCommittedColor(cachedColor(employeeId, target.storeId, themeTarget) ?? defaultColor);
      setLoading(true);
      setError("");
    }
    try {
      if (target.explicit && !storeIdPattern.test(target.storeId)) {
        contextRef.current = null;
        setContext(null);
        changePreviewColor(null);
        setCommittedColor(defaultColor);
        throw new StoreThemeRequestError("店舗を確認してください。", 400);
      }
      const read = (storeId: string) => fetch(`/api/store/theme?target=${themeTarget}${storeId ? `&storeId=${encodeURIComponent(storeId)}` : ""}`, {
        cache: "no-store", signal: abort.signal
      });
      let response = await read(target.storeId);
      // A remembered store can cease to be accessible, e.g. after a scope change.
      // An explicit URL target must never silently become a different store.
      if ((response.status === 403 || response.status === 400) && target.storeId && !target.explicit) response = await read("");
      const body = await response.json().catch(() => null);
      if (!mounted.current || sequence !== requestSequence.current || abort.signal.aborted) return;
      if (!response.ok || !isThemeContext(body, themeTarget)) {
        if ([401, 403, 404].includes(response.status)) {
          contextRef.current = null;
          setContext(null);
          changePreviewColor(null);
          setCommittedColor(defaultColor);
          try { window.localStorage.removeItem(cacheKey(employeeId, target.storeId, themeTarget)); } catch { /* optional cache */ }
        }
        throw Object.assign(new StoreThemeRequestError(body?.error ?? "テーマを読み込めませんでした。", response.status), { retryAfterMs: createReadError(response).retryAfterMs });
      }
      contextRef.current = body;
      setContext(body);
      setCommittedColor(body.theme.primaryColor);
      if (!body.canManageTheme) changePreviewColor(null);
      rememberTheme(employeeId, body);
      setError("");
      if (!target.explicit && target.storeId !== body.storeId) {
        requestedStore.current = body.storeId;
        try { setStoredStoreSelection(body.storeId); } catch { /* no persistent selection */ }
      }
    } catch (failure) {
      if (mounted.current && sequence === requestSequence.current && !abort.signal.aborted) {
        lastRefreshError.current = failure;
        setError(failure instanceof Error ? failure.message : "テーマを読み込めませんでした。");
        throw failure;
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      if (mounted.current && sequence === requestSequence.current && !abort.signal.aborted) setLoading(false);
    }
  }, [employeeId, isLogin, themeTarget, defaultColor]);

  const ensureReader = useCallback(() => {
    if (isLogin || !employeeId) { setLoading(false); return null; }
    const target = selectedStore();
    const scope = `${employeeId}:${themeTarget}:${target.explicit}:${target.storeId}`;
    if (coordinator.current?.scope === scope) return coordinator.current.reader;
    coordinator.current?.reader.stop(); controller.current?.abort(); requestSequence.current++;
    lastRefreshError.current = null;
    const reader = createStoreRefreshCoordinator(readTheme, {
      // No cross-device theme publication exists yet; use the documented nonurgent read profile.
      healthyIntervalMs: 15 * 60_000, fallbackIntervalMs: 15 * 60_000,
      onError: failure => {
        if (mounted.current && coordinator.current?.scope === scope) {
          lastRefreshError.current = failure; setLoading(false); setError(failure.message || "テーマを読み込めませんでした。");
        }
      }
    });
    coordinator.current = { scope, reader }; reader.start();
    return reader;
  }, [employeeId, isLogin, themeTarget, readTheme]);
  const refresh = useCallback(async () => {
    const reader = ensureReader();
    if (!reader) return;
    await reader.refresh({ force: true });
    if (coordinator.current?.reader === reader && lastRefreshError.current) throw lastRefreshError.current;
  }, [ensureReader]);

  useEffect(() => {
    mounted.current = true;
    const refreshInBackground = () => { void ensureReader()?.refresh(); };
    refreshInBackground();
    const onSelection = () => { if (selectedStore().storeId !== requestedStore.current) refreshInBackground(); };
    const onThemeUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ storeId: string; target: StoreThemeTarget; revision?: string | null }>).detail;
      if (detail?.target === themeTarget && detail.storeId === contextRef.current?.storeId && detail.revision !== contextRef.current?.revision) refreshInBackground();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === selectionKey) onSelection();
      else if (event.key === cacheKey(employeeId, contextRef.current?.storeId ?? "", themeTarget)) refreshInBackground();
    };
    window.addEventListener(storeSelectionEventName, onSelection);
    window.addEventListener(themeUpdatedEvent, onThemeUpdated);
    window.addEventListener("storage", onStorage);
    window.addEventListener("popstate", onSelection);
    return () => {
      mounted.current = false; requestSequence.current++; controller.current?.abort();
      coordinator.current?.reader.stop(); coordinator.current = null;
      window.removeEventListener(storeSelectionEventName, onSelection);
      window.removeEventListener(themeUpdatedEvent, onThemeUpdated);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("popstate", onSelection);
    };
  }, [employeeId, ensureReader, themeTarget]);

  useEffect(() => {
    if (pathname !== previewPath) changePreviewColor(null);
    if (isLogin) {
      contextRef.current = null;
      setContext(null);
      setCommittedColor(defaultColor);
    } else if (selectedStore().storeId !== requestedStore.current) void refresh().catch(() => {});
  }, [pathname, isLogin, refresh, defaultColor]);

  const setPreviewColor = useCallback((color: string | null) => {
    changePreviewColor(color !== null && contextRef.current?.canManageTheme ? normalizeStoreThemeColor(color) : null);
  }, []);

  const saveTheme = useCallback(async (primaryColor: string, expectedRevision: string | null, mode: StoreThemeMode = "custom") => {
    const current = contextRef.current;
    if (!current?.canManageTheme) throw new StoreThemeRequestError("テーマを変更する権限がありません。", 403);
    const color = normalizeStoreThemeColor(primaryColor);
    if (!color || (mode !== "custom" && (mode !== "brand" || themeTarget === "operations"))) throw new StoreThemeRequestError("カラーコードは # と6桁の英数字で入力してください。", 400);
    const storeId = current.storeId;
    const generation = principalGeneration.current;
    const response = await fetch("/api/store/theme", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, target: themeTarget, mode, ...(mode === "custom" ? { primaryColor: color } : {}), expectedRevision })
    });
    const body = await response.json().catch(() => null);
    if (!mounted.current || generation !== principalGeneration.current) {
      throw new StoreThemeRequestError("ログイン状態が変更されました。表示設定を読み直してください。", 401);
    }
    if (!response.ok || !isThemeContext(body, themeTarget) || body.storeId !== storeId) {
      if (response.status === 401 || response.status === 403) {
        changePreviewColor(null);
        if (contextRef.current?.storeId === storeId) {
          contextRef.current = { ...contextRef.current, canManageTheme: false };
          setContext(contextRef.current);
        }
      }
      throw new StoreThemeRequestError(body?.error ?? "テーマを保存できませんでした。", response.status);
    }
    rememberTheme(employeeId, body);
    if (mounted.current && contextRef.current?.storeId === storeId) {
      requestSequence.current += 1;
      controller.current?.abort();
      contextRef.current = body;
      setContext(body);
      setCommittedColor(body.theme.primaryColor);
      changePreviewColor(null);
      setError("");
      setLoading(false);
    }
    window.dispatchEvent(new CustomEvent(themeUpdatedEvent, { detail: { storeId, target: themeTarget, revision: body.revision } }));
  }, [employeeId, themeTarget]);

  // These tokens also reach root-level feedback and shared account/notice overlays.
  // Restore every previous property on unmount so OS/Staff never inherit Store color.
  useLayoutEffect(() => {
    if (!applyToDocument) return;
    const body = document.body;
    const previousAttribute = body.getAttribute("data-store-theme");
    const keys = Object.keys(createStoreThemePalette());
    const previous = keys.map(key => [key, body.style.getPropertyValue(key), body.style.getPropertyPriority(key)]);
    body.setAttribute("data-store-theme", "");
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousMetaColor = meta?.content;
    return () => {
      if (previousAttribute === null) body.removeAttribute("data-store-theme");
      else body.setAttribute("data-store-theme", previousAttribute);
      for (const [key, value, priority] of previous) {
        if (value) body.style.setProperty(key, value, priority);
        else body.style.removeProperty(key);
      }
      if (meta && previousMetaColor !== undefined) meta.content = previousMetaColor;
    };
  }, [applyToDocument]);

  useLayoutEffect(() => {
    if (!applyToDocument) return;
    // Drafts are rendered inside the editor only. Each live route reads its own saved target.
    document.body.setAttribute("data-store-theme", themeTarget);
    const palette = createStoreThemePalette(isLogin ? defaultColor : committedColor);
    for (const [key, value] of Object.entries(palette)) document.body.style.setProperty(key, value);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = palette["--store-primary"];
  }, [committedColor, isLogin, defaultColor, applyToDocument, themeTarget]);

  const value = useMemo(() => ({ employeeId, context, loading, error, refresh, previewColor, setPreviewColor, saveTheme }),
    [employeeId, context, loading, error, refresh, previewColor, setPreviewColor, saveTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useStoreTheme(): ThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Store theme must be used inside StoreThemeProvider.");
  return context;
}

/** Editor resources never own document tokens, even when previewing a customer screen. */
export function StoreThemeEditorScope({ target, children }: { target: StoreThemeTarget; children: React.ReactNode }) {
  const { employeeId } = useStoreTheme();
  return <StoreThemeProvider key={target} employeeId={employeeId} target={target} applyToDocument={false}>{children}</StoreThemeProvider>;
}
