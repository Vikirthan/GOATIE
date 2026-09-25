import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';

/**
 * Herd scope switcher for home/list pages. Shows every visible herd (own,
 * member, and — for admins — all herds). Picking a herd filters the view;
 * herds the login cannot write to are marked view-only and the app disables
 * write actions while viewing them. Hidden when there is only one herd.
 */
export const HerdSwitcher: React.FC<{ id?: string }> = ({ id = 'herd-switcher' }) => {
  const {
    herdIds,
    viewingHerdId,
    setViewingHerdId,
    isWritable,
    displayNameById,
    user,
  } = useAuth();

  if (!user || herdIds.length <= 1) return null;

  const labelFor = (herdId: string): string => {
    const name = displayNameById[herdId];
    const base = herdId === user.id ? 'My herd' : `${name || `Herd ${herdId.slice(0, 8)}…`}'s herd`;
    return isWritable(herdId) ? base : `${base} (view only)`;
  };

  return (
    <div className="min-w-[200px]">
      <Label htmlFor={id}>Herd</Label>
      <Select
        id={id}
        options={[
          { value: '', label: 'All herds' },
          ...herdIds.map((h) => ({ value: h, label: labelFor(h) })),
        ]}
        value={viewingHerdId ?? ''}
        onChange={(v) => setViewingHerdId(v === '' ? null : v)}
      />
    </div>
  );
};
