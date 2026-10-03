import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deadMocks = vi.hoisted(() => ({
  getFarmerGoats: vi.fn(),
  recordDeath: vi.fn(),
}));

vi.mock('@/services/firebaseService', () => deadMocks);

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', displayName: 'Me' },
    activeHerdId: 'me',
    viewingHerdId: null,
    isWritable: () => true,
    readOnlyView: false,
    herdIds: ['me'],
    displayNameById: {},
    setViewingHerdId: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { DeadPage } from '@/pages/DeadPage';
import type { Goat } from '@/types';

const DEAD: Goat[] = [
  {
    id: 'd1', earTagNumber: 'D1', farmerId: 'me',
    purchaseDate: new Date('2026-01-05'), purchaseWeight: 10, variant: 'SEMMARI',
    gender: 'male', purchasePrice: 1000, sellerName: 'S', status: 'deceased',
    deathDate: new Date('2026-09-10'),
    createdAt: new Date('2026-01-05'), updatedAt: new Date('2026-09-10'),
  } as Goat,
  {
    id: 'd2', earTagNumber: 'D2', farmerId: 'me',
    purchaseDate: new Date('2026-02-05'), purchaseWeight: 12, variant: 'VELLADU',
    gender: 'female', purchasePrice: 2000, sellerName: 'S', status: 'deceased',
    createdAt: new Date('2026-02-05'), updatedAt: new Date('2026-09-12'),
  } as Goat,
];

const ACTIVE: Goat[] = [
  {
    id: 'a1', earTagNumber: 'A1', farmerId: 'me',
    purchaseDate: new Date('2026-03-05'), purchaseWeight: 11, variant: 'LOCAL',
    gender: 'male', purchasePrice: 1500, sellerName: 'S', status: 'active',
    createdAt: new Date('2026-03-05'), updatedAt: new Date('2026-03-05'),
  } as Goat,
];

let toasts: { type: string; title: string }[] = [];

beforeEach(() => {
  toasts = [];
  deadMocks.getFarmerGoats.mockImplementation(async (_uid: string, status?: string) =>
    status === 'active' ? ACTIVE : DEAD,
  );
  deadMocks.recordDeath.mockResolvedValue(undefined);
  window.addEventListener('showToast', (e: Event) => {
    toasts.push((e as CustomEvent).detail);
  });
});

describe('DeadPage', () => {
  it('lists deceased goats with death dates and total loss', async () => {
    render(<DeadPage />);
    expect(await screen.findByText('Dead Goats')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /D1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /D2/ })).toBeInTheDocument();
    // Explicit death date vs updatedAt fallback.
    expect(screen.getByText('Deceased 10/09/2026')).toBeInTheDocument();
    expect(screen.getByText('Deceased 12/09/2026')).toBeInTheDocument();
    expect(screen.getByText(/2 deceased · purchase loss/)).toBeInTheDocument();
  });

  it('filters by ear tag search', async () => {
    const user = userEvent.setup();
    render(<DeadPage />);
    await screen.findByText('D1');

    await user.type(screen.getByPlaceholderText('Search by ear tag...'), 'D2');
    expect(screen.queryByRole('button', { name: /D1/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /D2/ })).toBeInTheDocument();
  });

  it('records a death from the modal and toasts', async () => {
    const user = userEvent.setup();
    render(<DeadPage />);
    await screen.findByText('D1');

    await user.click(screen.getByRole('button', { name: /Log Death/ }));
    const dialog = await screen.findByText('Mark an active goat as deceased with its death date');
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search Goat (Ear Tag)'), 'A1');
    const option = await screen.findByText('A1');
    await user.click(option);

    await user.click(screen.getByRole('button', { name: 'Mark Deceased' }));
    await waitFor(() => {
      expect(deadMocks.recordDeath).toHaveBeenCalledWith('a1', expect.any(Date));
    });
    expect(toasts.some((t) => t.type === 'success')).toBe(true);
  });

  it('shows an empty state when no deaths are recorded', async () => {
    deadMocks.getFarmerGoats.mockImplementation(async (_uid: string, status?: string) =>
      status === 'active' ? [] : [],
    );
    render(<DeadPage />);
    expect(await screen.findByText('No death records')).toBeInTheDocument();
  });
});
