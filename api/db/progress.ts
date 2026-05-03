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
        .get();

      const progress = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          completedAt: data.completedAt?.toDate?.()?.toISOString() || null,
          gradedAt: data.gradedAt?.toDate?.()?.toISOString() || null,
        };
      }).sort((a, b) => {
        const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return dateB - dateA; // Descending
      });

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

    if (req.method === 'PATCH') {
      const { id, teacherGrade, teacherComment } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'Progress id is required.' });
      }

      const updateData: any = {
        gradedAt: FieldValue.serverTimestamp(),
        gradedBy: authUser.uid,
      };
      if (teacherGrade !== undefined) {
        updateData.teacherGrade = teacherGrade === null ? FieldValue.delete() : teacherGrade;
      }
      if (teacherComment !== undefined) {
        updateData.teacherComment = teacherComment;
      }

      await db.collection('progress').doc(id).update(updateData);
      return res.status(200).json({ message: 'Progress graded.' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error: any) {
    console.error('Progress API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
