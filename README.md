# GOATIE - Professional Goat Farm Management System

A commercial-grade Progressive Web App (PWA) for managing professional goat farms with real-time notifications, offline capabilities, and comprehensive analytics.

## 🎯 Features

### Core Features
- **Goat Registration**: Complete goat lifecycle management with unique ear tag IDs
- **Weight Tracking**: Automatic 5-stage weight schedule with notifications
- **Health Management**: Deworming and PPR vaccination tracking
- **Sales Management**: Track goat sales with automatic profit calculations
- **Notifications**: Real-time alerts for weight due dates, health records, and sales
- **Analytics Dashboard**: Sales trends, goat distribution, and performance metrics

### PWA Capabilities
- **Offline First**: Complete offline functionality with automatic sync
- **Install to Home Screen**: Works like a native app on mobile and desktop
- **Push Notifications**: Real-time updates even when app is closed
- **Background Sync**: Automatic data synchronization when online
- **Fast Loading**: Optimized bundle with code splitting
- **Responsive Design**: Works seamlessly on phones, tablets, and desktops

### Security & Data
- **Firebase Authentication**: Email and Google login
- **Data Encryption**: Secure Firebase Firestore database
- **User Isolation**: Farmers only see their own data
- **Admin Controls**: Admins can manage all records
- **Backup & Restore**: Export and import farm data

### Dynamic Configuration
- **Google Sheets Integration**: Master data (goat variants, languages) loaded dynamically
- **No Hardcoding**: All configuration managed via Google Sheets
- **Auto-Updates**: Changes reflect immediately in the app

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm/yarn/pnpm
- Firebase project with authentication and Firestore enabled
- Google Sheets API key
- Modern web browser

### Installation

1. **Clone and Install Dependencies**
```bash
npm install
```

2. **Setup Environment Variables**
Create a `.env.local` file (copy from `.env.example`):
```bash
cp .env.example .env.local
```

Configure Firebase and Google Sheets credentials:
```
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
VITE_FIREBASE_APP_ID=your_firebase_app_id

VITE_GOOGLE_SHEETS_API_KEY=your_google_sheets_api_key
VITE_GOOGLE_SHEET_ID=your_google_sheet_id
```

3. **Development Server**
```bash
npm run dev
```

4. **Build for Production**
```bash
npm run build
```

5. **Preview Production Build**
```bash
npm run preview
```

## 📁 Project Structure

```
src/
├── components/           # Reusable UI components
│   ├── ui/             # Shadcn-like base components
│   └── common/         # Common components (Navbar, Toast, etc.)
├── context/            # React Context (Auth, Theme)
├── pages/              # Page components
├── services/           # Firebase and API services
├── lib/                # Firebase config and utilities
├── utils/              # Helper functions
├── types/              # TypeScript type definitions
├── styles/             # Global CSS
└── modules/            # Feature modules (placeholder for expansion)

public/
├── manifest.json       # PWA manifest
├── sw.js              # Service worker
└── browserconfig.xml  # Windows tile config
```

## 🔧 Configuration

### Firebase Setup

1. Create a Firebase project at https://firebase.google.com
2. Enable Authentication (Email/Password and Google)
3. Create a Firestore database
4. Enable Cloud Storage
5. Enable Cloud Messaging
6. Add your web app and get credentials

### Google Sheets Integration

1. Create a Google Sheet with sheets named: "Variants", "Languages"
2. **Variants Sheet**: Headers: Code, Name, Description
3. **Languages Sheet**: Headers: Code, Name, NativeName
4. Share the sheet publicly (View access)
5. Get API key from Google Cloud Console
6. Get Sheet ID from the URL

