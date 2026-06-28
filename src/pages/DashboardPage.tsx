import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/common/Loaders';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getFarmerGoats, getGoatsDueForWeight, getPendingDeworming, getPendingVaccination } from '@/services/firebaseService';
import * as indexedDB from '@/lib/indexeddb';
import { Goat, WeightRecord, DewormingRecord, PPRVaccinationRecord } from '@/types';

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalGoats: 0,
    activeGoats: 0,
    soldGoats: 0,
    weightDue: 0,
    pendingDeworming: 0,
    pendingVaccination: 0,
  });

  const loadData = async () => {
    if (!user) return;

    try {
      // 1. Instant local load from IndexedDB cache
      const localGoats = await indexedDB.getAllItems<Goat>('goats');
      const farmerGoats = localGoats.filter((g) => g.farmerId === user.id);
      const active = farmerGoats.filter((g) => g.status === 'active');
      const sold = farmerGoats.filter((g) => g.status === 'sold');
      
      const localWeights = await indexedDB.getAllItems<WeightRecord>('weights');
      const localDeworm = await indexedDB.getAllItems<DewormingRecord>('deworming');
      const localVacc = await indexedDB.getAllItems<PPRVaccinationRecord>('vaccination');

      const now = new Date();
      const weightDueCount = active.filter((g) => {
        const w = localWeights.filter((wRecord) => wRecord.goatId === g.id);
        return w.some((weight) => !weight.isRecorded && new Date(weight.dueDate) <= now);
      }).length;

      const pendingDewormingCount = active.filter((g) => {
        const d = localDeworm.find((r) => r.goatId === g.id);
        return !d;
      }).length;

      const pendingVaccinationCount = active.filter((g) => {
        const v = localVacc.find((r) => r.goatId === g.id);
        return !v;
      }).length;

      setStats({
        totalGoats: farmerGoats.length,
        activeGoats: active.length,
        soldGoats: sold.length,
        weightDue: weightDueCount,
        pendingDeworming: pendingDewormingCount,
        pendingVaccination: pendingVaccinationCount,
      });
      setLoading(false); // Snappy first load render!

      // 2. Fetch fresh data in background from Sheets/Firestore
      const allGoats = await getFarmerGoats(user.id);
      const freshActive = allGoats.filter((g) => g.status === 'active');
      const freshSold = allGoats.filter((g) => g.status === 'sold');
      const weightDue = await getGoatsDueForWeight(user.id);
      const deworm = await getPendingDeworming(user.id);
      const vacc = await getPendingVaccination(user.id);

      setStats({
        totalGoats: allGoats.length,
        activeGoats: freshActive.length,
        soldGoats: freshSold.length,
        weightDue: weightDue.length,
        pendingDeworming: deworm.length,
        pendingVaccination: vacc.length,
      });
    } catch (error) {
      console.error('Error loading dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  const statCards = [
    { title: 'Total Goats', value: stats.totalGoats, color: 'bg-blue-500' },
    { title: 'Active Goats', value: stats.activeGoats, color: 'bg-green-500' },
    { title: 'Sold Goats', value: stats.soldGoats, color: 'bg-purple-500' },
    { title: 'Weight Due', value: stats.weightDue, color: 'bg-orange-500' },
    { title: 'Pending Deworming', value: stats.pendingDeworming, color: 'bg-red-500' },
    { title: 'Pending Vaccination', value: stats.pendingVaccination, color: 'bg-yellow-500' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, {user?.displayName}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  <p className="text-3xl font-bold mt-2">{stat.value}</p>
                </div>
                <div className={`w-12 h-12 rounded-lg ${stat.color} opacity-20`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Sales Trend</CardTitle>
            <CardDescription>Goat sales over the last 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={[
                { month: 'Jan', sales: 4 },
                { month: 'Feb', sales: 6 },
                { month: 'Mar', sales: 5 },
                { month: 'Apr', sales: 8 },
                { month: 'May', sales: 7 },
                { month: 'Jun', sales: 9 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Goat Distribution</CardTitle>
            <CardDescription>Active vs Sold goats</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[
                { name: 'Active', value: stats.activeGoats },
                { name: 'Sold', value: stats.soldGoats },
              ]}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Button variant="primary" size="lg" className="w-full h-12">
          Register New Goat
        </Button>
        <Button variant="secondary" size="lg" className="w-full h-12">
          Record Weight
        </Button>
        <Button variant="outline" size="lg" className="w-full h-12">
          View All Goats
        </Button>
      </div>
    </div>
  );
};
