import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyAuth } from '../_lib/authMiddleware';
import { getAdminAuth } from '../_lib/firebaseAdmin';

/**
 * POST /api/auth/logout
 * Headers: Authorization: Bearer <idToken>
 * 
 * Revokes refresh tokens for the user, effectively logging them out on all devices.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const authUser = await verifyAuth(req, res);
  if (!authUser) return;

  try {
    await getAdminAuth().revokeRefreshTokens(authUser.uid);
    return res.status(200).json({ message: 'Logged out successfully.' });
  } catch (error: any) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
