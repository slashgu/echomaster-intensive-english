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

      console.log(`[API] Fetching lessons for authorId: ${authorId}`);

      const snapshot = await db
        .collection('lessons')
        .where('authorId', '==', authorId)
        .get();

      console.log(`[API] Found ${snapshot.size} lessons in Firestore`);

      const lessons = snapshot.docs.map(doc => {
        try {
          const data = doc.data();
          
          // Defensive timestamp handling
          let createdAtISO = null;
          if (data.createdAt) {
            if (typeof data.createdAt.toDate === 'function') {
              createdAtISO = data.createdAt.toDate().toISOString();
            } else if (data.createdAt instanceof Date) {
              createdAtISO = data.createdAt.toISOString();
            } else if (typeof data.createdAt === 'string') {
              createdAtISO = data.createdAt;
            } else if (data.createdAt && typeof data.createdAt === 'object' && data.createdAt._seconds) {
              // Handle raw Firestore timestamp object if toDate is missing
              createdAtISO = new Date(data.createdAt._seconds * 1000).toISOString();
            }
          }

          return {
            id: doc.id,
            ...data,
            createdAt: createdAtISO,
          };
        } catch (mapErr) {
          console.error(`[API] Error mapping lesson doc ${doc.id}:`, mapErr);
          // Return a minimal version instead of crashing the whole request
          return { id: doc.id, title: 'Error loading lesson data', authorId, createdAt: null };
        }
      }).sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA; // Descending
      });

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
        isConfigured: false,
      });

      return res.status(200).json({ id: lessonRef.id });
    }

    if (req.method === 'PATCH') {
      const { id, title, isConfigured } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'Lesson id is required.' });
      }

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (isConfigured !== undefined) updateData.isConfigured = isConfigured;

      await db.collection('lessons').doc(id).update(updateData);
      return res.status(200).json({ message: 'Lesson updated.' });
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
    return res.status(500).json({ error: `Lessons API error: ${error?.message || 'Unknown error'}` });
  }
}
