import { addMonths, startOfDay } from 'date-fns';
import JsBarcode from 'jsbarcode';

// QR Code generation
export async function generateQRCode(data: string): Promise<string> {
  try {
    // Using a simple approach - generate QR as data URL with canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    // Simple placeholder - in production use qrcode or qrcode.react properly
    canvas.width = 200;
    canvas.height = 200;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#000000';
    ctx.font = '16px Arial';
    ctx.fillText('QR:', 80, 90);
    ctx.fillText(data.substring(0, 15), 70, 110);
    
    return canvas.toDataURL();
  } catch (error) {
    console.error('Error generating QR code:', error);
    throw error;
  }
}

// Barcode generation
export function generateBarcode(data: string): string {
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, data, {
      format: 'CODE128',
      width: 2,
      height: 100,
      displayValue: true,
    });
    return canvas.toDataURL();
  } catch (error) {
    console.error('Error generating barcode:', error);
    throw error;
  }
}

// Calculate weight schedule dates
export function calculateWeightScheduleDates(purchaseDate: Date) {
  return {
    weight0: purchaseDate,
    weight1: addMonths(purchaseDate, 1),
    weight2: addMonths(purchaseDate, 2),
    weight3: addMonths(purchaseDate, 3),
    weight4: addMonths(purchaseDate, 4),
  };
}

// Check if weight is due
export function isWeightDue(dueDate: Date, isRecorded: boolean): boolean {
  if (isRecorded) return false;
  return startOfDay(new Date()) >= startOfDay(dueDate);
}

// Check if weight is overdue (more than a few days past due)
export function isWeightOverdue(dueDate: Date, isRecorded: boolean): boolean {
  if (isRecorded) return false;
  const today = startOfDay(new Date());
  const dueDateStart = startOfDay(dueDate);
  const daysOverdue = Math.floor(
    (today.getTime() - dueDateStart.getTime()) / (1000 * 60 * 60 * 24)
  );
  return daysOverdue > 3; // Consider overdue if more than 3 days past
}

// Calculate profit
export function calculateProfit(
  weight: number,
  ratePerKg: number,
  purchasePrice: number,
  commission: number = 0,
  transportCharges: number = 0,
  otherCharges: number = 0
): { saleAmount: number; totalDeductions: number; netProfit: number; profitPercentage: number } {
  const saleAmount = weight * ratePerKg;
  const totalDeductions = commission + transportCharges + otherCharges;
  const netProfit = saleAmount - purchasePrice - totalDeductions;
  const profitPercentage = ((netProfit / purchasePrice) * 100);

  return {
    saleAmount,
    totalDeductions,
    netProfit,
    profitPercentage,
  };
}

// Calculate weight gain
export function calculateWeightGain(
  currentWeight: number,
  previousWeight: number
): number {
  return currentWeight - previousWeight;
}

// Calculate average monthly gain
export function calculateAverageMonthlyGain(
  currentWeight: number,
  purchaseWeight: number,
  monthsElapsed: number
): number {
  if (monthsElapsed === 0) return 0;
  return (currentWeight - purchaseWeight) / monthsElapsed;
}

// Calculate growth percentage
export function calculateGrowthPercentage(
  currentWeight: number,
  purchaseWeight: number
): number {
  if (purchaseWeight === 0) return 0;
  return ((currentWeight - purchaseWeight) / purchaseWeight) * 100;
}

// Validate goat number (unique ear tag)
export function validateGoatNumber(goatNumber: string): boolean {
  return goatNumber.trim().length > 0 && goatNumber.length <= 50;
}

// Validate email
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Validate phone number
export function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^[\d\s\-\+\(\)]+$/;
  return phone.length >= 10 && phoneRegex.test(phone);
}

// Format currency
export function formatCurrency(amount: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Format date
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Format short date
export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

// Get initials from name
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Generate unique ID
export function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
