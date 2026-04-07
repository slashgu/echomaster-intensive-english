import { GoogleGenAI, Modality, Type } from "@google/genai";
import { ILLMService } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const geminiLLMService: ILLMService = {
  async splitIntoSentences(text: string): Promise<string[]> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Split the following text into individual sentences. Return ONLY a JSON array of strings, where each string is a sentence. Do not include any markdown formatting or other text.\n\nText:\n${text}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING
            }
          }
        }
      });
      
      if (!response.text) return [text];
      
      const sentences = JSON.parse(response.text);
      return Array.isArray(sentences) ? sentences : [text];
    } catch (error) {
      console.error("Error splitting sentences:", error);
      return text.match(/[^.!?]+[.!?]+/g) || [text];
    }
  },

  async generateAudioForSentence(sentence: string): Promise<string | null> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: sentence }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) return null;

      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const buffer = new ArrayBuffer(44 + bytes.length);
      const view = new DataView(buffer);
      
      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };
      
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + bytes.length, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, 24000, true);
      view.setUint32(28, 24000 * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, bytes.length, true);
      
      new Uint8Array(buffer, 44).set(bytes);
      
      let binary = '';
      const finalBytes = new Uint8Array(buffer);
      for (let i = 0; i < finalBytes.length; i++) {
        binary += String.fromCharCode(finalBytes[i]);
      }
      return btoa(binary);
    } catch (error) {
      console.error("Error generating audio:", error);
      return null;
    }
  },

  async explainWordOrPhrase(phrase: string, context: string): Promise<string> {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Explain the meaning of "${phrase}" in the context of this sentence: "${context}". Keep it concise and helpful for an English learner.`,
      });
      return response.text || "Explanation not available.";
    } catch (error) {
      console.error("Error explaining phrase:", error);
      return "Failed to get explanation.";
    }
  }
};
