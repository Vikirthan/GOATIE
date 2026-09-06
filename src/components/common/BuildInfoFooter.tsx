import React from 'react';

export const BuildInfoFooter: React.FC = () => {
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
      hour12: true,
    });
    return (
      <div className="mt-6 pt-4 border-t border-border/60 text-center text-xs text-muted-foreground/80 flex items-center justify-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>V.1 Goatie • App Last Updated: {formatted}</span>
      </div>
    );
  } catch {
    return null;
  }
};
