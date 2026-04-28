import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Play, Pause, Save, Loader2, CheckCircle2, AlertTriangle, Volume2 } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { authService, dbService, llmService } from '../services';
import {
  sliceAudioBuffer,
  audioBufferToWavBase64,
} from '../services/audioClipper';

interface AudioClipReviewerProps {
  /** Lesson title provided by the teacher */
  title: string;
  /** Sentences extracted from the transcript */
  sentences: string[];
  /** The decoded AudioBuffer of the uploaded file */
  audioBuffer: AudioBuffer;
  /** Computed boundary timestamps (in seconds). Length = sentences.length, first = 0 */
  initialBoundaries: number[];
  /** Whether the boundaries were computed via fallback (even split) */
  usedFallback: boolean;
  /** Go back to the creator form */
  onBack: () => void;
  /** Called when lesson is fully saved */
  onCreated: (lessonId: string, title: string) => void;
}

// Alternating region colors for visual distinction
const REGION_COLORS = [
  'rgba(99, 102, 241, 0.18)',   // indigo
  'rgba(16, 185, 129, 0.18)',   // emerald
  'rgba(245, 158, 11, 0.18)',   // amber
  'rgba(239, 68, 68, 0.18)',    // red
  'rgba(139, 92, 246, 0.18)',   // violet
  'rgba(6, 182, 212, 0.18)',    // cyan
];

const ACTIVE_REGION_COLORS = [
  'rgba(99, 102, 241, 0.35)',
  'rgba(16, 185, 129, 0.35)',
  'rgba(245, 158, 11, 0.35)',
  'rgba(239, 68, 68, 0.35)',
  'rgba(139, 92, 246, 0.35)',
  'rgba(6, 182, 212, 0.35)',
];

