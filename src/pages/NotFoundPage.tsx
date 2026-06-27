import React from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/common/Loaders';
import { useNavigate } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6">
          <EmptyState
            title="Page Not Found"
            description="The page you're looking for doesn't exist"
            action={
              <Button
                variant="primary"
                onClick={() => navigate('/dashboard')}
              >
                Go to Dashboard
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
};
