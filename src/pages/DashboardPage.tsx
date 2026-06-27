import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/common/Loaders';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getFarmerGoats, getGoatsDueForWeight, getPendingDeworming, getPendingVaccination } from '@/services/firebaseService';

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

  useEffect(() => {
    const loadDashboardData = async () => {
      if (!user) return;

      try {
        const allGoats = await getFarmerGoats(user.id);
        const active = allGoats.filter((g) => g.status === 'active');
        const sold = allGoats.filter((g) => g.status === 'sold');
        const weightDue = await getGoatsDueForWeight(user.id);
        const deworm = await getPendingDeworming(user.id);
        const vacc = await getPendingVaccination(user.id);

        setStats({
          totalGoats: allGoats.length,
          activeGoats: active.length,
          soldGoats: sold.length,
          weightDue: weightDue.length,
          pendingDeworming: deworm.length,
          pendingVaccination: vacc.length,
        });
      } catch (error) {
        console.error('Error loading dashboard:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
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
