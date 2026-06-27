import clsx from 'clsx';
import { type ClassValue, clsx as classnames } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return classnames(inputs);
}

export { clsx };
