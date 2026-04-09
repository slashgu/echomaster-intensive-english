import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware';
import { getAdminDb } from '../_lib/firebaseAdmin';

/**
 * /api/db/students
 * GET  ?teacherId=xxx             — list students for a teacher
 * POST { studentId, inviteCode }  — link student to teacher via invite code
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
        .collection('users')
        .where('role', '==', 'student')
        .where('teacherId', '==', teacherId)
        .get();

      const students = snapshot.docs.map(doc => doc.data());
      return res.status(200).json({ students });
    }

    if (req.method === 'POST') {
      const { studentId, inviteCode } = req.body || {};
      if (!studentId || !inviteCode) {
        return res.status(400).json({ error: 'studentId and inviteCode are required.' });
      }

      // Find teacher by invite code
      const teacherSnapshot = await db
        .collection('users')
        .where('role', '==', 'teacher')
        .where('inviteCode', '==', inviteCode)
        .get();

      if (teacherSnapshot.empty) {
        return res.status(404).json({ error: 'Invalid invite code.' });
      }

      const teacherDoc = teacherSnapshot.docs[0];
      const teacherId = teacherDoc.data().uid;

      // Link student to teacher
      await db.collection('users').doc(studentId).set(
        { teacherId },
        { merge: true }
      );

      return res.status(200).json({ message: 'Student linked to teacher.', teacherId });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error: any) {
    console.error('Students API error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
