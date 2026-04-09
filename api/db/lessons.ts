import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware.js';
import { getAdminDb } from '../_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * /api/db/lessons
 * GET    ?authorId=xxx        — list lessons for a teacher
 * POST   { title, sentenceCount } — create a lesson
 * DELETE ?id=xxx              — delete a lesson
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authUser = await verifyAuth(req, res);
  if (!authUser) return;

  const db = getAdminDb();

  try {
    if (req.method === 'GET') {
      const authorId = req.query.authorId as string;
      if (!authorId) {
        return res.status(400).json({ error: 'authorId is required.' });
      }

      const snapshot = await db
        .collection('lessons')
        .where('authorId', '==', authorId)
        .orderBy('createdAt', 'desc')
        .get();

      const lessons = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
      }));

      return res.status(200).json({ lessons });
    }

    if (req.method === 'POST') {
      const { title, sentenceCount } = req.body || {};
      if (!title) {
        return res.status(400).json({ error: 'Title is required.' });
      }

      const lessonRef = db.collection('lessons').doc();
      await lessonRef.set({
        title,
        authorId: authUser.uid,
        createdAt: FieldValue.serverTimestamp(),
        sentenceCount: sentenceCount || 0,
      });

      return res.status(200).json({ id: lessonRef.id });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) {
        return res.status(400).json({ error: 'Lesson id is required.' });
      }

      await db.collection('lessons').doc(id).delete();
      return res.status(200).json({ message: 'Lesson deleted.' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error: any) {
    console.error('Lessons API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
