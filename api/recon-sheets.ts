import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { reconcileAllTabs } from './_lib/reconcile';

function getBearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

// GET is how Vercel invokes the Sunday cron (authenticated via CRON_SECRET, which Vercel
// automatically sends as this same bearer header). POST is how the in-app "Recon Now"
// button triggers it, authenticated with the logged-in user's own Supabase session.
async function isAuthorized(req: VercelRequest): Promise<boolean> {
  const token = getBearerToken(req);
  if (!token) return false;

  if (req.method === 'GET') {
    return !!process.env.CRON_SECRET && token === process.env.CRON_SECRET;
  }

  const url = process.env.VITE_SUPABASE_URL || '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) return false;
  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.getUser(token);
  return !error && !!data.user;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!(await isAuthorized(req))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const summary = await reconcileAllTabs();
    res.status(200).json({ summary });
  } catch (err: any) {
    console.error('Sheets reconciliation failed:', err);
    res.status(500).json({ error: err.message || 'Reconciliation failed' });
  }
}
