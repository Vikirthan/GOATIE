import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { isAuthenticated: false, isAdmin: false, loading: false, role: null as null | 'farmer' | 'admin' },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState.value,
}));

import { AdminRoute } from '@/components/common/AdminRoute';

function renderAtAdmin() {
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminRoute>secret-admin</AdminRoute>} />
        <Route path="/login" element={<div>login-page</div>} />
        <Route path="/dashboard" element={<div>dashboard-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute', () => {
  it('shows a spinner while permissions resolve', () => {
    authState.value = { isAuthenticated: false, isAdmin: false, loading: true, role: null };
    renderAtAdmin();
    expect(screen.queryByText('secret-admin')).not.toBeInTheDocument();
    expect(screen.queryByText('login-page')).not.toBeInTheDocument();
  });

  it('redirects signed-out users to login', () => {
    authState.value = { isAuthenticated: false, isAdmin: false, loading: false, role: null };
    renderAtAdmin();
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });

  it('waits for the role to resolve instead of bouncing admins', () => {
    authState.value = { isAuthenticated: true, isAdmin: false, loading: false, role: null };
    renderAtAdmin();
    expect(screen.getByText('Checking permissions...')).toBeInTheDocument();
    expect(screen.queryByText('dashboard-page')).not.toBeInTheDocument();
    expect(screen.queryByText('secret-admin')).not.toBeInTheDocument();
  });

  it('redirects non-admin farmers to the dashboard', () => {
    authState.value = { isAuthenticated: true, isAdmin: false, loading: false, role: 'farmer' };
    renderAtAdmin();
    expect(screen.getByText('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByText('secret-admin')).not.toBeInTheDocument();
  });

  it('renders for admins', () => {
    authState.value = { isAuthenticated: true, isAdmin: true, loading: false, role: 'admin' };
    renderAtAdmin();
    expect(screen.getByText('secret-admin')).toBeInTheDocument();
  });
});
