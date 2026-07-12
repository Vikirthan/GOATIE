import React, { useEffect, useState } from 'react';
import { X, Download, Share, Plus } from 'lucide-react';

// Detect iOS
const isIOS = (): boolean => {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as any).MSStream
  );
};

// Detect if already running as installed PWA
const isInStandaloneMode = (): boolean => {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'goatie_pwa_dismissed_until';
const DISMISS_DAYS = 3; // remind again after 3 days if dismissed

export const InstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOS, setShowIOS] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (isInStandaloneMode()) return;

    // Don't show if user dismissed recently
    const dismissedUntil = localStorage.getItem(DISMISS_KEY);
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil)) return;

    if (isIOS()) {
      // iOS: show manual instructions after 2s
      const t = setTimeout(() => setShowIOS(true), 2000);
      return () => clearTimeout(t);
    }

    // Android / Chrome: listen for browser install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // small delay so the page loads first
      setTimeout(() => setShowBanner(true), 1500);
    };

    window.addEventListener('beforeinstallprompt', handler);

    window.addEventListener('appinstalled', () => {
      setShowBanner(false);
      setInstalled(true);
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setInstalling(false);
    if (outcome === 'accepted') {
      setShowBanner(false);
      setInstalled(true);
    } else {
      dismiss();
    }
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(until));
    setShowBanner(false);
    setShowIOS(false);
  };

  // ── Success flash ───────────────────────────────────────────────────────────
  if (installed) {
    return (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-4 fade-in duration-500">
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-emerald-500 text-white shadow-2xl font-semibold text-sm">
          <span className="text-xl">🎉</span>
          GOATIE installed successfully!
        </div>
      </div>
    );
  }

  // ── iOS instructions banner ─────────────────────────────────────────────────
  if (showIOS) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-[100] p-4 animate-in slide-in-from-bottom-4 duration-500">
        <div className="max-w-lg mx-auto rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
          {/* Green top accent */}
          <div className="h-1 bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-400" />

          <div className="p-5">
            <div className="flex items-start gap-4">
              {/* Goat icon */}
              <div className="shrink-0 w-14 h-14 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-lg">
                <img src="/android-chrome-192x192.png" alt="GOATIE" className="w-12 h-12 rounded-xl object-cover" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-base text-gray-900 dark:text-white">Install GOATIE</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Add to your Home Screen for the best experience</p>
                  </div>
                  <button
                    onClick={dismiss}
                    className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <X className="h-4 w-4 text-gray-400" />
                  </button>
                </div>
              </div>
            </div>

            {/* Steps */}
            <div className="mt-4 space-y-2.5">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center">
                  <Share className="h-3.5 w-3.5 text-white" />
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Tap <strong>Share</strong> <span className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">⎙</span> at the bottom of Safari
                </p>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900">
                <div className="shrink-0 w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center">
                  <Plus className="h-3.5 w-3.5 text-white" />
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Tap <strong>"Add to Home Screen"</strong>
                </p>
              </div>
            </div>

            <button
              onClick={dismiss}
              className="mt-3 w-full py-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Android / Chrome install banner ────────────────────────────────────────
  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] p-4 animate-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-lg mx-auto rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
        {/* Animated green top bar */}
        <div className="h-1 bg-gradient-to-r from-emerald-400 via-green-500 to-emerald-400 animate-pulse" />

        <div className="p-5">
          <div className="flex items-center gap-4">
            {/* App icon */}
            <div className="shrink-0 w-16 h-16 rounded-2xl bg-emerald-500 shadow-lg shadow-emerald-500/30 flex items-center justify-center">
              <img
                src="/android-chrome-192x192.png"
                alt="GOATIE"
                className="w-14 h-14 rounded-xl object-cover"
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-base text-gray-900 dark:text-white leading-tight">
                    Install GOATIE
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-snug">
                    Works offline · Fast · No app store needed
                  </p>
                </div>
                <button
                  onClick={dismiss}
                  className="shrink-0 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4 text-gray-400" />
                </button>
              </div>
            </div>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            {['🐐 Manage goats', '📶 Works offline', '🔔 Notifications', '⚡ Fast & secure'].map((f) => (
              <span
                key={f}
                className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900 font-medium"
              >
                {f}
              </span>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleInstall}
              disabled={installing}
              className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-500/25 disabled:opacity-70"
            >
              {installing ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Installing…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Install App
                </>
              )}
            </button>
            <button
              onClick={dismiss}
              className="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
