import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { showToast } from '@/components/common/Toast';
import { loginWithEmail, loginWithGoogle } from '@/services/authService';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await loginWithEmail(email, password);
      showToast('success', 'Login successful');
      navigate('/dashboard');
    } catch (error: any) {
      showToast('error', 'Login failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);

    try {
      await loginWithGoogle();
      showToast('success', 'Login successful');
      navigate('/dashboard');
    } catch (error: any) {
      showToast('error', 'Google login failed', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary/5 to-secondary/5">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center text-white font-bold text-lg">
              G
            </div>
          </div>
          <CardTitle>GOATIE Login</CardTitle>
          <CardDescription>Sign in to manage your goat farm</CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email / Username</Label>
              <Input
                id="email"
                type="text"
                placeholder="Enter your email or username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={loading}
              className="w-full"
            >
              Sign In
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full"
          >
            Google
          </Button>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <button
              onClick={() => navigate('/register')}
              className="text-primary hover:underline font-medium"
            >
              Sign up
            </button>
          </p>

          {(() => {
            // @ts-ignore
            const buildTimeStr = import.meta.env.VITE_APP_BUILD_TIME;
            if (!buildTimeStr) return null;
            try {
              const date = new Date(buildTimeStr);
              const formatted = date.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
              });
              return (
                <div className="mt-6 pt-4 border-t border-border/60 text-center text-xs text-muted-foreground/80 flex items-center justify-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>V.1 Goatie • App Last Updated: {formatted}</span>
                </div>
              );
            } catch (e) {
              return null;
            }
          })()}
        </CardContent>
      </Card>
    </div>
  );
};
