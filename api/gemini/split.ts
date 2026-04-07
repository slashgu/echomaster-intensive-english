import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text } = req.body || {};
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

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
    
    if (!response.text) return res.status(200).json({ sentences: [text] });
    
    const sentences = JSON.parse(response.text);
    return res.status(200).json({ sentences: Array.isArray(sentences) ? sentences : [text] });
  } catch (error) {
    console.error("Error splitting sentences via API:", error);
    return res.status(200).json({ sentences: text.match(/[^.!?]+[.!?]+/g) || [text] });
  }
}
