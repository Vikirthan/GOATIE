import React from 'react';

export const LoadingSpinner: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-12">
    <div className="h-12 w-12 animate-spin rounded-full border-4 border-muted border-t-primary" />
    {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
  </div>
);

export const SkeletonLoader: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div className="space-y-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-muted" />
    ))}
  </div>
);

export const EmptyState: React.FC<{ 
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    {icon && <div className="mb-4">{icon}</div>}
    <h3 className="text-lg font-semibold">{title}</h3>
    {description && <p className="mt-2 text-sm text-muted-foreground">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);
