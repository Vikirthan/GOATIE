import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { showToast } from '@/components/common/Toast';
import { LoadingSpinner } from '@/components/common/Loaders';
import { useAuth } from '@/context/AuthContext';
import { createGoat, getGoatByEarTag } from '@/services/firebaseService';
import { generateQRCode, generateBarcode } from '@/utils/helpers';
import { getGoatVariants } from '@/services/googleSheets';
import { GoatVariant } from '@/types';
import { ArrowLeft, Calculator } from 'lucide-react';
import { format } from 'date-fns';

export const GoatRegistrationPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<GoatVariant[]>([]);
  const [formData, setFormData] = useState({
    earTagNumber: '',
    purchaseDate: format(new Date(), 'yyyy-MM-dd'),
    purchaseWeight: '',
    variant: 'SEMMARI',
    gender: 'male',
    purchasePrice: '',       // Total price
    purchasePricePerKg: '',  // Price per kg
    notes: '',
  });

  useEffect(() => {
    const loadVariants = async () => {
      try {
        const data = await getGoatVariants();
        setVariants(data);
      } catch (error) {
        showToast('error', 'Failed to load goat variants');
      }
    };
    loadVariants();
  }, []);

  // ─── Debounced duplicate ear-tag check ────────────────────────────────────
  const [earTagCheck, setEarTagCheck] = useState<'idle' | 'checking' | 'duplicate' | 'available'>('idle');

  useEffect(() => {
    const tag = formData.earTagNumber.trim();
    if (!tag || !user) {
      setEarTagCheck('idle');
      return;
    }
    setEarTagCheck('checking');
    const timer = setTimeout(async () => {
      try {
        const existing = await getGoatByEarTag(user.id, tag);
        setEarTagCheck(existing ? 'duplicate' : 'available');
      } catch {
        setEarTagCheck('idle');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.earTagNumber, user]);

  // ─── Bidirectional price calculation ──────────────────────────────────────
  // Editing any one of weight / total price / price-per-kg recalculates whichever
  // of the other price fields was already filled in.
  type PriceField = 'purchaseWeight' | 'purchasePrice' | 'purchasePricePerKg';

  const handlePriceFieldChange = (field: PriceField, val: string) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: val };
      const weight = parseFloat(field === 'purchaseWeight' ? val : prev.purchaseWeight);

      if (field === 'purchaseWeight') {
        if (prev.purchasePrice) {
          const total = parseFloat(prev.purchasePrice);
          next.purchasePricePerKg = total > 0 && weight > 0 ? (total / weight).toFixed(2) : '';
        } else if (prev.purchasePricePerKg) {
          const rate = parseFloat(prev.purchasePricePerKg);
          next.purchasePrice = rate > 0 && weight > 0 ? (rate * weight).toFixed(2) : '';
        }
      } else if (field === 'purchasePrice') {
        const total = parseFloat(val);
        next.purchasePricePerKg = total > 0 && weight > 0 ? (total / weight).toFixed(2) : '';
      } else {
        const rate = parseFloat(val);
        next.purchasePrice = rate > 0 && weight > 0 ? (rate * weight).toFixed(2) : '';
      }

      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) { showToast('error', 'Not authenticated'); return; }
    if (!formData.earTagNumber.trim()) { showToast('error', 'Goat number is required'); return; }
    if (!formData.purchasePrice || parseFloat(formData.purchasePrice) <= 0) {
      showToast('error', 'Purchase price is required'); return;
    }

    setLoading(true);

    try {
      // Check if ear tag is unique among active goats (sold tags can be reused)
      const existing = await getGoatByEarTag(user.id, formData.earTagNumber);
      if (existing) {
        showToast('error', 'This goat number is already in use by an active goat');
        setLoading(false);
        return;
      }

      const qrCode = await generateQRCode(formData.earTagNumber);
      const barcode = generateBarcode(formData.earTagNumber);

      await createGoat(user.id, {
        earTagNumber: formData.earTagNumber,
        purchaseDate: new Date(formData.purchaseDate),
        purchaseWeight: parseFloat(formData.purchaseWeight),
        variant: formData.variant,
        gender: formData.gender as 'male' | 'female',
        purchasePrice: parseFloat(formData.purchasePrice),
        purchasePricePerKg: formData.purchasePricePerKg ? parseFloat(formData.purchasePricePerKg) : undefined,
        sellerName: 'N/A',
        notes: formData.notes || undefined,
        qrCode,
        barcode,
      });

      showToast('success', 'Goat registered successfully');
      navigate('/goats');
    } catch (error: any) {
      showToast('error', 'Failed to register goat', error.message);
    } finally {
      setLoading(false);
    }
  };

  if (variants.length === 0) {
    return <LoadingSpinner message="Loading goat variants..." />;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border bg-card hover:bg-accent transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Register New Goat</h1>
          <p className="text-muted-foreground mt-0.5">Add a new goat to your farm</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Basic Info */}
            <div className="space-y-4">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">Basic Information</h2>

              <div>
                <Label htmlFor="earTagNumber">Goat Number (Ear Tag) *</Label>
                <Input
                  id="earTagNumber"
                  placeholder="Enter unique goat number"
                  value={formData.earTagNumber}
                  onChange={(e) => setFormData({ ...formData, earTagNumber: e.target.value })}
                  required
                  aria-describedby="earTagNumber-status"
                />
                <p id="earTagNumber-status" className="text-xs mt-1 min-h-[1em]">
                  {earTagCheck === 'checking' && <span className="text-muted-foreground">Checking availability…</span>}
                  {earTagCheck === 'duplicate' && <span className="text-red-500">This goat number is already in use by an active goat</span>}
                  {earTagCheck === 'available' && <span className="text-emerald-600 dark:text-emerald-400">Available</span>}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="variant">Variant / Breed *</Label>
                  <Select
                    options={variants.map((v) => ({ value: v.code, label: v.name }))}
                    value={formData.variant}
                    onChange={(value) => setFormData({ ...formData, variant: value })}
                  />
                </div>
                <div>
                  <Label htmlFor="gender">Gender</Label>
                  <Select
                    options={[
                      { value: 'male', label: '♂ Male' },
                      { value: 'female', label: '♀ Female' },
                    ]}
                    value={formData.gender}
                    onChange={(value) => setFormData({ ...formData, gender: value })}
                  />
                </div>
              </div>
            </div>

            {/* Purchase Details */}
            <div className="space-y-4">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">Purchase Details</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="purchaseDate">Purchase Date *</Label>
                  <Input
                    id="purchaseDate"
                    type="date"
                    value={formData.purchaseDate}
                    onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="purchaseWeight">Purchase Weight (kg) *</Label>
                  <Input
                    id="purchaseWeight"
                    type="number"
                    placeholder="0.0"
                    step="0.1"
                    value={formData.purchaseWeight}
                    onChange={(e) => handlePriceFieldChange('purchaseWeight', e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Bidirectional Price */}
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <Calculator className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">Purchase Price — enter either field, the other auto-calculates</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="purchasePrice">Total Price (₹) *</Label>
                    <Input
                      id="purchasePrice"
                      type="number"
                      placeholder="0.00"
                      step="0.01"
                      value={formData.purchasePrice}
                      onChange={(e) => handlePriceFieldChange('purchasePrice', e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="purchasePricePerKg">Price per KG (₹)</Label>
                    <Input
                      id="purchasePricePerKg"
                      type="number"
                      placeholder="0.00"
                      step="0.01"
                      value={formData.purchasePricePerKg}
                      onChange={(e) => handlePriceFieldChange('purchasePricePerKg', e.target.value)}
                    />
                  </div>
                </div>
                {formData.purchasePrice && formData.purchaseWeight && (
                  <p className="text-xs text-muted-foreground">
                    ₹{parseFloat(formData.purchasePrice).toLocaleString('en-IN')} total ·{' '}
                    {formData.purchasePricePerKg && `₹${parseFloat(formData.purchasePricePerKg).toFixed(2)}/kg`}
                  </p>
                )}
              </div>
            </div>

            {/* Additional */}
            <div className="space-y-4">
              <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground pb-1 border-b border-border">Additional Info</h2>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional notes or observations"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-4 pt-2">
              <Button type="submit" variant="primary" size="md" isLoading={loading}>
                Register Goat
              </Button>
              <Button type="button" variant="outline" size="md" onClick={() => navigate(-1)}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
