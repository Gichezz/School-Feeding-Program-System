import { useState, useEffect } from 'react';
import { isOnline as browserIsOnline } from '../sync/syncService';

/**
 * Hook to track online/offline status using browser's online/offline events
 * Returns the current online status
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => {
    // Initialize with current browser status; offline only when it says so
    return browserIsOnline();
  });

  useEffect(() => {
    // Update status when browser reports online/offline changes
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup event listeners
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
