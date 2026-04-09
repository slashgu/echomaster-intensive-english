import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAdminAuth } from './firebaseAdmin.js';

/**
 * Extracts and verifies the Firebase ID token from the Authorization header.
 * Returns the decoded token (contains uid, email, etc.) or sends a 401 response.
 */
export async function verifyAuth(req: VercelRequest, res: VercelResponse): Promise<{ uid: string; email?: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header. Expected: Bearer <token>' });
    return null;
  }

  const idToken = authHeader.split('Bearer ')[1];
  if (!idToken) {
    res.status(401).json({ error: 'No token provided.' });
    return null;
  }

  try {
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);
    return { uid: decodedToken.uid, email: decodedToken.email };
  } catch (error: any) {
    console.error('Token verification failed:', error.message);
    res.status(401).json({ error: 'Invalid or expired token.' });
    return null;
  }
}
