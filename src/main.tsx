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
  registerSW({
    immediate: true,
    onNeedRefresh() {
      // Optional: show a prompt to reload when an update is available
      console.log('New content available, please refresh.');
    },
    onOfflineReady() {
      console.log('App is ready to work offline.');
    },
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
