import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { Navbar } from '@/components/common/Navbar';
import { ToastContainer } from '@/components/common/Toast';
import { ProtectedRoute } from '@/components/common/ProtectedRoute';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { GoatRegistrationPage } from '@/pages/GoatRegistrationPage';
import { GoatsListPage } from '@/pages/GoatsListPage';
import { GoatDetailPage } from '@/pages/GoatDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

export const App: React.FC = () => {
  return (
    <Router>
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Protected Routes */}
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <div className="flex flex-col min-h-screen">
                    <Navbar />
                    <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
                      <Routes>
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/goats" element={<GoatsListPage />} />
                        <Route path="/goats/register" element={<GoatRegistrationPage />} />
                        <Route path="/goats/:id" element={<GoatDetailPage />} />
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route path="*" element={<NotFoundPage />} />
                      </Routes>
                    </main>
                    <footer className="border-t py-4 text-center text-xs text-muted-foreground bg-muted/20">
                      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
                        <span>&copy; {new Date().getFullYear()} GOATIE. All rights reserved.</span>
                        {(() => {
                          // @ts-ignore
                          const buildTimeStr = import.meta.env.VITE_APP_BUILD_TIME;
                          if (!buildTimeStr) return null;
                          try {
                            const date = new Date(buildTimeStr);
                            const formatted = date.toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true
                            });
                            return (
                              <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>V.1 Goatie • Deployment: {formatted}</span>
                              </div>
                            );
                          } catch (e) {
                            return null;
                          }
                        })()}
                      </div>
                    </footer>
                  </div>
                </ProtectedRoute>
              }
            />
          </Routes>

          <ToastContainer />
        </AuthProvider>
      </ThemeProvider>
    </Router>
  );
};

export default App;
