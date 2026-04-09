import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK
// Uses FIREBASE_SERVICE_ACCOUNT env var (JSON string of the service account key)
// and FIREBASE_DATABASE_ID for the specific Firestore database.

let initialized = false;

function ensureInitialized() {
  if (initialized) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT environment variable is not set. ' +
      'Set it to the JSON string of your Firebase service account key.'
    );
  }

  const serviceAccount = JSON.parse(serviceAccountJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  initialized = true;
}

export function getAdminAuth(): admin.auth.Auth {
  ensureInitialized();
  return admin.auth();
}

export function getAdminDb(): admin.firestore.Firestore {
  ensureInitialized();
  const databaseId = process.env.FIREBASE_DATABASE_ID || '(default)';
  // For named databases, use the initializeFirestore method
  if (databaseId !== '(default)') {
    return new admin.firestore.Firestore({
      projectId: admin.app().options.projectId as string,
      databaseId,
    });
  }
  return admin.firestore();
}

// Firebase project config — used by the Auth REST API for email/password sign-in
export function getFirebaseApiKey(): string {
  // Reuse the existing VITE_FIREBASE_API_KEY that's already in Vercel env vars
  const key = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY;
  if (!key) {
    throw new Error('VITE_FIREBASE_API_KEY (or FIREBASE_API_KEY) environment variable is not set.');
  }
  return key;
}
