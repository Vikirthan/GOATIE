import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: { isAuthenticated: false, isAdmin: false, loading: false },
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
    authState.value = { isAuthenticated: false, isAdmin: false, loading: true };
    renderAtAdmin();
    expect(screen.queryByText('secret-admin')).not.toBeInTheDocument();
    expect(screen.queryByText('login-page')).not.toBeInTheDocument();
  });

  it('redirects signed-out users to login', () => {
    authState.value = { isAuthenticated: false, isAdmin: false, loading: false };
    renderAtAdmin();
    expect(screen.getByText('login-page')).toBeInTheDocument();
  });

  it('redirects non-admin farmers to the dashboard', () => {
    authState.value = { isAuthenticated: true, isAdmin: false, loading: false };
    renderAtAdmin();
    expect(screen.getByText('dashboard-page')).toBeInTheDocument();
    expect(screen.queryByText('secret-admin')).not.toBeInTheDocument();
  });

  it('renders for admins', () => {
    authState.value = { isAuthenticated: true, isAdmin: true, loading: false };
    renderAtAdmin();
    expect(screen.getByText('secret-admin')).toBeInTheDocument();
  });
});
