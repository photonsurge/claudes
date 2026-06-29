"use client";

/**
 * Debug-UI context. Owns a global "show debug affordances" flag that <DebugButton>
 * (and any other dev-only UI) reads. Ported from ../../hydra, minus the next-auth
 * role gate — this app has no auth, so availability is env-driven: always on outside
 * production, or whenever NEXT_PUBLIC_DEBUG_UI is set. Toggle with Ctrl/Cmd+Shift+D.
 * Mounted once in app/layout.tsx.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type DebugUIContextValue = {
  showDebugUI: boolean;
  canUseDebugUI: boolean;
  toggleDebugUI: () => void;
  setShowDebugUI: (value: boolean) => void;
};

const defaultContextValue: DebugUIContextValue = {
  showDebugUI: false,
  canUseDebugUI: false,
  toggleDebugUI: () => {},
  setShowDebugUI: () => {},
};

const DebugUIContext = createContext<DebugUIContextValue>(defaultContextValue);

export const DebugUIProvider = ({ children }: { children: ReactNode }) => {
  const canUseDebugUI =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_DEBUG_UI === "1";
  const [requestedDebugUI, setRequestedDebugUI] = useState(false);
  const showDebugUI = canUseDebugUI && requestedDebugUI;

  const setShowDebugUI = useCallback((value: boolean) => {
    setRequestedDebugUI(value);
  }, []);

  const toggleDebugUI = useCallback(() => {
    if (!canUseDebugUI) return;
    setRequestedDebugUI((prev) => !prev);
  }, [canUseDebugUI]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTypingTarget =
        tagName === "input" ||
        tagName === "textarea" ||
        target?.isContentEditable;

      if (isTypingTarget) return;
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "d") return;

      event.preventDefault();
      toggleDebugUI();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleDebugUI]);

  const value = useMemo<DebugUIContextValue>(
    () => ({
      showDebugUI,
      canUseDebugUI,
      toggleDebugUI,
      setShowDebugUI,
    }),
    [showDebugUI, canUseDebugUI, toggleDebugUI, setShowDebugUI]
  );

  return (
    <DebugUIContext.Provider value={value}>{children}</DebugUIContext.Provider>
  );
};

export const useDebugUI = () => useContext(DebugUIContext);
