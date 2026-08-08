import { useQuery } from '@tanstack/react-query';
import {
  getFarmerGoats,
  getGoatsDueForWeight,
  getPendingDeworming,
  getPendingVaccination,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import { getAllWeights } from '@/services/supabaseService';
import * as indexedDB from '@/lib/indexeddb';
import { WeightRecord } from '@/types';

export const useDashboardData = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['dashboardData', userId],
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
