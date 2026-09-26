import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { LoadingSpinner } from '@/components/common/Loaders';
import { showToast } from '@/components/common/Toast';
import { useAuth } from '@/context/AuthContext';
import * as indexedDB from '@/lib/indexeddb';
import { OfflineAction, SyncHistoryItem } from '@/types';
import { forceSync } from '@/services/firebaseService';
import { updateUserDisplayName } from '@/services/authService';
import { format } from 'date-fns';
import { CheckCircle, Clock, Cloud, Download, RefreshCw, Save, UserRound } from 'lucide-react';
import {
  fetchMasterSyncStatus,
  resolveLastSyncAt,
  restoreFromSheets,
  restoreToDatabase,
  triggerMasterSync,
} from '@/services/masterSheetsSync';

function formatLastSync(ts: number | null): string {
  if (!ts) return 'Not synced yet';
  return `Last sync ${format(new Date(ts), 'd MMM, h:mm a')}`;
}

export const SettingsPage: React.FC = () => {
  const { user, activeHerdId } = useAuth();
  const [reconciling, setReconciling] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [rewriteMonth, setRewriteMonth] = useState<string | null>(null);
  const [pending, setPending] = useState<OfflineAction[]>([]);
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const loadData = async () => {
    try {
      const q = await indexedDB.getAllItems<OfflineAction>('offlineQueue');
      const h = await indexedDB.getAllItems<SyncHistoryItem>('syncHistory');
      h.sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime());
      setPending(q);
      setHistory(h);
    } catch (err) {
      console.error('Failed to load sync queue', err);
    }
    try {
      const status = await fetchMasterSyncStatus();
      setLastSyncAt(status.lastSyncAt);
      setRewriteMonth(status.rewriteMonth);
    } catch {
      // Server status unavailable (offline / unconfigured) — push timestamps
      // below still update after each successful sync on this device.
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setDisplayName(user?.displayName || '');
  }, [user?.displayName]);

  useEffect(() => {
    if (window.location.hash !== '#profile') return;
    requestAnimationFrame(() => document.getElementById('profile')?.scrollIntoView({ block: 'start' }));
  }, []);

  // ── Recon Now: pushes the current DB state to the ONE master spreadsheet
  // via the server route (all secrets stay in Vercel env). Every push ends
  // with prune + full id list, so the sheet is verified against current app
  // data daily — deletes propagate the same day. Once a month the push is a
  // full erase + re-fetch as new. The timestamp comes from the server, so it
  // agrees across devices.
  const runPush = async (silent: boolean, setBusy: (v: boolean) => void, successTitle: (full: boolean) => string) => {
    if (!user) {
      if (!silent) showToast('error', 'Sync failed', 'You must be signed in');
      return false;
    }
    setBusy(true);
    try {
      const result = await triggerMasterSync();
      if (!result.ok) throw new Error(result.error || 'Sync failed');
      const totals = (result.tabs ?? []).reduce(
        (acc, s) => ({
          added: acc.added + s.added,
          updated: acc.updated + s.updated,
          deleted: acc.deleted + s.deleted,
        }),
        { added: 0, updated: 0, deleted: 0 },
      );
      try {
        const status = await fetchMasterSyncStatus();
        setLastSyncAt(resolveLastSyncAt(status, result));
        setRewriteMonth(status.rewriteMonth);
      } catch {
        if (result.ranAt) setLastSyncAt(result.ranAt);
      }
      if (!silent) {
        showToast(
          'success',
          successTitle(!!result.fullRewrite),
          `+${totals.added} added · ${totals.updated} updated · ${totals.deleted} removed` +
            (result.fullRewrite ? ' · monthly full rewrite' : ''),
        );
      }
      return true;
    } catch (error: unknown) {
      if (!silent) showToast('error', 'Sync failed', error instanceof Error ? error.message : 'Sync failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleReconNow = () => void runPush(false, setReconciling, (full) => (full ? 'Master sheet rewritten!' : 'Sheets reconciled!'));
  const handleVerifySheets = () => void runPush(false, setVerifying, (full) => (full ? 'Master sheet rewritten!' : 'Master sheet verified!'));

  // DB-lost recovery: pull all 4 tabs back (incremental — skips ids present).
  const handleRestore = async () => {
    if (!user) return;
    if (!window.confirm('Restore missing records from the Master Sheet into the database? Existing records are kept.')) return;
    setRestoring(true);
    try {
      const fetched = await restoreFromSheets();
      if (!fetched.ok || !fetched.data) throw new Error(fetched.error || 'Restore failed');
      // Restored goats anchor to the active herd (RLS: caller must be a
      // member of it — enforced server-side on insert).
      const written = await restoreToDatabase(activeHerdId ?? user.id, fetched.data);
      if (!written.ok) throw new Error(written.error || 'Restore failed');
      const a = written.added;
      window.dispatchEvent(new Event('data-synced'));
      showToast(
        'success',
        'Restore complete!',
        `+${a.goats} goats · +${a.weights} weights · +${a.dewormings} deworming · +${a.vaccinations} vaccinations · ${written.skipped} already present`,
      );
    } catch (err) {
      showToast('error', 'Restore failed', err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  const handleSync = async () => {
    if (!user) return;
    if (!navigator.onLine) {
      showToast('error', 'You are currently offline.');
      return;
    }
    setIsSyncing(true);
    try {
      await forceSync(user.id);
      await loadData();
      showToast('success', 'Sync completed successfully!');
    } catch (err) {
      console.error(err);
      showToast('error', 'Sync failed. Try again later.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleProfileSave = async () => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      showToast('error', 'Enter a display name');
      return;
    }
    if (trimmedName === user?.displayName) return;

    setSavingProfile(true);
    try {
      const updatedUser = await updateUserDisplayName(trimmedName);
      setDisplayName(updatedUser.displayName);
      showToast('success', 'Profile updated');
    } catch (err) {
      showToast('error', 'Could not update profile', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setSavingProfile(false);
    }
  };

  if (!user) return <LoadingSpinner message="Loading settings..." />;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-0.5">Sync, backups, and restore</p>
      </div>

      <Card id="profile" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            Profile
          </CardTitle>
          <CardDescription>
            Change the name shown in your account, herd member lists, and navigation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              void handleProfileSave();
            }}
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="profile-display-name">Display name</Label>
              <Input
                id="profile-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Enter your name"
                autoComplete="name"
                maxLength={80}
              />
            </div>
            <Button type="submit" disabled={savingProfile} isLoading={savingProfile} className="w-full sm:w-auto">
              {!savingProfile && <Save className="mr-2 h-4 w-4" />}
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Master Sheets backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-sky-500" />
            Master Sheets backup
          </CardTitle>
          <CardDescription>
            One master spreadsheet (Goats Data · Monthly Weights · Deworming · Vaccination),
            verified against the View Goats page every day. Once a month it is erased and
            re-fetched as new. Restores pull missing records back after DB loss.
            Credentials live on the server (Vercel env) — nothing to paste here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="text-xs text-muted-foreground"
            title={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : 'Master sheet has never been synced'}
          >
            {reconciling || verifying
              ? 'Syncing…'
              : formatLastSync(lastSyncAt)}
            {rewriteMonth ? ` · monthly rewrite ${rewriteMonth}` : ''}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleReconNow}
              disabled={reconciling}
              size="sm"
              variant="primary"
              className="flex items-center gap-2"
              isLoading={reconciling}
            >
              <Cloud className="h-4 w-4" />
              {reconciling ? 'Syncing…' : 'Recon Now'}
            </Button>
            <Button
              onClick={handleVerifySheets}
              disabled={verifying}
              size="sm"
              variant="outline"
              className="flex items-center gap-2"
              isLoading={verifying}
            >
              {verifying ? 'Verifying…' : 'Verify now'}
            </Button>
            <Button
              onClick={() => void handleRestore()}
              disabled={restoring}
              size="sm"
              variant="outline"
              className="flex items-center gap-2"
              isLoading={restoring}
            >
              <Download className="h-4 w-4" />
              {restoring ? 'Restoring…' : 'Restore from sheets'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Offline sync */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-emerald-500" />
            Offline sync
          </CardTitle>
          <CardDescription>
            Edits made offline wait here and push automatically on reconnect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Pending actions ({pending.length})
            </h3>
            <Button
              onClick={() => void handleSync()}
              disabled={isSyncing || pending.length === 0}
              size="sm"
              variant="primary"
              className="flex items-center gap-2"
              isLoading={isSyncing}
            >
              <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Force Sync'}
            </Button>
          </div>

          {pending.length === 0 ? (
            <div className="p-4 bg-muted/20 rounded-lg text-center text-muted-foreground border border-border">
              All caught up! No pending edits.
            </div>
          ) : (
            <ul className="space-y-3">
              {pending.map((action) => (
                <li key={action.id} className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    {action.type === 'create' ? 'Goat creation pending' :
                      action.type === 'update' ? `Goat ${action.data.updates?.earTagNumber || 'edit'} pending` :
                        'Action pending'}
                  </span>
                  <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/20 px-2 py-1 rounded-full">Queued</span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              Sync history
            </h3>
            {history.length === 0 ? (
              <div className="p-4 bg-muted/20 rounded-lg text-center text-muted-foreground border border-border">
                No recent sync history.
              </div>
            ) : (
              <ul className="space-y-3">
                {history.slice(0, 20).map((item) => (
                  <li key={item.id} className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex flex-col">
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">{item.description}</span>
                    <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-1">
                      {new Date(item.syncedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
