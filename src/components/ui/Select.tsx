import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Option {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: Option[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({ className, options, value, onChange, placeholder = 'Select...', disabled = false, ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectedOption = options.find((opt) => opt.value === value);

    return (
      <div ref={ref} className={cn('relative', className)} {...props}>
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            'input flex items-center justify-between gap-2 cursor-pointer',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <span className={selectedOption ? '' : 'text-muted-foreground'}>
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-input rounded-md shadow-md z-50">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange?.(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full text-left px-3 py-2 hover:bg-accent text-sm',
                  value === option.value && 'bg-primary/10 text-primary'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
