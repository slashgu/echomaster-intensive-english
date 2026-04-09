import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getFirebaseApiKey } from '../_lib/firebaseAdmin';

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 * Returns: { idToken, refreshToken, expiresIn }
 * 
 * Refreshes an expired Firebase ID token using the refresh token.
 * Firebase ID tokens expire after 1 hour, so the client must refresh periodically.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required.' });
  }

  try {
    const apiKey = getFirebaseApiKey();

    const response = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errorCode = data?.error?.message || 'UNKNOWN_ERROR';
      return res.status(401).json({ error: 'Token refresh failed.', code: errorCode });
    }

    return res.status(200).json({
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    });
  } catch (error: any) {
    console.error('Token refresh error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
