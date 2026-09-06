import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getFarmerGoats,
  getAllDeworming,
  getAllVaccinations,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import { getAllWeights } from '@/services/supabaseService';
import { supabase } from '@/lib/supabase';
import { WeightRecord } from '@/types';

const QUERY_KEY = ['goatsData'];

export const useGoatsData = (userId: string | undefined) => {
  const queryClient = useQueryClient();

  // Keep the list fresh: re-fetch on manual offline sync and on any relevant Supabase realtime change.
  useEffect(() => {
    if (!userId) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

    window.addEventListener('data-synced', invalidate);

    if (isSupabaseEnabled()) {
      const channel = supabase
        .channel('public:goats-list')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'goats' }, invalidate)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'weights' }, invalidate)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'deworming' }, invalidate)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vaccinations' }, invalidate)
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

      const [freshGoats, freshDeworm, freshVacc, freshWeights] = await Promise.all([
        getFarmerGoats(userId),
        getAllDeworming(),
        getAllVaccinations(),
        isSupabaseEnabled() ? getAllWeights() : Promise.resolve([] as WeightRecord[]),
      ]);

      return {
        freshGoats,
        freshDeworm,
        freshVacc,
        freshWeights
      };
    },
    enabled: !!userId,
  });
};
