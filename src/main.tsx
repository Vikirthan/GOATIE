import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { initDB } from './lib/indexeddb'

// Initialize IndexedDB
initDB().catch(console.error)

import { registerSW } from 'virtual:pwa-register'

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // New build deployed: activate it and reload so the tab isn't stuck on stale code.
      updateSW(true);
    },
    onOfflineReady() {
      console.log('App is ready to work offline.');
    },
  });
}

import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Data never goes stale on its own; useGoatsData/useDashboardData explicitly
      // invalidateQueries() on every mutation and Supabase realtime change instead,
      // which forces an immediate refetch regardless of staleTime.
      staleTime: Infinity,
      // Keep cached data for the whole session so navigating away and back never
      // shows a loading flash while a background refetch (from invalidation) completes.
      gcTime: Infinity,
    },
  },
})

// Persist the query cache to localStorage so a full page reload / fresh app
// launch can render last-known data immediately instead of starting blank
// while the network refetch (auth + Supabase queries) completes.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'goatie-query-cache',
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // discard persisted cache after 24h
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </React.StrictMode>,
)
