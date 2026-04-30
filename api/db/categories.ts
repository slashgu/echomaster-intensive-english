import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware.js';
import { getAdminDb } from '../_lib/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * /api/db/categories
 * GET    ?teacherId=xxx        — list categories for a teacher
 * POST   { name, color }      — create a category
 * DELETE ?id=xxx              — delete a category
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authUser = await verifyAuth(req, res);
  if (!authUser) return;

  const db = getAdminDb();

  try {
    if (req.method === 'GET') {
      const teacherId = req.query.teacherId as string;
      if (!teacherId) {
        return res.status(400).json({ error: 'teacherId is required.' });
      }

      const snapshot = await db
        .collection('lessonCategories')
        .where('teacherId', '==', teacherId)
        .get();

      const categories = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAtISO = null;
        if (data.createdAt) {
          if (typeof data.createdAt.toDate === 'function') {
            createdAtISO = data.createdAt.toDate().toISOString();
          } else if (data.createdAt instanceof Date) {
            createdAtISO = data.createdAt.toISOString();
          } else if (typeof data.createdAt === 'string') {
            createdAtISO = data.createdAt;
          }
        }
        return { id: doc.id, ...data, createdAt: createdAtISO };
      }).sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt as string).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt as string).getTime() : 0;
        return dateA - dateB; // Ascending — oldest first
      });

      return res.status(200).json({ categories });
    }

    if (req.method === 'POST') {
      const { name, color } = req.body || {};
      if (!name) {
        return res.status(400).json({ error: 'Name is required.' });
      }

      const ref = db.collection('lessonCategories').doc();
      await ref.set({
        name,
        color: color || '#6366f1',
        teacherId: authUser.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ id: ref.id });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id as string;
      if (!id) {
        return res.status(400).json({ error: 'id is required.' });
      }

      await db.collection('lessonCategories').doc(id).delete();

      // Unassign category from all lessons that had it
      const lessonsSnapshot = await db
        .collection('lessons')
        .where('categoryId', '==', id)
        .get();

      const batch = db.batch();
      lessonsSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { categoryId: FieldValue.delete() });
      });
      await batch.commit();

      return res.status(200).json({ message: 'Category deleted.' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error: any) {
    console.error('Categories API error:', error);
    return res.status(500).json({ error: `Categories API error: ${error?.message || 'Unknown error'}` });
  }
}
