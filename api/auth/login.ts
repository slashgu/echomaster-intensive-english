import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getFirebaseApiKey, getAdminDb } from '../_lib/firebaseAdmin.js';

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { idToken, refreshToken, user }
 * 
 * Uses the Firebase Auth REST API to sign in with email/password.
 * This runs server-side on Vercel, so it can reach googleapis.com directly.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const apiKey = getFirebaseApiKey();

    // Use Firebase Auth REST API to sign in
    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      }
    );

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      const errorCode = authData?.error?.message || 'UNKNOWN_ERROR';
      let userMessage = 'Authentication failed.';
      if (errorCode === 'EMAIL_NOT_FOUND' || errorCode === 'INVALID_PASSWORD' || errorCode === 'INVALID_LOGIN_CREDENTIALS') {
        userMessage = 'Invalid email or password.';
      } else if (errorCode === 'USER_DISABLED') {
        userMessage = 'This account has been disabled.';
      } else if (errorCode === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
        userMessage = 'Too many login attempts. Please try again later.';
      }
      return res.status(401).json({ error: userMessage, code: errorCode });
    }

    // Fetch user profile from Firestore
    const db = getAdminDb();
    const userDoc = await db.collection('users').doc(authData.localId).get();
    let userData = {
      uid: authData.localId,
      email: authData.email,
      role: 'student' as const,
      streak: 0,
      lastActive: new Date().toISOString(),
    };

    if (userDoc.exists) {
      const data = userDoc.data()!;
      userData = {
        uid: authData.localId,
        email: authData.email,
        role: data.role || 'student',
        streak: data.streak || 0,
        lastActive: data.lastActive?.toDate?.()?.toISOString() || new Date().toISOString(),
        ...( data.teacherId ? { teacherId: data.teacherId } as any : {}),
        ...( data.inviteCode ? { inviteCode: data.inviteCode } as any : {}),
      };
    }

    return res.status(200).json({
      idToken: authData.idToken,
      refreshToken: authData.refreshToken,
      expiresIn: authData.expiresIn,
      user: userData,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
