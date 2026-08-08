import React from 'react';

export const LoadingSpinner: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-12 min-h-[300px]">
    <div className="relative flex items-center justify-center">
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-muted border-t-primary" />
      <img src="/android-chrome-192x192.png" alt="Goatie" className="absolute h-8 w-8 animate-pulse rounded-sm" />
    </div>
    {message && <p className="mt-6 text-sm font-medium text-muted-foreground animate-pulse">{message}</p>}
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
