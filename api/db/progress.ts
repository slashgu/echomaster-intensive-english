import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware.js';
import { getAdminDb } from '../_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * /api/db/progress
 * GET  ?userId=xxx  — get progress records for a user
 * POST { userId, lessonId, mode, score, answers? } — save progress
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authUser = await verifyAuth(req, res);
  if (!authUser) return;

  const db = getAdminDb();

  try {
    if (req.method === 'GET') {
      const userId = req.query.userId as string;
      if (!userId) {
        return res.status(400).json({ error: 'userId is required.' });
      }

      const snapshot = await db
        .collection('progress')
        .where('userId', '==', userId)
        .orderBy('completedAt', 'desc')
        .get();

      const progress = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        completedAt: doc.data().completedAt?.toDate?.()?.toISOString() || null,
      }));

      return res.status(200).json({ progress });
    }

    if (req.method === 'POST') {
      const progressData = req.body || {};
      if (!progressData.userId || !progressData.lessonId) {
        return res.status(400).json({ error: 'userId and lessonId are required.' });
      }

      const docRef = await db.collection('progress').add({
        ...progressData,
        completedAt: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ id: docRef.id });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error: any) {
    console.error('Progress API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
