import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Play, Pause, Save, Loader2, AlertTriangle, Volume2, Merge, Scissors, X, Check } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { authService, dbService, llmService } from '../services';
import { downsampleToWavBlob } from '../services/audioClipper';

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
  sentences: initialSentences,
  audioBuffer,
  initialBoundaries,
  usedFallback,
  onBack,
  onCreated,
}: AudioClipReviewerProps) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);

  // Mutable state for sentences & boundaries (editable via merge/split)
  const [sentenceList, setSentenceList] = useState<string[]>(initialSentences);
  const [boundaries, setBoundaries] = useState<number[]>(initialBoundaries);

  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0, status: '' });
  const [error, setError] = useState('');
  const [isReady, setIsReady] = useState(false);

  // Split mode state
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitTextPos, setSplitTextPos] = useState(0);

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
    for (let i = 0; i < sentenceList.length; i++) {
      const start = boundaries[i];
      const end = i < sentenceList.length - 1 ? boundaries[i + 1] : totalDuration;
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
          if (i < sentenceList.length - 1) {
            updated[i + 1] = region.end;
          }
          return updated;
        });
      });
    }
  }, [boundaries, isReady, activeSentenceIndex, sentenceList.length, totalDuration]);

  // ── Play a specific sentence clip ──────────────────────────────────
  const playSentence = useCallback((index: number) => {
    const ws = wavesurferRef.current;
    if (!ws || !isReady) return;

    setActiveSentenceIndex(index);

    const start = boundaries[index];
    const end = index < sentenceList.length - 1 ? boundaries[index + 1] : totalDuration;

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
  }, [boundaries, isReady, sentenceList.length, totalDuration]);

  // ── Merge: combine sentence[index] with sentence[index+1] ─────────
  const handleMerge = useCallback((index: number) => {
    if (index >= sentenceList.length - 1) return;

    setSentenceList(prev => {
      const updated = [...prev];
      // Combine the two sentences
      updated[index] = `${updated[index]} ${updated[index + 1]}`;
      // Remove the next sentence
      updated.splice(index + 1, 1);
      return updated;
    });

    setBoundaries(prev => {
      const updated = [...prev];
      // Remove the boundary between the two merged sentences
      updated.splice(index + 1, 1);
      return updated;
    });

    // Reset active selection
    setActiveSentenceIndex(index);
    setSplitIndex(null);
  }, [sentenceList.length]);

  // ── Split: open split mode for a sentence ──────────────────────────
  const handleStartSplit = useCallback((index: number) => {
    const text = sentenceList[index];
    // Default split position: find the nearest space to the middle
    const mid = Math.floor(text.length / 2);
    let pos = mid;
    // Search for the nearest space
    for (let d = 0; d < text.length; d++) {
      if (mid + d < text.length && text[mid + d] === ' ') { pos = mid + d; break; }
      if (mid - d >= 0 && text[mid - d] === ' ') { pos = mid - d; break; }
    }
    setSplitIndex(index);
    setSplitTextPos(pos);
  }, [sentenceList]);

  const handleConfirmSplit = useCallback(() => {
    if (splitIndex === null) return;

    const text = sentenceList[splitIndex];
    const part1 = text.slice(0, splitTextPos).trim();
    const part2 = text.slice(splitTextPos).trim();

    if (!part1 || !part2) {
      setError('Both parts must contain text.');
      return;
    }

    // Calculate the audio split point: proportional to text position
    const start = boundaries[splitIndex];
    const end = splitIndex < sentenceList.length - 1
      ? boundaries[splitIndex + 1]
      : totalDuration;
    const ratio = splitTextPos / text.length;
    const audioSplitTime = start + (end - start) * ratio;

    setSentenceList(prev => {
      const updated = [...prev];
      updated.splice(splitIndex, 1, part1, part2);
      return updated;
    });

    setBoundaries(prev => {
      const updated = [...prev];
      // Insert a new boundary at the audio split point
      updated.splice(splitIndex + 1, 0, audioSplitTime);
      return updated;
    });

    setSplitIndex(null);
    setActiveSentenceIndex(splitIndex);
    setError('');
  }, [splitIndex, splitTextPos, sentenceList, boundaries, totalDuration]);

  // ── Save the lesson ────────────────────────────────────────────────
  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setSaveProgress({ current: 0, total: sentenceList.length, status: 'Creating lesson...' });

    try {
      const user = authService.getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      const lessonId = await dbService.createLesson(title, user.uid, sentenceList.length);

      for (let i = 0; i < sentenceList.length; i++) {
        const sentenceText = sentenceList[i].trim();
        if (!sentenceText) continue;

        setSaveProgress({
          current: i + 1,
          total: sentenceList.length,
          status: `Processing sentence ${i + 1}/${sentenceList.length}...`,
        });

        const start = boundaries[i];
        const end = i < sentenceList.length - 1 ? boundaries[i + 1] : totalDuration;
        const clipDuration = end - start;

        // Dynamically choose sample rate so the base64 result fits under
        // Firestore's ~1MB field limit.  Formula:
        //   950KB base64 → 729,600 raw bytes → 364,800 samples (16-bit)
        //   maxRate = 364,800 / duration
        const maxRate = Math.floor(364800 / Math.max(clipDuration, 0.1));
        const sampleRate = Math.min(16000, Math.max(8000, maxRate));

        const wavBlob = await downsampleToWavBlob(audioBuffer, start, end, sampleRate);
        const audioBase64 = await blobToBase64(wavBlob);

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
              Sentences ({sentenceList.length})
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Play clips to audition. Use Split/Merge to adjust sentence grouping. Drag waveform edges to fine-tune boundaries.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {sentenceList.map((sentence, index) => {
              const start = boundaries[index];
              const end = index < sentenceList.length - 1 ? boundaries[index + 1] : totalDuration;
              const duration = end - start;
              const isActive = activeSentenceIndex === index;
              const isSplitting = splitIndex === index;

              return (
                <li
                  key={`${index}-${sentenceList.length}`}
                  className={`px-6 py-4 transition-colors ${
                    isActive
                      ? 'bg-indigo-50 border-l-4 border-indigo-500'
                      : 'hover:bg-gray-50 border-l-4 border-transparent'
                  }`}
                >
                  {/* Split mode inline editor */}
                  {isSplitting ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 rounded-md px-3 py-2">
                        <Scissors className="h-3.5 w-3.5" />
                        Click in the text to choose the split point
                      </div>
                      <div className="relative bg-white border border-gray-200 rounded-lg p-3">
                        <p className="text-sm text-gray-900 leading-relaxed select-none cursor-text">
                          <span className="bg-blue-100 text-blue-800 rounded-sm px-0.5">
                            {sentence.slice(0, splitTextPos)}
                          </span>
                          <span className="inline-block w-0.5 h-4 bg-red-500 mx-0.5 align-middle animate-pulse" />
                          <span className="bg-emerald-100 text-emerald-800 rounded-sm px-0.5">
                            {sentence.slice(splitTextPos)}
                          </span>
                        </p>
                        {/* Clickable overlay to choose split position */}
                        <div className="absolute inset-0 p-3">
                          <p className="text-sm leading-relaxed opacity-0">
                            {sentence.split('').map((char, ci) => (
                              <span
                                key={ci}
                                onClick={() => {
                                  // Find nearest word boundary
                                  let pos = ci;
                                  if (char !== ' ') {
                                    // Look for nearest space
                                    for (let d = 0; d < 20; d++) {
                                      if (ci + d < sentence.length && sentence[ci + d] === ' ') { pos = ci + d; break; }
                                      if (ci - d >= 0 && sentence[ci - d] === ' ') { pos = ci - d; break; }
                                    }
                                  }
                                  setSplitTextPos(Math.max(1, Math.min(sentence.length - 1, pos)));
                                }}
                                className="cursor-text hover:bg-yellow-200 hover:bg-opacity-50"
                              >
                                {char}
                              </span>
                            ))}
                          </p>
                        </div>
                      </div>
                      {/* Split slider for audio position */}
                      <div className="text-xs text-gray-500">
                        Audio split: <span className="font-mono">{formatTime(start + (end - start) * (splitTextPos / sentence.length))}</span>
                        <span className="text-gray-400 ml-1">(proportional to text position)</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleConfirmSplit}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Confirm Split
                        </button>
                        <button
                          onClick={() => setSplitIndex(null)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Normal sentence display */
                    <div
                      className="flex items-start gap-4 cursor-pointer"
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

                      {/* Action buttons */}
                      <div className="flex-shrink-0 flex items-center gap-1">
                        {/* Play */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            playSentence(index);
                          }}
                          disabled={!isReady || isSaving}
                          className="p-2 text-indigo-600 hover:bg-indigo-100 rounded-full transition-colors disabled:opacity-50"
                          title="Play clip"
                        >
                          <Volume2 className="h-4 w-4" />
                        </button>

                        {/* Split */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartSplit(index);
                          }}
                          disabled={isSaving || sentence.split(' ').length < 2}
                          className="p-2 text-amber-600 hover:bg-amber-100 rounded-full transition-colors disabled:opacity-30"
                          title="Split into two sentences"
                        >
                          <Scissors className="h-4 w-4" />
                        </button>

                        {/* Merge with next */}
                        {index < sentenceList.length - 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMerge(index);
                            }}
                            disabled={isSaving}
                            className="p-2 text-emerald-600 hover:bg-emerald-100 rounded-full transition-colors disabled:opacity-30"
                            title="Merge with next sentence"
                          >
                            <Merge className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </div>
  );
}

// ── Helper: Convert a Blob to a base64 string ───────────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1]); // Strip "data:audio/wav;base64," prefix
    };
    reader.onerror = () => reject(new Error('Failed to read audio blob.'));
    reader.readAsDataURL(blob);
  });
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
