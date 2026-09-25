import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, Moon, Sun, Settings } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { logout } from '@/services/authService';
import { showToast } from '@/components/common/Toast';
import {
  fetchMasterSyncStatus,
  needsDailyPush,
  triggerMasterSync,
} from '@/services/masterSheetsSync';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const autoSynced = useRef(false);

  const handleLogout = async () => {
    try {
      await logout();
      showToast('success', 'Logged out successfully');
    } catch (error) {
      showToast('error', 'Failed to logout');
    }
  };

  // Once-a-day auto push on app launch (silent): the server timestamp decides —
  // if the last successful sync happened on a previous calendar day, push so
  // the master sheet never goes stale. Manual controls live in Settings.
  useEffect(() => {
    if (!user || autoSynced.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchMasterSyncStatus();
        if (cancelled) return;
        if (!navigator.onLine || !needsDailyPush(status.lastSyncAt)) return;
        autoSynced.current = true;
        const result = await triggerMasterSync();
        if (!result.ok) throw new Error(result.error || 'Sync failed');
        window.dispatchEvent(new Event('data-synced'));
      } catch {
        // Silent: a missing server config or offline launch just skips;
        // next launch or manual Recon in Settings retries.
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
                <span className="text-sm text-muted-foreground">{user.displayName}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/settings')}
                  className="rounded-full"
                  aria-label="Settings"
                  title="Settings — sync, backups, restore"
                >
                  <Settings className="h-4 w-4" />
                </Button>
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
                  onClick={() => { navigate('/settings'); setMenuOpen(false); }}
                  className="justify-start gap-2"
                >
                  <Settings className="h-4 w-4" />
                  Settings
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
    </nav>
  );
};
