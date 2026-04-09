import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware';
import { getAdminDb } from '../_lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * POST /api/db/users
 * Body: { uid, email, role, teacherId?, inviteCode? }
 * 
 * Ensures a user document exists in Firestore (upsert).
 * Mirrors the logic from firebaseDbService.ensureUserExists.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const authUser = await verifyAuth(req, res);
  if (!authUser) return;

  const { uid, email, role, teacherId, inviteCode: providedInviteCode } = req.body || {};
  if (!uid || !email) {
    return res.status(400).json({ error: 'uid and email are required.' });
  }

  // Security: only allow users to upsert their own doc
  if (uid !== authUser.uid) {
    return res.status(403).json({ error: 'Cannot modify another user.' });
  }

  const db = getAdminDb();

  try {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();

    let inviteCode = providedInviteCode;

    if (!snap.exists) {
      // Create new user
      inviteCode = role === 'teacher'
        ? Math.random().toString(36).substring(2, 8).toUpperCase()
        : undefined;

      const userData: Record<string, any> = {
        uid,
        email,
        role: role || 'student',
        streak: 0,
        lastActive: FieldValue.serverTimestamp(),
      };
      if (inviteCode) userData.inviteCode = inviteCode;
      if (teacherId) userData.teacherId = teacherId;

      await userRef.set(userData);
    } else {
      // Update existing user
      const data = snap.data()!;
      inviteCode = data.inviteCode;
      
      const determinedRole = email === 'guchengslash@gmail.com' 
        ? 'teacher' 
        : (data.role || role || 'student');
      
      if (determinedRole === 'teacher' && !inviteCode) {
        inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      }

      const updateData: Record<string, any> = {
        uid,
        email: email || data.email,
        role: determinedRole,
        streak: data.streak ?? 0,
        lastActive: FieldValue.serverTimestamp(),
      };
      if (inviteCode) updateData.inviteCode = inviteCode;

      await userRef.set(updateData, { merge: true });
    }

    // Read back the final state
    const finalSnap = await userRef.get();
    const finalData = finalSnap.data()!;

    return res.status(200).json({
      user: {
        uid: finalData.uid,
        email: finalData.email,
        role: finalData.role,
        streak: finalData.streak || 0,
        lastActive: finalData.lastActive?.toDate?.()?.toISOString() || new Date().toISOString(),
        ...(finalData.teacherId ? { teacherId: finalData.teacherId } : {}),
        ...(finalData.inviteCode ? { inviteCode: finalData.inviteCode } : {}),
      },
    });
  } catch (error: any) {
    console.error('Users API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
