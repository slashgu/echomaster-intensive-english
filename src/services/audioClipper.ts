/**
 * Audio clipping utilities for lesson creation.
 *
 * Provides client-side audio processing using the Web Audio API:
 * - Decode uploaded audio files into AudioBuffers
 * - Detect silence regions via RMS amplitude analysis
 * - Compute sentence boundaries from silence gaps
 * - Slice AudioBuffers into per-sentence clips
 * - Encode clips as base64 WAV for Firestore storage
 */

// ── Types ───────────────────────────────────────────────────────────────

export interface SilenceRegion {
  /** Start time in seconds */
  start: number;
  /** End time in seconds */
  end: number;
  /** Duration in seconds */
  duration: number;
}

export interface SilenceDetectionOptions {
  /** RMS window size in seconds (default: 0.02 = 20ms) */
  windowSize?: number;
  /** RMS threshold below which audio is considered silent (default: 0.01) */
  silenceThreshold?: number;
  /** Minimum silence duration in seconds to count as a gap (default: 0.3) */
  minSilenceDuration?: number;
}

export interface BoundaryResult {
  /** Sorted array of timestamps (in seconds) where clips start. First is always 0. */
  boundaries: number[];
  /** Whether the algorithm fell back to even-splitting */
  usedFallback: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_WINDOW_SIZE = 0.02; // 20ms
const DEFAULT_SILENCE_THRESHOLD = 0.01;
const DEFAULT_MIN_SILENCE_DURATION = 0.3; // 300ms
const BOUNDARY_PADDING = 0.1; // 100ms padding around boundaries

// ── Core Functions ──────────────────────────────────────────────────────

/**
 * Decode an audio File into an AudioBuffer using the Web Audio API.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBuffer;
  } finally {
    await audioContext.close();
  }
}

/**
 * Scan an AudioBuffer and detect silence regions using RMS amplitude analysis.
 *
 * Algorithm:
 * 1. Divide audio into small windows (default 20ms)
 * 2. Compute RMS for each window
 * 3. Group consecutive below-threshold windows into silence regions
 * 4. Filter out regions shorter than minSilenceDuration
 */
export function detectSilences(
  buffer: AudioBuffer,
  options: SilenceDetectionOptions = {}
): SilenceRegion[] {
  const {
    windowSize = DEFAULT_WINDOW_SIZE,
    silenceThreshold = DEFAULT_SILENCE_THRESHOLD,
    minSilenceDuration = DEFAULT_MIN_SILENCE_DURATION,
  } = options;

  const sampleRate = buffer.sampleRate;
  const samplesPerWindow = Math.floor(sampleRate * windowSize);
  const channelData = buffer.getChannelData(0); // Use first channel
  const totalSamples = channelData.length;

  const silences: SilenceRegion[] = [];
  let silenceStart: number | null = null;

  for (let i = 0; i < totalSamples; i += samplesPerWindow) {
    const windowEnd = Math.min(i + samplesPerWindow, totalSamples);

    // Compute RMS for this window
    let sumSquares = 0;
    for (let j = i; j < windowEnd; j++) {
      sumSquares += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sumSquares / (windowEnd - i));

    const timeInSeconds = i / sampleRate;

    if (rms < silenceThreshold) {
      // We're in a silent region
      if (silenceStart === null) {
        silenceStart = timeInSeconds;
      }
    } else {
      // We've exited silence
      if (silenceStart !== null) {
        const silenceEnd = timeInSeconds;
        const duration = silenceEnd - silenceStart;
        if (duration >= minSilenceDuration) {
          silences.push({ start: silenceStart, end: silenceEnd, duration });
        }
        silenceStart = null;
      }
    }
  }

  // Handle trailing silence
  if (silenceStart !== null) {
    const silenceEnd = totalSamples / sampleRate;
    const duration = silenceEnd - silenceStart;
    if (duration >= minSilenceDuration) {
      silences.push({ start: silenceStart, end: silenceEnd, duration });
    }
  }

  return silences;
}

/**
 * Given detected silences and a sentence count, compute clip boundaries.
 *
 * Picks the top N-1 longest silences (where N = sentenceCount), places
 * boundaries at the center of each silence gap. Falls back to even-splitting
 * if insufficient silences are found.
 */
export function computeBoundaries(
  silences: SilenceRegion[],
  sentenceCount: number,
  totalDuration: number
): BoundaryResult {
  const neededBoundaries = sentenceCount - 1;

  if (neededBoundaries <= 0) {
    return { boundaries: [0], usedFallback: false };
  }

  if (silences.length < neededBoundaries) {
    // Not enough silences detected — fall back to even splitting
    const boundaries = [0];
    const segmentDuration = totalDuration / sentenceCount;
    for (let i = 1; i < sentenceCount; i++) {
      boundaries.push(segmentDuration * i);
    }
    return { boundaries, usedFallback: true };
  }

  // Sort silences by duration (longest first) and pick top N-1
  const rankedSilences = [...silences]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, neededBoundaries);

