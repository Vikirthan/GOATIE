import ExcelJS from 'exceljs';
import { Goat } from '@/types';

// Exact column headers based on UI language (Seller and Age details removed)
const COLUMNS = {
  earTagNumber: 'Goat Number (Ear Tag)',
  variant: 'Variant/Breed',
  gender: 'Gender',
  purchaseDate: 'Purchase Date',
  purchaseWeight: 'Purchase Weight (kg)',
  purchasePrice: 'Purchase Price (₹)',
  notes: 'Notes',
  status: 'Status'
};

// Export Goats to Excel
export async function exportGoatsToExcel(goats: Goat[]): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Goats Data');

  // Define columns
  worksheet.columns = [
    { header: COLUMNS.earTagNumber, key: 'earTagNumber', width: 25 },
    { header: COLUMNS.variant, key: 'variant', width: 20 },
    { header: COLUMNS.gender, key: 'gender', width: 15 },
    { header: COLUMNS.purchaseDate, key: 'purchaseDate', width: 18 },
    { header: COLUMNS.purchaseWeight, key: 'purchaseWeight', width: 22 },
    { header: COLUMNS.purchasePrice, key: 'purchasePrice', width: 20 },
    { header: COLUMNS.notes, key: 'notes', width: 30 },
    { header: COLUMNS.status, key: 'status', width: 15 }
  ];

  // Add rows
  goats.forEach(goat => {
    worksheet.addRow({
      earTagNumber: goat.earTagNumber,
      variant: goat.variant,
      gender: goat.gender,
      purchaseDate: goat.purchaseDate ? new Date(goat.purchaseDate).toISOString().split('T')[0] : '',
      purchaseWeight: goat.purchaseWeight,
      purchasePrice: goat.purchasePrice,
      notes: goat.notes || '',
      status: goat.status
    });
  });

  // Make header bold
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF10B981' } // Emerald green matches brand color
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };

  // Write and trigger download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `goats_export_${new Date().toISOString().split('T')[0]}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

// Import Goats from Excel
export async function importGoatsFromExcel(file: File): Promise<Omit<Goat, 'id' | 'createdAt' | 'updatedAt' | 'farmerId' | 'qrCode' | 'barcode'>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.getWorksheet(1); // Get first sheet
        
        if (!worksheet) {
          throw new Error('No worksheets found in the Excel file');
        }

        const goats: Omit<Goat, 'id' | 'createdAt' | 'updatedAt' | 'farmerId' | 'qrCode' | 'barcode'>[] = [];
        const colIndices: { [key: string]: number } = {};

        // Find headers
        const headerRow = worksheet.getRow(1);
        headerRow.eachCell((cell, colNumber) => {
          const val = cell.value?.toString().trim();
          if (val) {
            colIndices[val] = colNumber;
          }
        });

        // Validate necessary columns exist (at least Goat Number, Variant, Gender, Purchase Weight, Purchase Price)
        const requiredFields = [
          COLUMNS.earTagNumber,
          COLUMNS.variant,
          COLUMNS.gender,
          COLUMNS.purchaseDate,
          COLUMNS.purchaseWeight,
          COLUMNS.purchasePrice
        ];

        for (const field of requiredFields) {
          if (!colIndices[field]) {
            throw new Error(`Required column "${field}" is missing in the Excel file.`);
          }
        }

        worksheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // Skip headers

          const getCellVal = (headerName: string) => {
            const index = colIndices[headerName];
            if (!index) return undefined;
            const cell = row.getCell(index);
            const val = cell.value;
            // Handle rich text or formula results
            if (val && typeof val === 'object') {
              if ('result' in val) return val.result;
              if ('text' in val) return val.text;
            }
            return val;
          };

          const earTagNumber = getCellVal(COLUMNS.earTagNumber)?.toString().trim();
          if (!earTagNumber) return; // Skip empty row

          const variant = getCellVal(COLUMNS.variant)?.toString().trim() || 'LOCAL';
          
          let gender = getCellVal(COLUMNS.gender)?.toString().trim().toLowerCase();
          if (gender !== 'female' && gender !== 'male') {
            gender = 'male';
          }

          let purchaseDateVal = getCellVal(COLUMNS.purchaseDate);
          let purchaseDate: Date;
          if (purchaseDateVal instanceof Date) {
            purchaseDate = purchaseDateVal;
          } else if (purchaseDateVal) {
            purchaseDate = new Date(purchaseDateVal.toString());
          } else {
            purchaseDate = new Date();
          }

          const purchaseWeight = parseFloat(getCellVal(COLUMNS.purchaseWeight)?.toString() || '0');
          const purchasePrice = parseFloat(getCellVal(COLUMNS.purchasePrice)?.toString() || '0');
          const notes = getCellVal(COLUMNS.notes)?.toString().trim() || undefined;

          let status = getCellVal(COLUMNS.status)?.toString().trim().toLowerCase();
          if (status !== 'active' && status !== 'sold' && status !== 'deceased') {
            status = 'active';
          }

          goats.push({
            earTagNumber,
            variant,
            gender: gender as 'male' | 'female',
            purchaseDate,
            purchaseWeight,
            purchasePrice,
            sellerName: 'N/A', // Defaulted here for DB schema compatibility
            notes,
            status: status as 'active' | 'sold' | 'deceased'
          });
        });

        resolve(goats);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read Excel file'));
    reader.readAsArrayBuffer(file);
  });
}
