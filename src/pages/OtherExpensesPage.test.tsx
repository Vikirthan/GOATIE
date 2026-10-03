import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const expenseMocks = vi.hoisted(() => ({
  getFarmerGoats: vi.fn(),
  getOtherExpenses: vi.fn(),
  saveOtherExpense: vi.fn(),
  updateOtherExpense: vi.fn(),
  deleteOtherExpense: vi.fn(),
}));

vi.mock('@/services/firebaseService', () => expenseMocks);

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

import { OtherExpensesPage } from '@/pages/OtherExpensesPage';
import { currentMonthKey, monthKeyLabel } from '@/utils/expenses';
import type { OtherExpense } from '@/types';

let toasts: { type: string; title: string; message?: string }[] = [];

function expense(monthKey: string): OtherExpense {
  return {
    id: `e-${monthKey}`,
    farmerId: 'me',
    monthKey,
    expenseDate: new Date(`${monthKey}-01T00:00:00.000Z`),
    ilaiSelavu: 100,
    kuthagai: 200,
    medicineOthers: 30,
    sambalam: 400,
    petrol: 50,
    teaFood: 60,
    selavu: 60,
    total: 900,
    createdAt: new Date(`${monthKey}-15T00:00:00.000Z`),
    updatedAt: new Date(`${monthKey}-15T00:00:00.000Z`),
  };
}

beforeEach(() => {
  toasts = [];
  window.scrollTo = vi.fn();
  expenseMocks.getFarmerGoats.mockResolvedValue([]);
  expenseMocks.getOtherExpenses.mockResolvedValue([]);
  expenseMocks.saveOtherExpense.mockImplementation(async (_herd: string, month: string) => expense(month));
  expenseMocks.updateOtherExpense.mockResolvedValue(undefined);
  expenseMocks.deleteOtherExpense.mockResolvedValue(undefined);
  vi.stubGlobal('confirm', vi.fn(() => true));
  window.addEventListener('showToast', (e: Event) => {
    toasts.push((e as CustomEvent).detail);
  });
});

describe('OtherExpensesPage', () => {
  it('renders the month calendar and all 7 Tamil fields with rupee boxes', async () => {
    render(<OtherExpensesPage />);
    expect(await screen.findByText('Other Expenses')).toBeInTheDocument();
    for (const label of ['இவை செலவு', 'குத்தகை', 'Medicine & Others', 'சம்பளம்', 'பெட்ரோல்', 'டி & சாப்பாடு', 'செலவு']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Pick month' })).toHaveTextContent(monthKeyLabel(currentMonthKey()));
    expect(screen.getAllByText('₹').length).toBeGreaterThanOrEqual(7);
  });

  it('totals the fields live and saves the month', async () => {
    const user = userEvent.setup();
    render(<OtherExpensesPage />);
    await screen.findByText('Other Expenses');

    await user.type(screen.getByLabelText('இவை செலவு'), '100');
    await user.type(screen.getByLabelText('குத்தகை'), '200');
    expect(screen.getByText('₹300.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Save month entry/ }));
    await waitFor(() => {
      expect(expenseMocks.saveOtherExpense).toHaveBeenCalledWith(
        'me',
        currentMonthKey(),
        expect.objectContaining({ ilaiSelavu: '100', kuthagai: '200' }),
      );
    });
    expect(toasts.some((t) => t.type === 'success')).toBe(true);
  });

  it('fails loudly when the month already has an entry', async () => {
    const user = userEvent.setup();
    expenseMocks.saveOtherExpense.mockRejectedValue(
      new Error(`Entry for ${monthKeyLabel('2026-09')} already exists! Only one entry per month.`),
    );
    render(<OtherExpensesPage />);
    await screen.findByText('Other Expenses');

    await user.click(screen.getByRole('button', { name: /Save month entry/ }));
    await waitFor(() => {
      expect(toasts.some((t) => t.type === 'error' && t.title.includes('already exists!'))).toBe(true);
    });
  });

  it('lists month logs and edits one back into the form', async () => {
    const user = userEvent.setup();
    expenseMocks.getOtherExpenses.mockResolvedValue([expense('2026-08')]);
    render(<OtherExpensesPage />);
    expect(await screen.findByText('Aug 2026')).toBeInTheDocument();
    expect(screen.getByText('₹900.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByLabelText('குத்தகை')).toHaveValue(200);

    await user.click(screen.getByRole('button', { name: /Update entry/ }));
    await waitFor(() => {
      expect(expenseMocks.updateOtherExpense).toHaveBeenCalledWith(
        'e-2026-08',
        expect.objectContaining({ kuthagai: '200' }),
      );
    });
  });

  it('deletes a month log after confirm', async () => {
    const user = userEvent.setup();
    expenseMocks.getOtherExpenses.mockResolvedValue([expense('2026-08')]);
    render(<OtherExpensesPage />);
    await screen.findByText('Aug 2026');

    await user.click(screen.getByRole('button', { name: /Delete/ }));
    await waitFor(() => {
      expect(expenseMocks.deleteOtherExpense).toHaveBeenCalledWith('e-2026-08');
    });
  });

  it('picks a different month from the calendar', async () => {
    const user = userEvent.setup();
    render(<OtherExpensesPage />);
    await screen.findByText('Other Expenses');

    await user.click(screen.getByRole('button', { name: 'Pick month' }));
    const dialog = screen.getByRole('dialog', { name: 'Month calendar' });
    await user.click(within(dialog).getByRole('button', { name: 'Jan' }));
    expect(screen.getByRole('button', { name: 'Pick month' })).toHaveTextContent(/Jan \d{4}/);
  });

  it('lists months missing since first purchase as pending and fills one', async () => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 5);
    expenseMocks.getFarmerGoats.mockResolvedValue([{ farmerId: 'me', purchaseDate: start }]);
    expenseMocks.getOtherExpenses.mockResolvedValue([expense(currentMonthKey())]);
    render(<OtherExpensesPage />);

    expect(
      await screen.findByText('2 month(s) since your first purchase still need entries — fill them from your book.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('No entry yet — fill from your book')).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: /Fill entry/ })[0]);
    expect(screen.getByRole('button', { name: 'Pick month' })).toHaveTextContent(monthKeyLabel(prevKey));
  });
});
