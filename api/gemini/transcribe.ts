import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { audioBase64, mimeType } = req.body || {};
  if (!audioBase64) {
    return res.status(400).json({ error: 'audioBase64 is required' });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'audio/wav',
                data: audioBase64,
              },
            },
            {
              text: 'Transcribe this audio into English text. Return ONLY the transcript, no extra commentary or formatting. Preserve the original wording exactly as spoken.',
            },
          ],
        },
      ],
    });

    const transcript = response.text?.trim();
    if (!transcript) {
      return res.status(500).json({ error: 'No transcript returned' });
    }

    return res.status(200).json({ transcript });
  } catch (error) {
    console.error("Error transcribing audio via API:", error);
    return res.status(500).json({ error: 'Failed to transcribe audio.' });
  }
}
