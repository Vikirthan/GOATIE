import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  value: {
    user: { id: 'u1' },
    herdIds: ['u1'],
    viewingHerdId: null as string | null,
    setViewingHerdId: vi.fn(),
    isWritable: (_h: string): boolean => true,
    displayNameById: {} as Record<string, string>,
  },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => authState.value,
}));

import { HerdSwitcher } from '@/components/common/HerdSwitcher';

function comboboxWithText(text: string) {
  const found = screen.getAllByRole('combobox').find((el) => el.textContent === text);
  if (!found) throw new Error(`combobox showing "${text}" not found`);
  return found;
}

describe('HerdSwitcher', () => {
  it('renders nothing for a single herd', () => {
    authState.value = {
      user: { id: 'u1' },
      herdIds: ['u1'],
      viewingHerdId: null,
      setViewingHerdId: vi.fn(),
      isWritable: () => true,
      displayNameById: {},
    };
    const { container } = render(<HerdSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists herds with names and view-only markers, and switches', async () => {
    const setViewingHerdId = vi.fn();
    authState.value = {
      user: { id: 'u1' },
      herdIds: ['u1', 'herd-other'],
      viewingHerdId: null,
      setViewingHerdId,
      isWritable: (h: string) => h === 'u1',
      displayNameById: { u1: 'Me', 'herd-other': 'RKT' },
    };
    const user = userEvent.setup();
    render(<HerdSwitcher />);

    await user.click(comboboxWithText('All herds'));
    // Non-writable herd carries the marker; writable own herd does not.
    await user.click(screen.getByRole('option', { name: "RKT's herd (view only)" }));
    expect(setViewingHerdId).toHaveBeenCalledWith('herd-other');
  });

  it('selecting All herds clears the view scope', async () => {
    const setViewingHerdId = vi.fn();
    authState.value = {
      user: { id: 'u1' },
      herdIds: ['u1', 'h2'],
      viewingHerdId: 'h2',
      setViewingHerdId,
      isWritable: () => true,
      displayNameById: {},
    };
    const user = userEvent.setup();
    render(<HerdSwitcher />);
    // Button shows the current herd label; open and pick All herds.
    await user.click(comboboxWithText("Herd h2…'s herd"));
    await user.click(screen.getByRole('option', { name: 'All herds' }));
    expect(setViewingHerdId).toHaveBeenCalledWith(null);
  });
});
