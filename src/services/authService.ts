import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { User } from '@/types';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const googleProvider = new GoogleAuthProvider();

// Hardcoded credentials for demo
const DEMO_USERNAME = 'RKT';
const DEMO_PASSWORD = 'Rkte4eraja';

const DEMO_USER: User = {
  id: 'RKT',
  email: 'rkt@goatie.com',
  displayName: 'RKT',
  role: 'farmer',
  createdAt: new Date('2026-06-27T00:00:00.000Z'),
  updatedAt: new Date('2026-06-27T00:00:00.000Z'),
};

// Check if Firebase is initialized
const isFirebaseReady = () => {
  if (!auth || !db) {
    throw new Error('Firebase is not initialized. Please configure your Firebase credentials.');
  }
};

// Check if using demo credentials
export function isDemoMode(): boolean {
  return !auth || !db || localStorage.getItem('goatie_logged_in_user') !== null;
}

export async function registerWithEmail(email: string, password: string, displayName: string): Promise<User> {
  isFirebaseReady();
  const userCredential = await createUserWithEmailAndPassword(auth!, email, password);
  
  await updateProfile(userCredential.user, {
    displayName,
  });

  const user: User = {
    id: userCredential.user.uid,
    email: userCredential.user.email || '',
    displayName: displayName,
    photoURL: userCredential.user.photoURL || undefined,
    role: 'farmer',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Save user to Firestore
  await setDoc(doc(db!, 'users', user.id), user);

  return user;
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  if (email.trim().toUpperCase() === DEMO_USERNAME && password === DEMO_PASSWORD) {
    localStorage.setItem('goatie_logged_in_user', JSON.stringify(DEMO_USER));
    return DEMO_USER;
  }
  isFirebaseReady();
  const userCredential = await signInWithEmailAndPassword(auth!, email, password);
  return await getUserFromFirestore(userCredential.user.uid);
}

export async function loginWithGoogle(): Promise<User> {
  isFirebaseReady();
  const result = await signInWithPopup(auth!, googleProvider);
  
  // Check if user exists in Firestore
  let user = await getUserFromFirestore(result.user.uid);

  if (!user) {
    // Create new user
    user = {
      id: result.user.uid,
      email: result.user.email || '',
      displayName: result.user.displayName || '',
      photoURL: result.user.photoURL || undefined,
      role: 'farmer',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await setDoc(doc(db!, 'users', user.id), user);
  }

  return user;
}

export async function logout(): Promise<void> {
  localStorage.removeItem('goatie_logged_in_user');
  if (auth) {
    await signOut(auth!);
  }
}

export async function getCurrentUser(): Promise<User | null> {
  const cachedDemoUser = localStorage.getItem('goatie_logged_in_user');
  if (cachedDemoUser) {
    try {
      const user = JSON.parse(cachedDemoUser) as User;
      user.createdAt = new Date(user.createdAt);
      user.updatedAt = new Date(user.updatedAt);
      return user;
    } catch (e) {
      console.error('Error parsing cached demo user:', e);
    }
  }
  if (!auth) return null;
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) return null;

  return await getUserFromFirestore(firebaseUser.uid);
}

export async function getUserFromFirestore(userId: string): Promise<User> {
  if (!db) {
    throw new Error('Firebase Firestore is not initialized');
  }
  
  const userDoc = await getDoc(doc(db, 'users', userId));

  if (!userDoc.exists()) {
    throw new Error('User not found');
  }

  return userDoc.data() as User;
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  const cachedDemoUser = localStorage.getItem('goatie_logged_in_user');
  if (cachedDemoUser) {
    try {
      const user = JSON.parse(cachedDemoUser) as User;
      user.createdAt = new Date(user.createdAt);
      user.updatedAt = new Date(user.updatedAt);
      callback(user);
      return () => {};
    } catch (e) {
      console.error('Error parsing cached demo user:', e);
    }
  }

  if (!auth) {
    console.warn('Firebase Auth not initialized');
    callback(null);
    return () => {};
  }
  
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      try {
        const user = await getUserFromFirestore(firebaseUser.uid);
        callback(user);
      } catch (error) {
        console.error('Error fetching user data:', error);
        callback(null);
      }
    } else {
      callback(null);
    }
  });
}

export function getAuthToken(): Promise<string | null> {
  if (localStorage.getItem('goatie_logged_in_user')) {
    return Promise.resolve('demo_token');
  }
  if (!auth || !auth.currentUser) {
    return Promise.resolve(null);
  }
  return auth.currentUser.getIdToken() ?? Promise.resolve(null);
}

