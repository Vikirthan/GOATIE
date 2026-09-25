import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, RefreshCw, CheckCircle, Clock, Cloud, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import * as indexedDB from '@/lib/indexeddb';
import { OfflineAction, SyncHistoryItem } from '@/types';
import { forceSync } from '@/services/firebaseService';
import { useAuth } from '@/context/AuthContext';
import { showToast } from '@/components/common/Toast';
import {
  fetchMasterSyncStatus,
  resolveLastSyncAt,
  restoreFromSheets,
  restoreToDatabase,
  triggerMasterSync,
} from '@/services/masterSheetsSync';

interface SyncQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SyncQueueModal({ isOpen, onClose }: SyncQueueModalProps) {
  const [pending, setPending] = useState<OfflineAction[]>([]);
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { user, activeHerdId } = useAuth();
  const [verifying, setVerifying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [sheetsMeta, setSheetsMeta] = useState<{ lastSyncAt: number | null; rewriteMonth: string | null }>({
    lastSyncAt: null,
    rewriteMonth: null,
  });

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  const loadData = async () => {
    try {
      const q = await indexedDB.getAllItems<OfflineAction>('offlineQueue');
      const h = await indexedDB.getAllItems<SyncHistoryItem>('syncHistory');

      // Sort history newest first
      h.sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime());

      setPending(q);
      setHistory(h);
    } catch (err) {
      console.error('Failed to load sync queue', err);
    }
    try {
      const status = await fetchMasterSyncStatus();
      setSheetsMeta({ lastSyncAt: status.lastSyncAt, rewriteMonth: status.rewriteMonth });
    } catch (err) {
      console.error('Failed to load master sheets status', err);
    }
  };

  // Manual daily-verify push from the modal (same job as Recon Now).
  const handleVerifySheets = async () => {
    setVerifying(true);
    try {
      const result = await triggerMasterSync();
      if (!result.ok) throw new Error(result.error || 'Verify failed');
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
        setSheetsMeta({ lastSyncAt: resolveLastSyncAt(status, result), rewriteMonth: status.rewriteMonth });
      } catch {
        if (result.ranAt) setSheetsMeta((m) => ({ ...m, lastSyncAt: result.ranAt ?? m.lastSyncAt }));
      }
      showToast(
        'success',
        result.fullRewrite ? 'Master sheet rewritten!' : 'Master sheet verified!',
        `+${totals.added} added · ${totals.updated} updated · ${totals.deleted} removed` +
          (result.fullRewrite ? ' · monthly full rewrite' : ''),
      );
    } catch (err) {
      showToast('error', 'Verify failed', err instanceof Error ? err.message : 'Verify failed');
    } finally {
      setVerifying(false);
    }
  };

  // DB-lost recovery: pull all 4 tabs back (incremental — skips ids present).
  const handleRestore = async () => {
    if (!user) return;
    if (!window.confirm('Restore missing records from the Master Sheet into the database? Existing records are kept.')) return;
    setRestoring(true);
    try {
      const fetched = await restoreFromSheets();
      if (!fetched.ok || !fetched.data) throw new Error(fetched.error || 'Restore failed');
      // Restored goats are anchored to the active herd (RLS: caller must be a
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

  if (!isOpen) return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-card rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border flex items-center justify-between bg-muted/30">
          <div>
            <h2 className="text-xl font-bold text-foreground">Sync Status</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage your offline edits and history</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Pending Queue Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-500" />
                Pending Actions ({pending.length})
              </h3>
              <Button 
                onClick={handleSync} 
                disabled={isSyncing || pending.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
                size="sm"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Syncing...' : 'Force Sync'}
              </Button>
            </div>
            
            {pending.length === 0 ? (
              <div className="p-4 bg-muted/20 rounded-lg text-center text-muted-foreground border border-border">
                All caught up! No pending edits.
              </div>
            ) : (
              <ul className="space-y-3">
                {pending.map(action => (
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
          </section>

          {/* Master Sheets backup Section */}
          <section>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-2">
              <Cloud className="w-5 h-5 text-sky-500" />
              Master Sheets backup
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              One master spreadsheet (Goats Data · Monthly Weights · Deworming · Vaccination),
              verified against the View Goats page every day. Once a month it is erased and
              re-fetched as new. Restores pull missing records back after DB loss.
              Credentials live on the server (Vercel env) — nothing to paste here.
            </p>
            <div className="space-y-3 p-4 bg-muted/20 rounded-xl border border-border">
              <div className="text-xs text-muted-foreground">
                {sheetsMeta.lastSyncAt
                  ? `Last verify ${new Date(sheetsMeta.lastSyncAt).toLocaleString()}`
                  : 'Never verified yet'}
                {sheetsMeta.rewriteMonth ? ` · monthly rewrite ${sheetsMeta.rewriteMonth}` : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleVerifySheets}
                  disabled={verifying}
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
                >
                  <Cloud className={`w-4 h-4 ${verifying ? 'animate-pulse' : ''}`} />
                  {verifying ? 'Verifying…' : 'Verify now'}
                </Button>
                <Button
                  onClick={handleRestore}
                  disabled={restoring}
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {restoring ? 'Restoring…' : 'Restore from sheets'}
                </Button>
              </div>
            </div>
          </section>

          {/* Sync History Section */}
          <section>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              Sync History
            </h3>
            
            {history.length === 0 ? (
              <div className="p-4 bg-muted/20 rounded-lg text-center text-muted-foreground border border-border">
                No recent sync history.
              </div>
            ) : (
              <ul className="space-y-3">
                {history.slice(0, 20).map(item => (
                  <li key={item.id} className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex flex-col">
                    <span className="font-medium text-emerald-700 dark:text-emerald-400">{item.description}</span>
                    <span className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-1">
                      {new Date(item.syncedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="p-4 border-t border-border bg-muted/30 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
