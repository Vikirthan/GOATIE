import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MonthPicker } from '@/components/common/MonthPicker';

describe('MonthPicker', () => {
  it('shows the selected month on the button', () => {
    render(<MonthPicker value="2026-09" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pick month' })).toHaveTextContent('Sept 2026');
  });

  it('opens a calendar with 12 months and picks one', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MonthPicker value="2026-09" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Pick month' }));
    expect(screen.getByRole('dialog', { name: 'Month calendar' })).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();

    // Month text must stay readable on hover (accent bg is near-black in light mode).
    expect(screen.getByRole('button', { name: 'Oct' }).className).toContain('hover:text-accent-foreground');

    await user.click(screen.getByRole('button', { name: 'Oct' }));
    expect(onChange).toHaveBeenCalledWith('2026-10');
    expect(screen.queryByRole('dialog', { name: 'Month calendar' })).not.toBeInTheDocument();
  });

  it('navigates years without losing the selection', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MonthPicker value="2026-09" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Pick month' }));
    await user.click(screen.getByRole('button', { name: 'Next year' }));
    expect(screen.getByText('2027')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Jan' }));
    expect(onChange).toHaveBeenCalledWith('2027-01');
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<MonthPicker value="2026-09" onChange={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Pick month' }));
    expect(screen.getByRole('dialog', { name: 'Month calendar' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Month calendar' })).not.toBeInTheDocument();
  });
});
