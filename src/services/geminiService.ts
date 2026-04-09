import { ILLMService } from './types';

export const geminiLLMService: ILLMService = {
  async splitIntoSentences(text: string): Promise<string[]> {
    // Pure regex — no API call, no Gemini tokens, instant.
    const segments = text
      .split(/(?<=[.!?]+)\s+|(?<=,)\s+|(?<=[;:])\s+|(?<=\s[—–])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // If any segment is still very long (>80 chars), split further at natural breaks
    const result: string[] = [];
    for (const segment of segments) {
      if (segment.length > 80) {
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
  },

  async generateAudioForSentence(sentence: string): Promise<string | null> {
    try {
      const response = await fetch('/api/gemini/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate audio');
      return data.audioBase64;
    } catch (error) {
      console.error("Error generating audio:", error);
      return null;
    }
  },

  async explainWordOrPhrase(phrase: string, context: string): Promise<string> {
    try {
      const response = await fetch('/api/gemini/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase, context }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to get explanation');
      return data.explanation;
    } catch (error) {
      console.error("Error explaining phrase:", error);
      return "Failed to get explanation.";
    }
  }
};
