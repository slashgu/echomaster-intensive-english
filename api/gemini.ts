import { GoogleGenAI, Modality } from "@google/genai";
import fs from 'fs';
import path from 'path';
import os from 'os';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Disable default body parser to handle large audio payloads (>4.5MB)
// that exceed Vercel's default JSON body parser limit.
export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

/**
 * Parse raw request body as JSON string.
 * Reads the stream manually to bypass Vercel's body parser size limit.
 */
function parseRawBody(req): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Unified Gemini API endpoint.
 *
 * Dispatches by `action` field in the request body:
 *   - "audio"      → TTS generation
 *   - "explain"    → Phrase explanation
 *   - "transcribe" → Audio transcription (uses Gemini Files API for large files)
 *
 * This consolidation keeps us within Vercel Hobby's 12-function limit.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Parse body manually since we disabled the default body parser
    const body = await parseRawBody(req);
    req.body = body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { action } = req.body || {};

  switch (action) {
    case 'audio':
      return handleAudio(req, res);
    case 'explain':
      return handleExplain(req, res);
    case 'transcribe':
      return handleTranscribe(req, res);
    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}

// ── TTS Audio Generation ─────────────────────────────────────────────

async function handleAudio(req, res) {
  const { sentence } = req.body || {};
  if (!sentence) {
    return res.status(400).json({ error: 'Sentence is required' });
  }

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
    if (!base64Audio) {
      return res.status(500).json({ error: 'No audio returned' });
    }

    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const buffer = new ArrayBuffer(44 + bytes.length);
    const view = new DataView(buffer);
    
    const writeString = (offset, string) => {
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
    
    return res.status(200).json({ audioBase64: btoa(binary) });
  } catch (error) {
    console.error("Error generating audio via API:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// ── Phrase Explanation ───────────────────────────────────────────────

async function handleExplain(req, res) {
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

// ── Audio Transcription (uses Gemini Files API for large payloads) ────

async function handleTranscribe(req, res) {
  const { audioBase64, mimeType } = req.body || {};
  if (!audioBase64) {
    return res.status(400).json({ error: 'audioBase64 is required' });
  }

  let tempFilePath: string | null = null;

  try {
    // Write the audio to a temp file for the Gemini Files API
    const ext = (mimeType || 'audio/mpeg').split('/')[1] || 'mp3';
    tempFilePath = path.join(os.tmpdir(), `transcribe_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFilePath, Buffer.from(audioBase64, 'base64'));

    // Upload to Gemini Files API
    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: {
        mimeType: mimeType || 'audio/mpeg',
      },
    });

    // Generate transcription using the uploaded file reference
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              fileData: {
                mimeType: uploadResult.mimeType || mimeType || 'audio/mpeg',
                fileUri: uploadResult.uri,
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
      return res.status(500).json({ error: 'No transcript returned from Gemini' });
    }

    return res.status(200).json({ transcript });
  } catch (error: any) {
    console.error("Error transcribing audio via API:", error);
    return res.status(500).json({
      error: `Transcription failed: ${error?.message || 'Unknown error'}`,
    });
  } finally {
    // Cleanup temp file
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  }
}
