import React from 'react';
import { cn } from '@/lib/utils';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive' | 'success' | 'warning';
  title?: string;
  description?: string;
  children?: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = 'default', title, description, children, ...props }, ref) => {
    const variants = {
      default: 'bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800 text-blue-800 dark:text-blue-300',
      destructive: 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800 text-red-800 dark:text-red-300',
      success: 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800 text-green-800 dark:text-green-300',
      warning: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300',
    };

    return (
      <div
        ref={ref}
        className={cn(
          'rounded-lg border p-4',
          variants[variant],
          className
        )}
        {...props}
      >
        {title && <div className="font-semibold">{title}</div>}
        {description && <div className="text-sm">{description}</div>}
        {children}
      </div>
    );
  }
);

Alert.displayName = 'Alert';