  // Sort selected silences by position (left to right)
  rankedSilences.sort((a, b) => a.start - b.start);

  // Place boundaries at the center of each silence gap
  const boundaries = [0];
  for (const silence of rankedSilences) {
    const center = (silence.start + silence.end) / 2;
    boundaries.push(Math.max(BOUNDARY_PADDING, center));
  }

  return { boundaries, usedFallback: false };
}

/**
 * Slice a region from an AudioBuffer, returning a new AudioBuffer.
 */
export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(buffer.length, Math.floor(endSec * sampleRate));
  const length = endSample - startSample;

  if (length <= 0) {
    // Return a tiny silent buffer rather than erroring
    const ctx = new OfflineAudioContext(buffer.numberOfChannels, 1, sampleRate);
    return ctx.startRendering() as unknown as AudioBuffer;
  }

  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    length,
    sampleRate
  );
  const newBuffer = offlineCtx.createBuffer(
    buffer.numberOfChannels,
    length,
    sampleRate
  );

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const sourceData = buffer.getChannelData(ch);
    const targetData = newBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      targetData[i] = sourceData[startSample + i];
    }
  }

  return newBuffer;
}

/**
 * Encode an AudioBuffer as a base64 WAV string.
 *
 * Produces 16-bit PCM WAV, compatible with the existing getAudioSrc()
 * function in StudyRoom.tsx and the Gemini TTS output format.
 */
export function audioBufferToWavBase64(buffer: AudioBuffer): string {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;

  // Interleave channels if stereo, or use mono directly
  let interleaved: Float32Array;
  if (numChannels === 1) {
    interleaved = buffer.getChannelData(0);
  } else {
    interleaved = new Float32Array(buffer.length * numChannels);
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        interleaved[i * numChannels + ch] = buffer.getChannelData(ch)[i];
      }
    }
  }

  const dataLength = interleaved.length * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // WAV header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1 size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  // Convert to base64
  let binary = '';
  const bytes = new Uint8Array(wavBuffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convenience: compute even-split boundaries (used as fallback).
 */
export function computeEvenBoundaries(
  totalDuration: number,
  sentenceCount: number
): number[] {
  const boundaries = [0];
  const segmentDuration = totalDuration / sentenceCount;
  for (let i = 1; i < sentenceCount; i++) {
    boundaries.push(segmentDuration * i);
  }
  return boundaries;
}

/**
 * Downsample a time range from an AudioBuffer to a compact mono WAV Blob.
 *
 * Used for chunked transcription: each ~2-min segment at 16kHz mono 16-bit
 * produces ~3.8 MB, safely under Vercel's 4.5 MB request body limit.
 *
 * @param buffer     - Source AudioBuffer (any sample rate / channels)
 * @param startSec   - Start time in seconds
 * @param endSec     - End time in seconds
 * @param targetRate - Target sample rate (default 16000 Hz)
 * @returns A WAV Blob ready to send as raw binary
 */
export async function downsampleToWavBlob(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  targetRate = 16000
): Promise<Blob> {
  const duration = endSec - startSec;
  const targetLength = Math.ceil(duration * targetRate);

  // Use OfflineAudioContext to resample to target rate, mono
  const offlineCtx = new OfflineAudioContext(1, targetLength, targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0, startSec, duration);

  const resampled = await offlineCtx.startRendering();

  // Encode the resampled buffer as 16-bit PCM WAV
  const samples = resampled.getChannelData(0);
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);  // 16-bit
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}
