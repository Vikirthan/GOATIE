import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminMocks = vi.hoisted(() => ({
  listAdminUsers: vi.fn(),
  getHerdOverview: vi.fn(),
  getProfiles: vi.fn(),
  assignHerd: vi.fn(),
  unassignHerd: vi.fn(),
  createAdminUser: vi.fn(),
  sendPasswordReset: vi.fn(),
  setUserBanned: vi.fn(),
  setUserRole: vi.fn(),
}));

vi.mock('@/services/adminService', () => adminMocks);

import { AdminPage } from '@/pages/AdminPage';

const USERS = [
  { id: 'u-admin', email: 'admin@x.com', displayName: 'Boss', role: 'admin', banned: false, herds: [] },
  { id: 'u-rkt', email: 'rkt@x.com', displayName: 'RKT', role: 'farmer', banned: false, herds: ['u-rkt'] },
];

const PROFILES = [
  { userId: 'u-admin', displayName: 'Boss' },
  { userId: 'u-rkt', displayName: 'RKT' },
  { userId: 'u-new', displayName: 'Newbie' },
];

const HERD_OVERVIEW = {
  memberships: [{ herd_id: 'u-rkt', user_id: 'u-rkt' }],
  goatCounts: { 'u-rkt': 90 },
};

let toasts: { title: string }[] = [];
let onToast: ((e: Event) => void) | null = null;

beforeEach(() => {
  toasts = [];
  if (onToast) window.removeEventListener('showToast', onToast);
  onToast = (e: Event) => {
    toasts.push((e as CustomEvent).detail);
  };
  window.addEventListener('showToast', onToast);
  adminMocks.listAdminUsers.mockResolvedValue(USERS);
  adminMocks.getHerdOverview.mockResolvedValue(HERD_OVERVIEW);
  adminMocks.getProfiles.mockResolvedValue(PROFILES);
  for (const fn of [
    adminMocks.assignHerd, adminMocks.unassignHerd, adminMocks.createAdminUser,
    adminMocks.sendPasswordReset, adminMocks.setUserBanned, adminMocks.setUserRole,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

async function openUsersTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Users \(2\)/ }));
}

// The custom Select renders a button[role=combobox] whose accessible name
// computes empty in jsdom — locate it by visible text instead.
function comboboxWithText(text: string) {
  const boxes = screen.getAllByRole('combobox');
  const found = boxes.find((el) => el.textContent === text);
  if (!found) throw new Error(`combobox showing "${text}" not found`);
  return found;
}

describe('AdminPage herds tab', () => {
  it('shows herd names, goat counts, and members — never raw ids', async () => {
    render(<AdminPage />);
    expect(await screen.findByText("RKT's herd")).toBeInTheDocument();
    expect(screen.getByText(/90 goats · 1 farmer/)).toBeInTheDocument();
    expect(screen.getByText('RKT')).toBeInTheDocument();
    expect(screen.queryByText('u-rkt')).not.toBeInTheDocument();
  });

  it('locks the owner’s self-membership but allows removing others', async () => {
    adminMocks.getHerdOverview.mockResolvedValue({
      memberships: [
        { herd_id: 'u-rkt', user_id: 'u-rkt' },
        { herd_id: 'u-rkt', user_id: 'u-new' },
      ],
      goatCounts: { 'u-rkt': 90 },
    });
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("RKT's herd");

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    expect(removeButtons[0]).toBeDisabled();
    expect(removeButtons[1]).not.toBeDisabled();

    await user.click(removeButtons[1]);
    await waitFor(() => {
      expect(adminMocks.unassignHerd).toHaveBeenCalledWith('u-rkt', 'u-new');
    });
  });

  it('assigns a picked login to the herd', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("RKT's herd");

    await user.click(comboboxWithText('Select login…'));
    await user.click(screen.getByRole('option', { name: 'Newbie' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));

    await waitFor(() => {
      expect(adminMocks.assignHerd).toHaveBeenCalledWith('u-rkt', 'u-new');
    });
  });

  it('degrades gracefully when /api is down: herds still load', async () => {
    adminMocks.listAdminUsers.mockRejectedValue(new Error('nope'));
    render(<AdminPage />);
    expect(await screen.findByText("RKT's herd")).toBeInTheDocument();
    expect(screen.getByText(/\/api/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Users/ }));
    // Banner (top) + users-tab notice use different wording — assert both.
    expect(screen.getByText(/Herd viewing and assignment below/)).toBeInTheDocument();
    expect(screen.getByText(/User management is unavailable here/)).toBeInTheDocument();
  });

  it('toasts action failures instead of failing silently', async () => {
    adminMocks.getHerdOverview.mockResolvedValue({
      memberships: [
        { herd_id: 'u-rkt', user_id: 'u-rkt' },
        { herd_id: 'u-rkt', user_id: 'u-new' },
      ],
      goatCounts: { 'u-rkt': 90 },
    });
    adminMocks.unassignHerd.mockRejectedValue(new Error('RLS says no'));
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("RKT's herd");
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await user.click(removeButtons[1]);
    await waitFor(() => {
      expect(toasts.some((t) => t.title === 'Action failed')).toBe(true);
    });
  });
});

describe('AdminPage users tab', () => {
  it('creates a login from the form', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("RKT's herd");
    await openUsersTab(user);

    await user.type(screen.getByLabelText('Name'), 'Helper');
    await user.type(screen.getByLabelText('Email *'), 'helper@x.com');
    await user.type(screen.getByLabelText('Password * (min 6)'), 'secret12');
    await user.click(screen.getByRole('button', { name: 'Create login' }));

    await waitFor(() => {
      expect(adminMocks.createAdminUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'helper@x.com', displayName: 'Helper' }),
      );
    });
  });

  it('resets passwords and toggles bans per user', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("RKT's herd");
    await openUsersTab(user);

    const resetButtons = screen.getAllByRole('button', { name: 'Reset password' });
    await user.click(resetButtons[1]);
    await waitFor(() => {
      expect(adminMocks.sendPasswordReset).toHaveBeenCalledWith('u-rkt');
    });

    await user.click(screen.getAllByRole('button', { name: 'Disable' })[1]);
    await waitFor(() => {
      expect(adminMocks.setUserBanned).toHaveBeenCalledWith('u-rkt', true);
    });
  });

  it('changes roles through the role picker', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByText("RKT's herd");
    await openUsersTab(user);

    await user.click(comboboxWithText('Farmer'));
    await user.click(screen.getByRole('option', { name: 'Admin' }));
    await waitFor(() => {
      expect(adminMocks.setUserRole).toHaveBeenCalledWith('u-rkt', 'admin');
    });
  });
});
