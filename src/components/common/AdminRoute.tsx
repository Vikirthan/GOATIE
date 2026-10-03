import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { LoadingSpinner } from '@/components/common/Loaders';

/** Route gate for /admin — waits for the role to resolve, then requires admin. */
export const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isAdmin, role, loading } = useAuth();

  // loading=false no longer implies role has resolved (it unblocks on session
  // alone) — wait for role so admins aren't bounced to /dashboard mid-resolve.
  if (loading || (isAuthenticated && role === null)) {
    return <LoadingSpinner message="Checking permissions..." />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
