import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Combines Tailwind classes without conflicts; used across components.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
