import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAllDeworming,
  getAllVaccinations,
  getFarmerGoats,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import { getAllWeights } from '@/services/supabaseService';
import { supabase } from '@/lib/supabase';
import * as indexedDB from '@/lib/indexeddb';
import type { DewormingRecord, Goat, PPRVaccinationRecord, WeightRecord } from '@/types';

const QUERY_KEY = ['analyticsData'];

export interface AnalyticsBundle {
  goats: Goat[];
  weights: WeightRecord[];
  dewormings: DewormingRecord[];
  vaccinations: PPRVaccinationRecord[];
}

export const useAnalyticsData = (userId: string | undefined, viewingHerdId?: string | null) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    window.addEventListener('data-synced', invalidate);
    if (isSupabaseEnabled()) {
      const channel = supabase
        .channel('public:analytics')
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
    return () => window.removeEventListener('data-synced', invalidate);
  }, [userId, queryClient]);

  const query = useQuery({
    queryKey: [...QUERY_KEY, userId],
    queryFn: async (): Promise<AnalyticsBundle> => {
      if (!userId) throw new Error('User not authenticated');
      const [allGoats, weights, dewormings, vaccinations] = await Promise.all([
        getFarmerGoats(userId),
        isSupabaseEnabled() ? getAllWeights() : indexedDB.getAllItems<WeightRecord>('weights'),
        getAllDeworming(),
        getAllVaccinations(),
      ]);
      const goatIds = new Set(allGoats.map((g) => g.id));
      return {
        goats: allGoats,
        weights: weights.filter((w) => goatIds.has(w.goatId)),
        dewormings: dewormings.filter((d) => goatIds.has(d.goatId)),
        vaccinations: vaccinations.filter((v) => goatIds.has(v.goatId)),
      };
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const scoped = useMemo((): AnalyticsBundle => {
    const empty: AnalyticsBundle = { goats: [], weights: [], dewormings: [], vaccinations: [] };
    if (!query.data) return empty;
    if (!viewingHerdId) return query.data;
    const goats = query.data.goats.filter((g) => g.farmerId === viewingHerdId);
    const ids = new Set(goats.map((g) => g.id));
    return {
      goats,
      weights: query.data.weights.filter((w) => ids.has(w.goatId)),
      dewormings: query.data.dewormings.filter((d) => ids.has(d.goatId)),
      vaccinations: query.data.vaccinations.filter((v) => ids.has(v.goatId)),
    };
  }, [query.data, viewingHerdId]);

  return { ...query, scoped };
};
