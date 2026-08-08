import { useQuery } from '@tanstack/react-query';
import {
  getFarmerGoats,
  getAllDeworming,
  getAllVaccinations,
  isSupabaseEnabled,
} from '@/services/firebaseService';
import { getAllWeights } from '@/services/supabaseService';
import { WeightRecord } from '@/types';

export const useGoatsData = (userId: string | undefined) => {
  return useQuery({
    queryKey: ['goatsData', userId],
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
