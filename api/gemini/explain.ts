import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { phrase, context } = req.body || {};
  if (!phrase || !context) {
    return res.status(400).json({ error: 'Phrase and context are required' });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Explain the meaning of "${phrase}" in the context of this sentence: "${context}". Keep it concise and helpful for an English learner.`,
    });
    return res.status(200).json({ explanation: response.text || "Explanation not available." });
  } catch (error) {
    console.error("Error explaining phrase via API:", error);
    return res.status(500).json({ error: 'Failed to get explanation.' });
  }
}
