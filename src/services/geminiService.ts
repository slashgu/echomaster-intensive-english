import { ILLMService } from './types';
import nlp from 'compromise';
import { decodeAudioFile, downsampleToWavBlob } from './audioClipper';

/** Max segment duration in seconds for chunked transcription */
const TRANSCRIBE_SEGMENT_SEC = 120; // 2 minutes → ~3.8 MB at 16kHz mono

export const geminiLLMService: ILLMService = {
  async splitIntoSentences(text: string): Promise<string[]> {
    // Use Compromise NLP for smart sentence boundary detection.
    // Handles abbreviations (Mr., Dr., e.g.), quoted speech, etc.
    const doc = nlp(text);
    const sentences = doc.sentences().out('array') as string[];

    // If any sentence is still very long (>120 chars), split at natural clause boundaries
    const result: string[] = [];
    for (const sentence of sentences) {
      if (sentence.length > 120) {
        // Split at semicolons, colons, or before conjunctions — but keep fragments together
        const subSegments = sentence
          .split(/(?<=[;:])\s+|\s+(?=(?:and|but|or|so|yet|because|although|while|when|if)\s)/i)
          .map(s => s.trim())
          .filter(s => s.length > 0);
        // Only use sub-splits if they produce reasonably sized chunks (>15 chars each)
        if (subSegments.length > 1 && subSegments.every(s => s.length > 15)) {
          result.push(...subSegments);
        } else {
          result.push(sentence);
        }
      } else {
        result.push(sentence);
      }
    }

    return result.length > 0 ? result : [text];
  },

  async generateAudioForSentence(sentence: string): Promise<string | null> {
    try {
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'audio', sentence }),
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
      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'explain', phrase, context }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to get explanation');
      return data.explanation;
    } catch (error) {
      console.error("Error explaining phrase:", error);
      return "Failed to get explanation.";
    }
  },

  async transcribeAudio(file: File): Promise<string> {
    try {
      // Decode the full file to AudioBuffer (client-side, instant)
      const audioBuffer = await decodeAudioFile(file);
      const totalDuration = audioBuffer.duration;

      // Split into segments of TRANSCRIBE_SEGMENT_SEC each
      const segmentCount = Math.ceil(totalDuration / TRANSCRIBE_SEGMENT_SEC);
      const transcripts: string[] = [];

      for (let i = 0; i < segmentCount; i++) {
        const startSec = i * TRANSCRIBE_SEGMENT_SEC;
        const endSec = Math.min((i + 1) * TRANSCRIBE_SEGMENT_SEC, totalDuration);

        // Downsample segment to 16kHz mono WAV (~3.8 MB per 2 min)
        const wavBlob = await downsampleToWavBlob(audioBuffer, startSec, endSec);

        // Send raw binary to server
        const response = await fetch(
          `/api/gemini?action=transcribe&mimeType=${encodeURIComponent('audio/wav')}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: wavBlob,
          }
        );

        // Handle non-JSON error responses (e.g. Vercel 413)
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await response.text();
          throw new Error(`Server error (${response.status}): ${text.slice(0, 200)}`);
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to transcribe audio');
        transcripts.push(data.transcript);
      }

      return transcripts.join(' ');
    } catch (error: any) {
      console.error("Error transcribing audio:", error);
      throw error;
    }
  }
};

