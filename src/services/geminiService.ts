import { ILLMService } from './types';

export const geminiLLMService: ILLMService = {
  async splitIntoSentences(text: string): Promise<string[]> {
    try {
      const response = await fetch('/api/gemini/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to split sentences');
      return data.sentences;
    } catch (error) {
      console.error("Error splitting sentences:", error);
      return text.match(/[^.!?]+[.!?]+/g) || [text];
    }
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
