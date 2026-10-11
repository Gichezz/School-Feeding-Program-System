import { useEffect, useState } from 'react';
import {
  getSession,
  isSessionValid,
  SESSION_CHANGED_EVENT,
  SESSION_EXPIRED_EVENT,
} from '../services/session';

/**
 * Current session state; updates on sign in, sign out and expiry.
 * @returns {{ session: object | null, isValid: boolean, user: object | null, isAdmin: boolean }}
 */
export function useSession() {
  const [session, setSession] = useState(() => getSession());

  useEffect(() => {
    const refresh = () => setSession(getSession());
    window.addEventListener(SESSION_CHANGED_EVENT, refresh);
    window.addEventListener(SESSION_EXPIRED_EVENT, refresh);
    // Re-check periodically so a session that expires while the app is open is noticed
    const timer = setInterval(refresh, 60 * 1000);
    return () => {
      window.removeEventListener(SESSION_CHANGED_EVENT, refresh);
      window.removeEventListener(SESSION_EXPIRED_EVENT, refresh);
      clearInterval(timer);
    };
  }, []);

  return {
    session,
    isValid: isSessionValid(session),
    user: session?.user || null,
    isAdmin: session?.user?.role === 'admin',
  };
}
