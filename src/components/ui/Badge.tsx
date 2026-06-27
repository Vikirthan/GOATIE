import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'destructive' | 'success' | 'warning';
  children: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'badge bg-secondary/10 text-secondary',
      primary: 'badge bg-primary/10 text-primary',
      secondary: 'badge bg-secondary/10 text-secondary',
      destructive: 'badge bg-destructive/10 text-destructive',
      success: 'badge bg-green-500/10 text-green-700 dark:text-green-400',
      warning: 'badge bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    };

    return (
      <div
        ref={ref}
        className={cn(variants[variant], className)}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';
