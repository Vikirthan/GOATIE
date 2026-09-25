import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, Moon, Sun, RefreshCw, Cloud } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { logout } from '@/services/authService';
import { showToast } from '@/components/common/Toast';
import { SyncQueueModal } from '@/components/common/SyncQueueModal';
import { format } from 'date-fns';
import {
  fetchMasterSyncStatus,
  needsDailyPush,
  triggerMasterSync,
} from '@/services/masterSheetsSync';

function formatLastSync(ts: number | null): string {
  if (!ts) return 'Not synced yet';
  return `Last sync ${format(new Date(ts), 'd MMM, h:mm a')}`;
}

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const autoSynced = useRef(false);

  const handleLogout = async () => {
    try {
      await logout();
      showToast('success', 'Logged out successfully');
    } catch (error) {
      showToast('error', 'Failed to logout');
    }
  };

  // ── Recon Now: triggers a push of the current DB state to the ONE master
  // spreadsheet via the server route (all secrets stay in Vercel env). Every
  // push ends with prune + full id list, so the sheet is verified against
  // current app data daily — deletes propagate the same day. Once a month the
  // push is a full erase + re-fetch as new. The timestamp below the button
  // comes from the server, so it agrees across devices.
  const handleReconNow = async (silent = false) => {
    if (!user) {
      if (!silent) showToast('error', 'Recon failed', 'You must be signed in');
      return false;
    }
    setReconciling(true);
    try {
      const result = await triggerMasterSync();
      if (!result.ok) throw new Error(result.error || 'Reconciliation failed');

      const totals = (result.tabs ?? []).reduce(
        (acc, s) => ({
          added: acc.added + s.added,
          updated: acc.updated + s.updated,
          deleted: acc.deleted + s.deleted,
        }),
        { added: 0, updated: 0, deleted: 0 },
      );
      try {
        const status = await fetchMasterSyncStatus();
        setLastSyncAt(status.lastSyncAt);
      } catch {
        if (result.ranAt) setLastSyncAt(result.ranAt);
      }
      if (!silent) {
        showToast(
          'success',
          result.fullRewrite ? 'Master sheet rewritten!' : 'Sheets reconciled!',
          `+${totals.added} added · ${totals.updated} updated · ${totals.deleted} removed` +
            (result.fullRewrite ? ' · monthly full rewrite' : ''),
        );
      }
      return true;
    } catch (error: unknown) {
      if (!silent) showToast('error', 'Recon failed', error instanceof Error ? error.message : 'Reconciliation failed');
      return false;
    } finally {
      setReconciling(false);
    }
  };

  // Once-a-day auto push on app launch (silent): the server timestamp decides —
  // if the last successful sync happened on a previous calendar day, push so
  // the master sheet never goes stale. Manual Recon Now works anytime.
  useEffect(() => {
    if (!user || autoSynced.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchMasterSyncStatus();
        if (cancelled) return;
        setLastSyncAt(status.lastSyncAt);
        if (!navigator.onLine || !needsDailyPush(status.lastSyncAt)) return;
        autoSynced.current = true;
        await handleReconNow(true);
      } catch {
        // Silent: a missing server config or offline launch just skips;
        // next launch or manual Recon retries.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <nav className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div
            className="flex items-center gap-2 cursor-pointer hover:opacity-90 active:scale-95 transition-all"
            onClick={() => navigate('/')}
          >
            <img src="/android-chrome-192x192.png" alt="GOATIE Logo" className="w-8 h-8 rounded-md" />
            <span className="font-bold text-xl">GOATIE</span>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className="rounded-full"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {user && (
              <>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/admin')}
                  >
                    Admin
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSyncModalOpen(true)}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Sync Status
                </Button>
                <div className="flex flex-col items-start gap-0.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleReconNow()}
                    className="gap-2"
                    isLoading={reconciling}
                    disabled={reconciling}
                  >
                    <Cloud className="h-4 w-4" />
                    Recon Now
                  </Button>
                  <span
                    className="text-[11px] leading-none text-muted-foreground px-1"
                    title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Master sheet has never been synced'}
                  >
                    {reconciling ? 'Syncing…' : formatLastSync(lastSyncAt)}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">{user.displayName}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                >
                  Logout
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <div id="mobile-menu" className="md:hidden pb-4 flex flex-col gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className="justify-start"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </Button>

            {user && (
              <>
                <div className="px-3 py-2 text-sm">{user.displayName}</div>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { navigate('/admin'); setMenuOpen(false); }}
                    className="justify-start"
                  >
                    Admin
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setSyncModalOpen(true); setMenuOpen(false); }}
                  className="justify-start gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Sync Status
                </Button>
                <div className="flex flex-col items-start gap-0.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { void handleReconNow(); setMenuOpen(false); }}
                    className="justify-start gap-2"
                    isLoading={reconciling}
                    disabled={reconciling}
                  >
                    <Cloud className="h-4 w-4" />
                    Recon Now
                  </Button>
                  <span
                    className="text-[11px] leading-none text-muted-foreground px-3"
                    title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Master sheet has never been synced'}
                  >
                    {reconciling ? 'Syncing…' : formatLastSync(lastSyncAt)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="justify-start"
                >
                  Logout
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <SyncQueueModal 
        isOpen={syncModalOpen} 
        onClose={() => setSyncModalOpen(false)} 
      />
    </nav>
  );
};
