import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware.js';
import { getAdminDb } from '../_lib/firebaseAdmin.js';

// Disable default body parser — audio clip base64 data can exceed the 4.5MB default limit.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * /api/db/sentences
 * GET   ?lessonId=xxx                          — list sentences for a lesson
 * POST  { lessonId, text, audioBase64, explanation, orderIndex, gapIndexes? } — add sentence
 * PATCH { lessonId, sentenceId, gapIndexes }   — update gap indexes
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authUser = await verifyAuth(req, res);
  if (!authUser) return;

  // Parse body manually for POST/PATCH (since we disabled the default body parser)
  if (req.method === 'POST' || req.method === 'PATCH') {
    try {
      const raw = await readRawBody(req);
      (req as any).body = JSON.parse(raw.toString('utf-8'));
    } catch {
      return res.status(400).json({ error: 'Invalid request body' });
    }
  }

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
      const { lessonId, sentenceId, gapIndexes, updates, isBatch } = req.body || {};
      
      if (!lessonId) {
        return res.status(400).json({ error: 'lessonId is required.' });
      }

      const batch = db.batch();
      let hasUpdates = false;

      if (isBatch && Array.isArray(updates)) {
        updates.forEach((update: any) => {
          if (update.sentenceId && Array.isArray(update.gapIndexes)) {
            const ref = db.doc(`lessons/${lessonId}/sentences/${update.sentenceId}`);
            batch.update(ref, { gapIndexes: update.gapIndexes });
            hasUpdates = true;
          }
        });
      } else if (sentenceId) {
        const ref = db.doc(`lessons/${lessonId}/sentences/${sentenceId}`);
        batch.update(ref, { gapIndexes });
        hasUpdates = true;
      }

      if (hasUpdates) {
        // Also update the parent lesson's configured status
        const lessonRef = db.doc(`lessons/${lessonId}`);
        batch.update(lessonRef, { isConfigured: true });
        
        await batch.commit();
        return res.status(200).json({ message: 'Gaps updated and lesson configured.' });
      }

      return res.status(400).json({ error: 'No valid updates provided.' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error: any) {
    console.error('Sentences API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
