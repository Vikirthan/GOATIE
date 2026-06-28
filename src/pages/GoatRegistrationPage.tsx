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

export const GoatRegistrationPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<GoatVariant[]>([]);
  const [formData, setFormData] = useState({
    earTagNumber: '',
    purchaseDate: '',
    purchaseWeight: '',
    variant: '',
    gender: 'male',
    age: '',
    purchasePrice: '',
    sellerName: '',
    sellerContact: '',
    notes: '',
    photo: '',
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      showToast('error', 'Not authenticated');
      return;
    }

    // Validate
    if (!formData.earTagNumber.trim()) {
      showToast('error', 'Goat number is required');
      return;
    }

    setLoading(true);

    try {
      // Check if ear tag is unique
      const existing = await getGoatByEarTag(user.id, formData.earTagNumber);
      if (existing) {
        showToast('error', 'Goat number already exists');
        setLoading(false);
        return;
      }

      // Generate QR and Barcode
      const qrCode = await generateQRCode(formData.earTagNumber);
      const barcode = generateBarcode(formData.earTagNumber);

      // Create goat record
      const goatId = await createGoat(user.id, {
        earTagNumber: formData.earTagNumber,
        purchaseDate: new Date(formData.purchaseDate),
        purchaseWeight: parseFloat(formData.purchaseWeight),
        variant: formData.variant,
        gender: formData.gender as 'male' | 'female',
        age: parseInt(formData.age) || undefined,
        purchasePrice: parseFloat(formData.purchasePrice),
        sellerName: 'N/A',
        notes: formData.notes || undefined,
        photoURL: formData.photo || undefined,
        qrCode,
        barcode,
      });

      showToast('success', 'Goat registered successfully');
      navigate(`/goats/${goatId}`);
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
      <div>
        <h1 className="text-3xl font-bold">Register New Goat</h1>
        <p className="text-muted-foreground">Add a new goat to your farm</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h2 className="font-semibold">Basic Information</h2>
              
              <div>
                <Label htmlFor="earTagNumber">Goat Number (Ear Tag)</Label>
                <Input
                  id="earTagNumber"
                  placeholder="Enter unique goat number"
                  value={formData.earTagNumber}
                  onChange={(e) => setFormData({ ...formData, earTagNumber: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="variant">Variant/Breed</Label>
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
                      { value: 'male', label: 'Male' },
                      { value: 'female', label: 'Female' },
                    ]}
                    value={formData.gender}
                    onChange={(value) => setFormData({ ...formData, gender: value })}
                  />
                </div>
              </div>
            </div>

            {/* Purchase Details */}
            <div className="space-y-4">
              <h2 className="font-semibold">Purchase Details</h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="purchaseDate">Purchase Date</Label>
                  <Input
                    id="purchaseDate"
                    type="date"
                    value={formData.purchaseDate}
                    onChange={(e) => setFormData({ ...formData, purchaseDate: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="purchaseWeight">Purchase Weight (kg)</Label>
                  <Input
                    id="purchaseWeight"
                    type="number"
                    placeholder="0.0"
                    step="0.1"
                    value={formData.purchaseWeight}
                    onChange={(e) => setFormData({ ...formData, purchaseWeight: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="purchasePrice">Purchase Price (₹)</Label>
                  <Input
                    id="purchasePrice"
                    type="number"
                    placeholder="0.00"
                    step="0.01"
                    value={formData.purchasePrice}
                    onChange={(e) => setFormData({ ...formData, purchasePrice: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="age">Age (months)</Label>
                  <Input
                    id="age"
                    type="number"
                    placeholder="Optional"
                    value={formData.age}
                    onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                  />
                </div>
              </div>
            </div>



            {/* Additional */}
            <div className="space-y-4">
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
            <div className="flex gap-4 pt-6">
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={loading}
              >
                Register Goat
              </Button>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => navigate(-1)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
