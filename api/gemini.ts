import { GoogleGenAI, Modality } from "@google/genai";
import fs from 'fs';
import path from 'path';
import os from 'os';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Disable default body parser — we handle JSON and binary bodies ourselves.
export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

/**
 * Read the raw request body as a Buffer.
 */
function readRawBody(req): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Unified Gemini API endpoint.
 *
 * Routing:
 *   - ?action=transcribe  → raw binary body (audio file bytes)
 *   - JSON body { action } → "audio" | "explain"
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Check query param first (used by transcribe to send raw binary)
  const queryAction = req.query?.action;

  if (queryAction === 'transcribe') {
    return handleTranscribe(req, res);
  }

  // For other actions, parse body as JSON
  try {
    const raw = await readRawBody(req);
    req.body = JSON.parse(raw.toString('utf-8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { action } = req.body || {};

  switch (action) {
    case 'audio':
      return handleAudio(req, res);
    case 'explain':
      return handleExplain(req, res);
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

// ── Audio Transcription (raw binary body → Gemini Files API) ─────────

async function handleTranscribe(req, res) {
  const mimeType = (req.query?.mimeType as string) || 'audio/mpeg';

  let tempFilePath: string | null = null;

  try {
    // Read the raw binary body (no base64 — raw audio file bytes)
    const audioBuffer = await readRawBody(req);
    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    // Write to temp file for the Gemini Files API
    const ext = mimeType.split('/')[1] || 'mp3';
    tempFilePath = path.join(os.tmpdir(), `transcribe_${Date.now()}.${ext}`);
    fs.writeFileSync(tempFilePath, audioBuffer);

    // Upload to Gemini Files API
    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType },
    });

    // Generate transcription using the uploaded file reference
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              fileData: {
                mimeType: uploadResult.mimeType || mimeType,
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
    if (tempFilePath) {
      try { fs.unlinkSync(tempFilePath); } catch {}
    }
  }
}
