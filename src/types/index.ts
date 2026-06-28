// User and Auth Types
export interface User {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'admin' | 'farmer';
  createdAt: Date;
  updatedAt: Date;
}

// Goat Types
export interface Goat {
  id: string;
  earTagNumber: string; // Unique identifier
  farmerId: string;
  purchaseDate: Date;
  purchaseWeight: number; // Weight 0
  variant: string; // From Google Sheet
  gender: 'male' | 'female';
  age?: number;
  purchasePrice: number;
  sellerName: string;
  sellerContact?: string;
  notes?: string;
  photoURL?: string;
  qrCode?: string;
  barcode?: string;
  status: 'active' | 'sold' | 'deceased';
  createdAt: Date;
  updatedAt: Date;
  saleInfo?: SaleInfo;
}

// Weight Record Types
export interface WeightRecord {
  id: string;
  goatId: string;
  weightNumber: 0 | 1 | 2 | 3 | 4; // Weight 0-4
  weight: number;
  dueDate: Date;
  recordedDate?: Date;
  remarks?: string;
  isRecorded: boolean;
  weightGain?: number; // Difference from previous weight
  monthlyGain?: number; // Average monthly gain
  growthPercentage?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Deworming Record Types
export interface DewormingRecord {
  id: string;
  goatId: string;
  dewormingDate: Date;
  medicineUsed?: string;
  batchNumber?: string;
  administeredBy?: string;
  remarks?: string;
  status: 'pending' | 'dewormed';
  createdAt: Date;
  updatedAt: Date;
}

// PPR Vaccination Record Types
export interface PPRVaccinationRecord {
  id: string;
  goatId: string;
  vaccinationDate: Date;
  vaccineBrand?: string;
  batchNumber?: string;
  administeredBy?: string;
  remarks?: string;
  status: 'pending' | 'vaccinated';
  createdAt: Date;
  updatedAt: Date;
}

// Sale Record Types
export interface SaleInfo {
  id: string;
  goatId: string;
  saleDate: Date;
  saleWeight: number;
  saleRatePerKg: number;
  buyerName: string;
  buyerContact?: string;
  saleAmount: number; // saleWeight * saleRatePerKg
  commission?: number;
  transportCharges?: number;
  otherCharges?: number;
  netProfit: number;
  profitPercentage: number;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Goat Timeline Event
export interface TimelineEvent {
  id: string;
  goatId: string;
  date: Date;
  eventType: 'purchase' | 'weight' | 'deworming' | 'vaccination' | 'sale';
  title: string;
  description: string;
  metadata?: Record<string, any>;
}

// Notification Types
export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'weight_due' | 'weight_overdue' | 'deworming_due' | 'vaccination_due' | 'general';
  relatedGoatId?: string;
  read: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

// Dashboard Stats
export interface DashboardStats {
  totalGoats: number;
  activeGoats: number;
  soldGoats: number;
  goatsDueForWeight: number;
  pendingDeworming: number;
  pendingVaccination: number;
  totalRevenue: number;
  totalProfit: number;
  monthlyPurchases: number;
  monthlySales: number;
}

// Google Sheet Types
export interface GoatVariant {
  id: string;
  name: string;
  code: string;
  description?: string;
}

export interface Language {
  id: string;
  code: string;
  name: string;
  nativeName: string;
}

// Report Types
export type ReportFormat = 'pdf' | 'excel' | 'csv';

export interface PurchaseReport {
  goatNumber: string;
  purchaseDate: Date;
  purchaseWeight: number;
  variant: string;
  purchasePrice: number;
  sellerName: string;
}

export interface SalesReport {
  goatNumber: string;
  saleDate: Date;
  saleWeight: number;
  saleRate: number;
  saleAmount: number;
  profit: number;
  buyerName: string;
}

// Offline Queue Types
export interface OfflineAction {
  id: string;
  type: 'create' | 'update' | 'delete';
  collection: string;
  data: any;
  timestamp: Date;
  synced: boolean;
}
