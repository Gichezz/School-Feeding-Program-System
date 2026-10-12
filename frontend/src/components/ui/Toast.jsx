import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

const ICONS = { success: CheckCircle2, info: Info, warning: AlertTriangle, danger: XCircle };
const ToastContext = createContext(null);

/**
 * Provides toast notifications to the app. Toasts are announced to screen readers
 * and dismiss themselves after a few seconds.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(({ tone = 'success', title, description, duration = 5000 }) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, tone, title, description }]);
    if (duration) setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-region" role="status" aria-live="polite">
        {toasts.map(({ id, tone, title, description }) => {
          const Icon = ICONS[tone] || Info;
          return (
            <div key={id} className={`ui-toast ui-toast--${tone}`}>
              <Icon className="ui-toast__icon" aria-hidden="true" />
              <div className="ui-toast__content">
                <p className="ui-toast__title">{title}</p>
                {description && <p className="ui-toast__description">{description}</p>}
              </div>
              <button type="button" className="ui-toast__close" onClick={() => dismiss(id)} aria-label="Dismiss">
                <X aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * const toast = useToast(); toast.show({ tone: 'success', title: 'Saved on this device' })
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
