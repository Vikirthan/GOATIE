import React, { useState } from 'react';
import { Menu, X, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { logout } from '@/services/authService';
import { showToast } from '@/components/common/Toast';

export const Navbar: React.FC = () => {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      showToast('success', 'Logged out successfully');
    } catch (error) {
      showToast('error', 'Failed to logout');
    }
  };

  return (
    <nav className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white font-bold">
              G
            </div>
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
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <div className="md:hidden pb-4 flex flex-col gap-2">
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