export function AudioClipReviewer({
  title,
  sentences,
  audioBuffer,
  initialBoundaries,
  usedFallback,
  onBack,
  onCreated,
}: AudioClipReviewerProps) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);

  const [boundaries, setBoundaries] = useState<number[]>(initialBoundaries);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0, status: '' });
  const [error, setError] = useState('');
  const [isReady, setIsReady] = useState(false);

  const totalDuration = audioBuffer.duration;

  // ── Initialize WaveSurfer ──────────────────────────────────────────
  useEffect(() => {
    if (!waveformRef.current) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: '#c7d2fe',
      progressColor: '#6366f1',
      cursorColor: '#4f46e5',
      cursorWidth: 2,
      height: 128,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      plugins: [regions],
    });

    wavesurferRef.current = ws;

    // Load from AudioBuffer — create a WAV blob
    const wavBlob = audioBufferToBlob(audioBuffer);
    ws.loadBlob(wavBlob);

    ws.on('ready', () => {
      setIsReady(true);
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
      regionsRef.current = null;
    };
  }, []);

  // ── Sync regions with boundaries ───────────────────────────────────
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !isReady) return;

    // Clear existing regions
    regions.clearRegions();

    // Create a region for each sentence
    for (let i = 0; i < sentences.length; i++) {
      const start = boundaries[i];
      const end = i < sentences.length - 1 ? boundaries[i + 1] : totalDuration;
      const isActive = activeSentenceIndex === i;

      const region = regions.addRegion({
        id: `sentence-${i}`,
        start,
        end,
        color: isActive
          ? ACTIVE_REGION_COLORS[i % ACTIVE_REGION_COLORS.length]
          : REGION_COLORS[i % REGION_COLORS.length],
        drag: false,
        resize: true,
        minLength: 0.2,
      });

      // When a region is resized, update boundaries
      region.on('update-end', () => {
        setBoundaries(prev => {
          const updated = [...prev];
          updated[i] = region.start;
          if (i < sentences.length - 1) {
            updated[i + 1] = region.end;
          }
          return updated;
        });
      });
    }
  }, [boundaries, isReady, activeSentenceIndex, sentences.length, totalDuration]);

  // ── Play a specific sentence clip ──────────────────────────────────
  const playSentence = useCallback((index: number) => {
    const ws = wavesurferRef.current;
    if (!ws || !isReady) return;

    setActiveSentenceIndex(index);

    const start = boundaries[index];
    const end = index < sentences.length - 1 ? boundaries[index + 1] : totalDuration;

    ws.setTime(start);
    ws.play();

    // Stop at the end of the region
    const checkPosition = () => {
      if (ws.getCurrentTime() >= end) {
        ws.pause();
        return;
      }
      if (ws.isPlaying()) {
        requestAnimationFrame(checkPosition);
      }
    };
    requestAnimationFrame(checkPosition);
  }, [boundaries, isReady, sentences.length, totalDuration]);

  // ── Save the lesson ────────────────────────────────────────────────
  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setSaveProgress({ current: 0, total: sentences.length, status: 'Creating lesson...' });

    try {
      const user = authService.getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      const lessonId = await dbService.createLesson(title, user.uid, sentences.length);

      for (let i = 0; i < sentences.length; i++) {
        const sentenceText = sentences[i].trim();
        if (!sentenceText) continue;

        setSaveProgress({
          current: i + 1,
          total: sentences.length,
          status: `Processing sentence ${i + 1}/${sentences.length}...`,
        });

        const start = boundaries[i];
        const end = i < sentences.length - 1 ? boundaries[i + 1] : totalDuration;

        // Slice the audio for this sentence
        const clipBuffer = sliceAudioBuffer(audioBuffer, start, end);
        const audioBase64 = audioBufferToWavBase64(clipBuffer);

        // Generate explanation in parallel with save
        let explanation = '';
        try {
          explanation = await llmService.explainWordOrPhrase(sentenceText, sentenceText);
        } catch {
          // Non-critical — continue without explanation
        }

        await dbService.addSentenceToLesson(lessonId, {
          text: sentenceText,
          audioBase64,
          explanation,
          orderIndex: i,
        });
      }

      onCreated(lessonId, title);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save lesson.');
      setIsSaving(false);
    }
  };

  // ── Format time as mm:ss.ms ────────────────────────────────────────
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button
            onClick={onBack}
            disabled={isSaving}
            className="flex items-center text-gray-600 hover:text-gray-900 disabled:opacity-50"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back
          </button>
          <h2 className="text-lg font-semibold text-gray-900 truncate px-4">
            Review Audio Clips: {title}
          </h2>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Approve & Save
              </>
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
        {/* Fallback warning */}
        {usedFallback && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Not enough silence gaps detected — boundaries were evenly split.
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Drag the region edges on the waveform below to align each clip with its sentence.
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Saving progress */}
        {isSaving && (
          <div className="rounded-md bg-blue-50 p-4">
            <div className="flex">
              <Loader2 className="h-5 w-5 text-blue-400 animate-spin flex-shrink-0" />
              <div className="ml-3 flex-1 md:flex md:justify-between">
                <p className="text-sm text-blue-700">{saveProgress.status}</p>
                <p className="mt-1 text-sm text-blue-700 md:mt-0 md:ml-6">
                  {saveProgress.current} / {saveProgress.total}
                </p>
              </div>
            </div>
            <div className="mt-3 w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(saveProgress.current / saveProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Waveform */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wider">
              Waveform — Drag region edges to adjust boundaries
            </h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const ws = wavesurferRef.current;
                  if (!ws) return;
                  if (ws.isPlaying()) {
                    ws.pause();
                  } else {
                    ws.play();
                  }
                }}
                disabled={!isReady}
                className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <span className="text-xs text-gray-400 font-mono">
                {formatTime(totalDuration)}
              </span>
            </div>
          </div>
          <div
            ref={waveformRef}
            className="w-full rounded-lg overflow-hidden bg-gray-50 border border-gray-100"
          />
          {!isReady && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading waveform...
            </div>
          )}
        </div>

        {/* Sentence list */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wider">
              Sentences ({sentences.length})
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Click the play button to audition each clip. Adjust boundaries on the waveform above if needed.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {sentences.map((sentence, index) => {
              const start = boundaries[index];
              const end = index < sentences.length - 1 ? boundaries[index + 1] : totalDuration;
              const duration = end - start;
              const isActive = activeSentenceIndex === index;

              return (
                <li
                  key={index}
                  className={`px-6 py-4 flex items-start gap-4 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-indigo-50 border-l-4 border-indigo-500'
                      : 'hover:bg-gray-50 border-l-4 border-transparent'
                  }`}
                  onClick={() => setActiveSentenceIndex(index)}
                >
                  {/* Sentence number */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-mono text-gray-500">
                    {index + 1}
                  </div>

                  {/* Sentence text */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 leading-relaxed">{sentence}</p>
                    <p className="text-xs text-gray-400 mt-1 font-mono">
                      {formatTime(start)} — {formatTime(end)} ({duration.toFixed(1)}s)
                    </p>
                  </div>

                  {/* Play button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playSentence(index);
                    }}
                    disabled={!isReady}
                    className="flex-shrink-0 p-2 text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors disabled:opacity-50"
                    title={`Play sentence ${index + 1}`}
                  >
                    <Volume2 className="h-5 w-5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}

// ── Helper: Convert AudioBuffer to a WAV Blob for WaveSurfer ─────────

function audioBufferToBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;

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

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}
