import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware.js';
import { getAdminDb } from '../_lib/firebaseAdmin.js';

/**
 * /api/db/sentences
 * GET   ?lessonId=xxx                          — list sentences for a lesson
 * POST  { lessonId, text, audioBase64, explanation, orderIndex, gapIndexes? } — add sentence
 * PATCH { lessonId, sentenceId, gapIndexes }   — update gap indexes
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authUser = await verifyAuth(req, res);
  if (!authUser) return;

  const db = getAdminDb();

  try {
    if (req.method === 'GET') {
      const lessonId = req.query.lessonId as string;
      if (!lessonId) {
        return res.status(400).json({ error: 'lessonId is required.' });
      }

      const snapshot = await db
        .collection(`lessons/${lessonId}/sentences`)
        .orderBy('orderIndex', 'asc')
        .get();

      const sentences = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));

      return res.status(200).json({ sentences });
    }

    if (req.method === 'POST') {
      const { lessonId, ...sentenceData } = req.body || {};
      if (!lessonId) {
        return res.status(400).json({ error: 'lessonId is required.' });
      }

      const sentenceRef = db.collection(`lessons/${lessonId}/sentences`).doc();
      await sentenceRef.set(sentenceData);

      return res.status(200).json({ id: sentenceRef.id });
    }

    if (req.method === 'PATCH') {
      const { lessonId, sentenceId, gapIndexes } = req.body || {};
      if (!lessonId || !sentenceId) {
        return res.status(400).json({ error: 'lessonId and sentenceId are required.' });
      }

      await db.doc(`lessons/${lessonId}/sentences/${sentenceId}`).update({ gapIndexes });
      return res.status(200).json({ message: 'Gaps updated.' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error: any) {
    console.error('Sentences API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
