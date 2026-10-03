import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Flower2, Tag, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { LoadingSpinner, EmptyState } from '@/components/common/Loaders';
import { showToast } from '@/components/common/Toast';
import { HerdSwitcher } from '@/components/common/HerdSwitcher';
import { getFarmerGoats, recordDeath } from '@/services/firebaseService';
import type { Goat } from '@/types';
import { formatCurrency } from '@/utils/helpers';
import { format } from 'date-fns';

const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'N/A';
  try {
    return format(new Date(date), 'dd/MM/yyyy');
  } catch {
    return 'N/A';
  }
};

export const DeadPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, viewingHerdId, isWritable, readOnlyView } = useAuth();
  const [deadGoats, setDeadGoats] = useState<Goat[]>([]);
  const [activeGoats, setActiveGoats] = useState<Goat[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showDeathModal, setShowDeathModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deathGoatId, setDeathGoatId] = useState('');
  const [deathGoatSearch, setDeathGoatSearch] = useState('');
  const [showDeathDropdown, setShowDeathDropdown] = useState(false);
  const [deathDate, setDeathDate] = useState(new Date().toISOString().split('T')[0]);
  const deathRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [dead, active] = await Promise.all([
        getFarmerGoats(user.id, 'deceased'),
        getFarmerGoats(user.id, 'active'),
      ]);
      const scopedDead = viewingHerdId ? dead.filter((g) => g.farmerId === viewingHerdId) : dead;
      const scopedActive = viewingHerdId ? active.filter((g) => g.farmerId === viewingHerdId) : active;
      scopedDead.sort(
        (a, b) =>
          new Date(b.deathDate ?? b.updatedAt).getTime() - new Date(a.deathDate ?? a.updatedAt).getTime(),
      );
      setDeadGoats(scopedDead);
      setActiveGoats(scopedActive);
    } catch (err: any) {
      showToast('error', 'Failed to load death records', err?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, viewingHerdId]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (deathRef.current && !deathRef.current.contains(event.target as Node)) setShowDeathDropdown(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const totalLoss = deadGoats.reduce((sum, g) => sum + (Number(g.purchasePrice) || 0), 0);

  const filtered = deadGoats.filter((g) =>
    String(g.earTagNumber || '').toLowerCase().includes(search.toLowerCase()),
  );

  const handleDeathSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deathGoatId) {
      showToast('error', 'Please search and select a goat');
      return;
    }
    const target = activeGoats.find((g) => g.id === deathGoatId);
    if (!target) return;
    if (!isWritable(target.farmerId)) {
      showToast('error', 'View-only herd', 'You can look at this herd but cannot record into it.');
      return;
    }
    if (!deathDate) {
      showToast('error', 'Pick the death date');
      return;
    }
    setSubmitting(true);
    try {
      await recordDeath(deathGoatId, new Date(deathDate));
      showToast('success', `Goat ${target.earTagNumber} marked deceased`, `Loss ${formatCurrency(target.purchasePrice, 'INR')}`);
      setShowDeathModal(false);
      setDeathGoatId('');
      setDeathGoatSearch('');
      setDeathDate(new Date().toISOString().split('T')[0]);
      await load();
      window.dispatchEvent(new Event('data-synced'));
    } catch (err: any) {
      showToast('error', 'Failed to record death', err?.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return <LoadingSpinner message="Loading death records..." />;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Flower2 className="h-6 w-6 text-slate-500" />
            Dead Goats
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {deadGoats.length} deceased · purchase loss {formatCurrency(totalLoss, 'INR')}
          </p>
        </div>
        <HerdSwitcher />
      </div>

      {readOnlyView && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          Viewing another herd — read-only. Recording deaths is disabled here.
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by ear tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button
          variant="primary"
          onClick={() => {
            setDeathGoatId('');
            setDeathGoatSearch('');
            setDeathDate(new Date().toISOString().split('T')[0]);
            setShowDeathModal(true);
          }}
          disabled={activeGoats.length === 0 || readOnlyView}
          title={readOnlyView ? 'Switch to a writable herd to record' : undefined}
        >
          <Flower2 className="h-4 w-4 mr-1" /> Log Death
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading death records..." />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No death records"
          description={search ? 'Try adjusting your search' : 'Deceased goats will appear here with their death dates'}
        />
      ) : (
        <ul className="space-y-3">
          {filtered.map((goat) => (
            <li key={goat.id}>
              <button
                onClick={() => navigate(`/goats/${goat.id}`)}
                className="w-full text-left rounded-xl border border-border bg-card p-4 hover:border-primary/30 hover:bg-accent transition-all"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-2 font-semibold">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    {goat.earTagNumber}
                    <span className="text-xs font-normal text-muted-foreground">{goat.variant}</span>
                  </span>
                  <span className="text-sm font-bold text-red-500">
                    −{formatCurrency(goat.purchasePrice, 'INR')}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Purchased {formatDate(goat.purchaseDate)}</span>
                  <span className="font-medium text-foreground">Deceased {formatDate(goat.deathDate ?? goat.updatedAt)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showDeathModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md bg-card shadow-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Flower2 className="h-5 w-5 text-slate-500" />
                    Log Death
                  </CardTitle>
                  <CardDescription>Mark an active goat as deceased with its death date</CardDescription>
                </div>
                <button onClick={() => setShowDeathModal(false)} className="p-2 rounded-lg hover:bg-accent transition-colors" aria-label="Close log death">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDeathSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="deathGoatSearch">Search Goat (Ear Tag)</Label>
                  <div ref={deathRef} className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <input
                        id="deathGoatSearch"
                        className="w-full h-10 pl-9 pr-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                        placeholder="Type ear tag number..."
                        value={deathGoatSearch}
                        onChange={(e) => { setDeathGoatSearch(e.target.value); setShowDeathDropdown(true); }}
                        onFocus={() => setShowDeathDropdown(true)}
                        autoComplete="off"
                      />
                    </div>
                    {showDeathDropdown && (
                      <div className="absolute z-20 w-full bg-card border border-input rounded-lg mt-1 max-h-44 overflow-y-auto shadow-xl">
                        {activeGoats
                          .filter((g) => String(g.earTagNumber || '').toLowerCase().includes(deathGoatSearch.toLowerCase()))
                          .map((g) => (
                            <div
                              key={g.id}
                              className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-accent text-sm transition-colors ${g.id === deathGoatId ? 'bg-primary/10 font-semibold' : ''}`}
                              onClick={() => { setDeathGoatId(g.id); setDeathGoatSearch(g.earTagNumber); setShowDeathDropdown(false); }}
                            >
                              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span>{g.earTagNumber}</span>
                              <span className="text-muted-foreground text-xs ml-auto">{g.variant}</span>
                            </div>
                          ))}
                        {activeGoats.filter((g) => String(g.earTagNumber || '').toLowerCase().includes(deathGoatSearch.toLowerCase())).length === 0 && (
                          <div className="px-3 py-2.5 text-sm text-muted-foreground">No matching active goats</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <Label htmlFor="deathDate">Death Date</Label>
                  <Input
                    id="deathDate"
                    type="date"
                    value={deathDate}
                    onChange={(e) => setDeathDate(e.target.value)}
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" type="button" onClick={() => setShowDeathModal(false)}>Cancel</Button>
                  <Button variant="primary" type="submit" isLoading={submitting}>Mark Deceased</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};
