import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware';
import { getAdminDb } from '../_lib/firebaseAdmin';

/**
 * GET /api/auth/me
 * Headers: Authorization: Bearer <idToken>
 * Returns: { user }
 * 
 * Validates the token and returns the current user profile from Firestore.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const authUser = await verifyAuth(req, res);
  if (!authUser) return; // verifyAuth already sent 401

  try {
    const db = getAdminDb();
    const userDoc = await db.collection('users').doc(authUser.uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    const data = userDoc.data()!;
    return res.status(200).json({
      user: {
        uid: authUser.uid,
        email: authUser.email || data.email,
        role: data.role || 'student',
        streak: data.streak || 0,
        lastActive: data.lastActive?.toDate?.()?.toISOString() || new Date().toISOString(),
        ...(data.teacherId ? { teacherId: data.teacherId } : {}),
        ...(data.inviteCode ? { inviteCode: data.inviteCode } : {}),
      },
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
