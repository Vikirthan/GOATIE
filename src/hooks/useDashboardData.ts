import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFarmerGoats,
  getGoatsDueForWeight,
  getPendingDeworming,
  getPendingVaccination,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import { getAllWeights } from '@/services/supabaseService';
import { supabase } from '@/lib/supabase';
import * as indexedDB from '@/lib/indexeddb';
import { WeightRecord } from '@/types';

const QUERY_KEY = ['dashboardData'];

export const useDashboardData = (userId: string | undefined) => {
  const queryClient = useQueryClient();

  // Keep the dashboard fresh: re-fetch on manual offline sync and on any relevant Supabase realtime change.
  useEffect(() => {
    if (!userId) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

    window.addEventListener('data-synced', invalidate);

    if (isSupabaseEnabled()) {
      const channel = supabase
        .channel('public:dashboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'goats' }, invalidate)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weights' }, invalidate)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deworming' }, invalidate)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vaccinations' }, invalidate)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, invalidate)
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
        window.removeEventListener('data-synced', invalidate);
      };
    }

    return () => {
      window.removeEventListener('data-synced', invalidate);
    };
  }, [userId, queryClient]);

  return useQuery({
    queryKey: [...QUERY_KEY, userId],
    queryFn: async () => {
      if (!userId) throw new Error('User not authenticated');

      const allGoats = await getFarmerGoats(userId);
      const [weightDue, deworm, vacc, freshWeights] = await Promise.all([
        getGoatsDueForWeight(userId),
        getPendingDeworming(userId),
        getPendingVaccination(userId),
        isSupabaseEnabled() ? getAllWeights() : indexedDB.getAllItems<WeightRecord>('weights'),
      ]);

      return {
        allGoats,
        weightDue,
        deworm,
        vacc,
        freshWeights
      };
    },
    enabled: !!userId,
  });
};
