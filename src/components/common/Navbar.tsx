import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, Moon, Sun, RefreshCw, Cloud } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { logout } from '@/services/authService';
import { showToast } from '@/components/common/Toast';
import { SyncQueueModal } from '@/components/common/SyncQueueModal';
import { supabase } from '@/lib/supabase';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      showToast('success', 'Logged out successfully');
    } catch (error) {
      showToast('error', 'Failed to logout');
    }
  };

  // ── Recon Now: reconciles the full (unfiltered) dataset into the Google Sheets backup ──
  const handleReconNow = async () => {
    setReconciling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast('error', 'Recon failed', 'You must be signed in'); return; }

      const res = await fetch('/api/recon-sheets', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Reconciliation failed');

      const totals = (body.summary as { tab: string; added: number; updated: number; deleted: number }[]).reduce(
        (acc, s) => ({ added: acc.added + s.added, updated: acc.updated + s.updated, deleted: acc.deleted + s.deleted }),
        { added: 0, updated: 0, deleted: 0 }
      );
      showToast(
        'success',
        'Sheets reconciled!',
        `+${totals.added} added · ${totals.updated} updated · ${totals.deleted} removed`
      );
    } catch (error: any) {
      showToast('error', 'Recon failed', error.message);
    } finally {
      setReconciling(false);
    }
  };

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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSyncModalOpen(true)}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Sync Status
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReconNow}
                  className="gap-2"
                  isLoading={reconciling}
                  disabled={reconciling}
                >
                  <Cloud className="h-4 w-4" />
                  Recon Now
                </Button>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setSyncModalOpen(true); setMenuOpen(false); }}
                  className="justify-start gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Sync Status
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { handleReconNow(); setMenuOpen(false); }}
                  className="justify-start gap-2"
                  isLoading={reconciling}
                  disabled={reconciling}
                >
                  <Cloud className="h-4 w-4" />
                  Recon Now
                </Button>
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
