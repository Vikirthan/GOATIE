import React, { useEffect, useRef, useState } from 'react';
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
  id?: string;
}

export const Select = React.forwardRef<HTMLDivElement, SelectProps>(
  ({ className, options, value, onChange, placeholder = 'Select...', disabled = false, id, ...props }, ref) => {
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const listId = id ? `${id}-listbox` : undefined;

    const selectedOption = options.find((opt) => opt.value === value);
    const selectedIndex = options.findIndex((opt) => opt.value === value);

    const close = () => {
      setIsOpen(false);
      setActiveIndex(-1);
    };

    const commit = (index: number) => {
      const option = options[index];
      if (!option) return;
      onChange?.(option.value);
      close();
      buttonRef.current?.focus();
    };

    useEffect(() => {
      if (!isOpen) return;
      const handleOutside = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
      };
      document.addEventListener('mousedown', handleOutside);
      return () => document.removeEventListener('mousedown', handleOutside);
    }, [isOpen]);

    const handleButtonKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
      }
    };

    const handleListKeyDown = (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          close();
          buttonRef.current?.focus();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, options.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(options.length - 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (activeIndex >= 0) commit(activeIndex);
          break;
        case 'Tab':
          close();
          break;
      }
    };

    return (
      <div
        ref={(el) => {
          containerRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
        }}
        className={cn('relative', className)}
        {...props}
      >
        <button
          ref={buttonRef}
          id={id}
          type="button"
          onClick={() => {
            if (disabled) return;
            setIsOpen((o) => !o);
            setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          }}
          onKeyDown={handleButtonKeyDown}
          disabled={disabled}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={listId}
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
          <div
            id={listId}
            role="listbox"
            tabIndex={-1}
            onKeyDown={handleListKeyDown}
            ref={(el) => el?.focus()}
            className="absolute top-full left-0 right-0 mt-1 bg-card border border-input rounded-md shadow-md z-50 outline-none max-h-60 overflow-y-auto"
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                role="option"
                aria-selected={value === option.value}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={cn(
                  'w-full text-left px-3 py-2 hover:bg-accent text-sm cursor-pointer',
                  value === option.value && 'bg-primary/10 text-primary',
                  activeIndex === index && 'bg-accent'
                )}
              >
                {option.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
