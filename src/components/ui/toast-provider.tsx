"use client";

import { useState, createContext, useContext, useCallback } from "react";
import * as Toast from "@radix-ui/react-toast";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextType {
  toast: (type: ToastType, title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: ToastType, title: string, description?: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-success" />,
    error: <AlertCircle className="w-5 h-5 text-error" />,
    info: <Info className="w-5 h-5 text-primary-light" />,
  };

  const borders = {
    success: "border-success/30",
    error: "border-error/30",
    info: "border-primary/30",
  };

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      <Toast.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <Toast.Root
            key={t.id}
            className={`glass-neu rounded-xl p-4 flex items-start gap-3 border ${borders[t.type]}`}
            open={true}
            onOpenChange={(open) => {
              if (!open) setToasts((prev) => prev.filter((x) => x.id !== t.id));
            }}
          >
            {icons[t.type]}
            <div className="flex-1 min-w-0">
              <Toast.Title className="text-sm font-semibold">{t.title}</Toast.Title>
              {t.description && (
                <Toast.Description className="text-xs text-muted mt-0.5">
                  {t.description}
                </Toast.Description>
              )}
            </div>
            <Toast.Close className="p-1 rounded-lg hover:bg-surface-light">
              <X className="w-3.5 h-3.5 text-muted" />
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[90vw]" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}
