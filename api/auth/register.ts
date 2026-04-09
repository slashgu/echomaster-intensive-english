import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getFirebaseApiKey, getAdminDb } from '../_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/auth/register
 * Body: { email, password, role }
 * Returns: { idToken, refreshToken, user }
 * 
 * Creates a new user via Firebase Auth REST API and a Firestore user doc.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, password, role = 'student' } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (role !== 'teacher' && role !== 'student') {
    return res.status(400).json({ error: 'Role must be "teacher" or "student".' });
  }

  try {
    const apiKey = getFirebaseApiKey();

    // Create user via Firebase Auth REST API
    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
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
      let userMessage = 'Registration failed.';
      if (errorCode === 'EMAIL_EXISTS') {
        userMessage = 'An account with this email already exists.';
      } else if (errorCode === 'WEAK_PASSWORD' || errorCode.startsWith('WEAK_PASSWORD')) {
        userMessage = 'Password should be at least 6 characters.';
      } else if (errorCode === 'INVALID_EMAIL') {
        userMessage = 'Invalid email address.';
      }
      return res.status(400).json({ error: userMessage, code: errorCode });
    }

    // Create user document in Firestore
    const db = getAdminDb();
    const inviteCode = role === 'teacher'
      ? Math.random().toString(36).substring(2, 8).toUpperCase()
      : null;

    const userData: Record<string, any> = {
      uid: authData.localId,
      email,
      role,
      streak: 0,
      lastActive: FieldValue.serverTimestamp(),
    };
    if (inviteCode) {
      userData.inviteCode = inviteCode;
    }

    await db.collection('users').doc(authData.localId).set(userData);

    return res.status(200).json({
      idToken: authData.idToken,
      refreshToken: authData.refreshToken,
      expiresIn: authData.expiresIn,
      user: {
        uid: authData.localId,
        email,
        role,
        streak: 0,
        lastActive: new Date().toISOString(),
        ...(inviteCode ? { inviteCode } : {}),
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
