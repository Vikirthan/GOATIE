import { useEffect, useState } from 'react';
import { X, RefreshCw, CheckCircle, Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import * as indexedDB from '@/lib/indexeddb';
import { OfflineAction, SyncHistoryItem } from '@/types';
import { forceSync } from '@/services/firebaseService';
import { useAuth } from '@/context/AuthContext';
import { showToast } from '@/components/common/Toast';

interface SyncQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SyncQueueModal({ isOpen, onClose }: SyncQueueModalProps) {
  const [pending, setPending] = useState<OfflineAction[]>([]);
  const [history, setHistory] = useState<SyncHistoryItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const { user } = useAuth();

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

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Sync Status</h2>
            <p className="text-sm text-slate-500 mt-1">Manage your offline edits and history</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Pending Queue Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
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
              <div className="p-4 bg-slate-50 rounded-lg text-center text-slate-500 border border-slate-100">
                All caught up! No pending edits.
              </div>
            ) : (
              <ul className="space-y-3">
                {pending.map(action => (
                  <li key={action.id} className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-center justify-between">
                    <span className="font-medium text-amber-900">
                      {action.type === 'create' ? 'Goat creation pending' : 
                       action.type === 'update' ? `Goat ${action.data.updates?.earTagNumber || 'edit'} pending` :
                       'Action pending'}
                    </span>
                    <span className="text-xs text-amber-700 bg-amber-100 px-2 py-1 rounded-full">Queued</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Sync History Section */}
          <section>
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-emerald-500" />
              Sync History
            </h3>
            
            {history.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-lg text-center text-slate-500 border border-slate-100">
                No recent sync history.
              </div>
            ) : (
              <ul className="space-y-3">
                {history.slice(0, 20).map(item => (
                  <li key={item.id} className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex flex-col">
                    <span className="font-medium text-emerald-900">{item.description}</span>
                    <span className="text-xs text-emerald-600 mt-1">
                      {new Date(item.syncedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
