/**
 * POST /api/gemini/split
 * Body: { text }
 * Returns: { sentences: string[] }
 *
 * Splits text into short clauses/phrases by punctuation (periods, exclamation
 * marks, question marks, commas, semicolons, colons, dashes).
 * 
 * Pure regex — no Gemini API call, zero token usage.
 */

function splitTextIntoSegments(text: string): string[] {
  // Split on sentence-ending punctuation (.!?) and clause-separating punctuation (,;:—–)
  // Uses lookbehind to keep the punctuation attached to the preceding segment.
  const segments = text
    .split(/(?<=[.!?]+)\s+|(?<=,)\s+|(?<=[;:])\s+|(?<=\s[—–])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // If any segment is still very long (>80 chars), try splitting further at commas or natural breaks
  const result: string[] = [];
  for (const segment of segments) {
    if (segment.length > 80) {
      // Try splitting at commas, semicolons, or " and ", " but ", " or ", " so ", " yet "
      const subSegments = segment
        .split(/(?<=,)\s+|(?<=[;:])\s+|\s+(?=(?:and|but|or|so|yet|because|although|while|when|if)\s)/i)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      result.push(...subSegments);
    } else {
      result.push(segment);
    }
  }

  return result.length > 0 ? result : [text];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  const sentences = splitTextIntoSegments(text);
  return res.status(200).json({ sentences });
}
