"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type MemberSessionUser = {
  memberId: string;
  email: string;
  displayName: string;
  expiresAt: string;
};

type MemberSessionContextValue = {
  isLoaded: boolean;
  isSignedIn: boolean;
  user: MemberSessionUser | null;
  refreshSession: () => Promise<boolean>;
  signOut: (redirectUrl?: string) => Promise<void>;
};

const MemberSessionContext = createContext<MemberSessionContextValue | null>(null);

export function MemberSessionProvider({ children }: { children: React.ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<MemberSessionUser | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch("/api/public/members/auth/session", {
        cache: "no-store",
        credentials: "same-origin"
      });
      const body = await response.json().catch(() => ({})) as {
        authenticated?: boolean;
        user?: MemberSessionUser | null;
      };
      const nextUser = response.ok && body.authenticated ? body.user ?? null : null;
      setUser(nextUser);
      return Boolean(nextUser);
    } catch {
      setUser(null);
      return false;
    } finally {
      setIsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const value = useMemo<MemberSessionContextValue>(() => ({
    isLoaded,
    isSignedIn: Boolean(user),
    user,
    refreshSession,
    signOut: async (redirectUrl = "/member?loggedOut=1") => {
      try {
        await fetch("/api/public/members/auth/session", {
          method: "DELETE",
          credentials: "same-origin"
        });
      } finally {
        setUser(null);
        window.location.href = redirectUrl;
      }
    }
  }), [isLoaded, refreshSession, user]);

  return (
    <MemberSessionContext.Provider value={value}>
      {children}
    </MemberSessionContext.Provider>
  );
}

export function useMemberSession() {
  const value = useContext(MemberSessionContext);
  if (!value) throw new Error("useMemberSession must be used inside MemberSessionProvider");
  return value;
}

export function MemberSignOutButton({
  children,
  className = "member-account-menu-item",
  redirectUrl = "/member?loggedOut=1"
}: {
  children: React.ReactNode;
  className?: string;
  redirectUrl?: string;
}) {
  const { signOut } = useMemberSession();
  return (
    <button className={className} type="button" onClick={() => void signOut(redirectUrl)}>
      {children}
    </button>
  );
}
