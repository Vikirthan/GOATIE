import React from 'react';
import { AlertCircle, CheckCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastItemProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const icons = {
  success: <CheckCircle className="h-5 w-5 text-green-600" />,
  error: <AlertCircle className="h-5 w-5 text-red-600" />,
  info: <Info className="h-5 w-5 text-blue-600" />,
  warning: <AlertTriangle className="h-5 w-5 text-yellow-600" />,
};

const backgrounds = {
  success: 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800',
  error: 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800',
  info: 'bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800',
  warning: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800',
};

export const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose }) => {
  React.useEffect(() => {
    if (toast.duration !== 0) {
      const timer = setTimeout(() => onClose(toast.id), toast.duration || 4000);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onClose]);

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 shadow-lg animate-slideUp',
        backgrounds[toast.type]
      )}
    >
      {icons[toast.type]}
      <div className="flex-1">
        <p className="font-semibold">{toast.title}</p>
        {toast.message && <p className="text-sm">{toast.message}</p>}
      </div>
      <button
        onClick={() => onClose(toast.id)}
        className="text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

let toastCounter = 0;

export function showToast(type: ToastType, title: string, message?: string) {
  const id = `toast_${toastCounter++}`;
  const event = new CustomEvent('showToast', {
    detail: { id, type, title, message },
  });
  window.dispatchEvent(event);
  return id;
}

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  React.useEffect(() => {
    const handleShowToast = (event: Event) => {
      const { detail } = event as CustomEvent<Toast>;
      setToasts((prev) => [...prev, detail]);
    };

    window.addEventListener('showToast', handleShowToast);
    return () => window.removeEventListener('showToast', handleShowToast);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
      ))}
    </div>
  );
};