### Firebase Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
      allow read: if request.auth.uid != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    match /goats/{goatId} {
      allow read, write: if request.auth.uid == resource.data.farmerId;
      allow read, write: if request.auth.uid != null && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    match /{document=**} {
      allow read, write: if request.auth.uid != null && 
                           get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
      allow read: if request.auth.uid != null;
    }
  }
}
```

## 📱 Installing as PWA

### Android
1. Open the app in Chrome
2. Tap menu (⋮) → "Install app"
3. Confirm installation

### iOS
1. Open the app in Safari
2. Tap Share → "Add to Home Screen"
3. Name it "GOATIE"
4. Tap "Add"

### Desktop (Chrome/Edge)
1. Open the app
2. Click install icon (usually top-right address bar)
3. Confirm installation

## 🔐 Authentication

### Email Registration
- Create account with email and password
- Password must be at least 6 characters
- User role automatically set to 'farmer'

### Google Login
- One-click login with existing Google account
- Auto-creates account if first time

## 💾 Offline Mode

- All data is stored in IndexedDB locally
- Changes are queued when offline
- Automatic sync when connection returns
- No data loss or duplication

## 📊 Database Schema

### Collections

#### `users`
```
{
  id: string,
  email: string,
  displayName: string,
  photoURL?: string,
  role: 'admin' | 'farmer',
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### `goats`
```
{
  id: string,
  farmerId: string,
  earTagNumber: string (unique),
  purchaseDate: Timestamp,
  purchaseWeight: number,
  variant: string,
  gender: 'male' | 'female',
  age?: number,
  purchasePrice: number,
  sellerName: string,
  sellerContact?: string,
  notes?: string,
  photoURL?: string,
  qrCode?: string,
  barcode?: string,
  status: 'active' | 'sold' | 'deceased',
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### `weights`
```
{
  id: string,
  goatId: string,
  weightNumber: 0|1|2|3|4,
  weight: number,
  dueDate: Timestamp,
  recordedDate?: Timestamp,
  remarks?: string,
  isRecorded: boolean,
  weightGain?: number,
  monthlyGain?: number,
  growthPercentage?: number,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### `deworming`
```
{
  id: string,
  goatId: string,
  dewormingDate: Timestamp,
  medicineUsed: string,
  batchNumber?: string,
  administeredBy: string,
  remarks?: string,
  status: 'pending' | 'dewormed',
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### `vaccination`
```
{
  id: string,
  goatId: string,
  vaccinationDate: Timestamp,
  vaccineBrand: string,
  batchNumber?: string,
  administeredBy: string,
  remarks?: string,
  status: 'pending' | 'vaccinated',
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

#### `sales`
```
{
  id: string,
  goatId: string,
  saleDate: Timestamp,
  saleWeight: number,
  saleRatePerKg: number,
  buyerName: string,
  buyerContact?: string,
  saleAmount: number,
  commission?: number,
  transportCharges?: number,
  otherCharges?: number,
  netProfit: number,
  profitPercentage: number,
  remarks?: string,
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

## 🎨 Customization

### Theme
Edit colors in `src/styles/globals.css` CSS variables:
```css
:root {
  --primary: 142.4 71.8% 29.2%;
  --secondary: 217.2 91.2% 59.8%;
  /* ... other colors ... */
}
```

### UI Components
Base components in `src/components/ui/` use Tailwind CSS and can be customized.

## 📦 Tech Stack

- **Frontend**: React 18 + TypeScript
- **Bundler**: Vite
- **Styling**: Tailwind CSS + CSS-in-JS
- **State**: Context API + React Query
- **Forms**: React Hook Form + Zod validation
- **Database**: Firebase Firestore + IndexedDB
- **Authentication**: Firebase Auth
- **Charts**: Recharts
- **QR/Barcode**: qrcode.react + jsbarcode
- **Icons**: Lucide React
- **Animation**: Framer Motion

## 🚀 Deployment

### Vercel
```bash
npm run build
vercel deploy --prod
```

### Netlify
```bash
npm run build
netlify deploy --prod --dir=dist
```

### Firebase Hosting
```bash
npm run build
firebase deploy --only hosting
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 5173
CMD ["npm", "run", "preview"]
```

## 🔄 CI/CD

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - uses: JamesIves/github-pages-deploy-action@v4
        with:
          folder: dist
```

## 📝 API Integration

### Sync Offline Data
```typescript
POST /api/sync
{
  "action": {
    "id": "uuid",
    "type": "create|update|delete",
    "collection": "goats|weights|deworming|...",
    "data": { ...document }
  }
}
```

### Export Data
```typescript
GET /api/export?format=pdf|excel|csv
```

## 🐛 Troubleshooting

### Service Worker Not Registering
- Check HTTPS is enabled (required for SW)
- Clear browser cache
- Check browser console for errors

### Offline Sync Not Working
- Ensure IndexedDB is not blocked
- Check Firebase connection
- Verify security rules allow writes

### Push Notifications Not Working
- Enable Cloud Messaging in Firebase
- Request permission in browser
- Check browser notification settings

## 📄 License

Proprietary - Professional Goat Farm Management System

## 🤝 Support

For issues and feature requests, contact: support@goatie.farm

## 🔮 Roadmap

- [ ] Multi-farm support
- [ ] Breeding records
- [ ] Kidding management
- [ ] Medicine inventory
- [ ] Feed management
- [ ] Expense tracking
- [ ] Advanced analytics
- [ ] Mobile app (React Native)
- [ ] API for integrations
- [ ] SMS/WhatsApp alerts

---

**Built with ❤️ for farmers by GOATIE Team**
