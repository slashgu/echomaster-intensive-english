import React, { useState, useRef } from 'react';
import { authService, dbService, llmService } from '../services';
import { ArrowLeft, Loader2, Upload, FileText, Music, Wand2 } from 'lucide-react';
import { AudioClipReviewer } from './AudioClipReviewer';
import {
  decodeAudioFile,
  detectSilences,
  computeBoundaries,
} from '../services/audioClipper';

interface LessonCreatorProps {
  onBack: () => void;
  onCreated: (lessonId: string, title: string) => void;
}

type CreationMode = 'text-only' | 'audio-upload';

/** Maximum upload size in bytes (10 MB) */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Read a File as base64 string (without data URL prefix) */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip "data:audio/mpeg;base64," prefix
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read audio file.'));
    reader.readAsDataURL(file);
  });
}

export function LessonCreator({ onBack, onCreated }: LessonCreatorProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [creationMode, setCreationMode] = useState<CreationMode>('text-only');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [error, setError] = useState('');

  // Audio upload state
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Review step state (audio-upload mode)
  const [reviewData, setReviewData] = useState<{
    sentences: string[];
    audioBuffer: AudioBuffer;
    boundaries: number[];
    usedFallback: boolean;
  } | null>(null);

  // ── Text-only creation (existing flow) ─────────────────────────────
  const handleCreateTextOnly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !text.trim()) {
      setError('Please provide both title and text.');
      return;
    }

    setIsProcessing(true);
    setError('');
    setProgress({ current: 0, total: 0, status: 'Splitting text into sentences...' });

    try {
      const sentences = await llmService.splitIntoSentences(text);
      if (sentences.length === 0) throw new Error("Could not extract any sentences.");

      setProgress({ current: 0, total: sentences.length, status: 'Generating audio...' });

      const user = authService.getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      // Create lesson document first
      const lessonId = await dbService.createLesson(title.trim(), user.uid, sentences.length);

      // Process sentences sequentially to avoid rate limits
      for (let i = 0; i < sentences.length; i++) {
        const sentenceText = sentences[i].trim();
        if (!sentenceText) continue;

        setProgress({ current: i + 1, total: sentences.length, status: `Processing sentence ${i + 1}...` });
        
        const [audioBase64, explanation] = await Promise.all([
          llmService.generateAudioForSentence(sentenceText),
          llmService.explainWordOrPhrase(sentenceText, sentenceText)
        ]);
        
        if (!audioBase64) {
          throw new Error(`Failed to generate audio for sentence: "${sentenceText}"`);
        }

        // Save sentence to subcollection
        await dbService.addSentenceToLesson(lessonId, {
          text: sentenceText,
          audioBase64: audioBase64,
          explanation: explanation,
          orderIndex: i
        });
      }

      onCreated(lessonId, title.trim());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred during creation.');
      setIsProcessing(false);
    }
  };

  // ── Generate transcript from audio ─────────────────────────────────
  const handleGenerateTranscript = async () => {
    if (!audioFile) {
      setError('Please upload an audio file first.');
      return;
    }

    setIsTranscribing(true);
    setError('');

    try {
      // Send the original compressed file (MP3/M4A/etc.) directly —
      // much smaller than converting to uncompressed WAV
      const base64 = await fileToBase64(audioFile);
      const transcript = await llmService.transcribeAudio(base64, audioFile.type || 'audio/mpeg');
      setText(transcript);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to generate transcript.');
    } finally {
      setIsTranscribing(false);
    }
  };

  // ── Audio upload creation ──────────────────────────────────────────
  const handleCreateWithAudio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please provide a lesson title.');
      return;
    }
    if (!audioFile) {
      setError('Please upload an audio file.');
      return;
    }
    if (audioFile.size > MAX_FILE_SIZE) {
      setError(`Audio file is too large (${(audioFile.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
      return;
    }

    setIsProcessing(true);
    setError('');

    try {
      let transcript = text.trim();

      // If no transcript provided, auto-transcribe from audio
      if (!transcript) {
        setProgress({ current: 0, total: 0, status: 'Transcribing audio...' });
        const base64 = await fileToBase64(audioFile);
        transcript = await llmService.transcribeAudio(base64, audioFile.type || 'audio/mpeg');
        setText(transcript);
      }

      setProgress({ current: 0, total: 0, status: 'Splitting transcript into sentences...' });

      // Step 1: Split transcript
      const sentences = await llmService.splitIntoSentences(transcript);
      if (sentences.length === 0) throw new Error("Could not extract any sentences.");

      setProgress({ current: 0, total: 0, status: 'Decoding audio file...' });

      // Step 2: Decode audio
      const audioBuffer = await decodeAudioFile(audioFile);

      setProgress({ current: 0, total: 0, status: 'Detecting sentence boundaries...' });

      // Step 3: Detect silences and compute boundaries
      const silences = detectSilences(audioBuffer);
      const { boundaries, usedFallback } = computeBoundaries(
        silences,
        sentences.length,
        audioBuffer.duration
      );

      // Step 4: Transition to review step
      setReviewData({
        sentences,
        audioBuffer,
        boundaries,
        usedFallback,
      });
      setIsProcessing(false);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred during processing.');
      setIsProcessing(false);
    }
  };

  // ── File handling ──────────────────────────────────────────────────
  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('audio/')) {
      setError('Please upload an audio file (MP3, WAV, M4A, OGG, etc.).');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
      return;
    }
    setError('');
    setAudioFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // ── If in review mode, show the AudioClipReviewer ──────────────────
  if (reviewData) {
    return (
      <AudioClipReviewer
        title={title.trim()}
        sentences={reviewData.sentences}
        audioBuffer={reviewData.audioBuffer}
        initialBoundaries={reviewData.boundaries}
        usedFallback={reviewData.usedFallback}
        onBack={() => {
          setReviewData(null);
          setIsProcessing(false);
        }}
        onCreated={onCreated}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={onBack}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
          disabled={isProcessing}
        >
          <ArrowLeft className="h-5 w-5 mr-2" />
          Back to Dashboard
        </button>

        <div className="bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
              Create New Lesson
            </h3>

            {/* Mode Toggle */}
            <div className="flex rounded-lg border border-gray-200 p-1 mb-6 bg-gray-50">
              <button
                type="button"
                onClick={() => { setCreationMode('text-only'); setError(''); }}
                disabled={isProcessing}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${
                  creationMode === 'text-only'
                    ? 'bg-white shadow-sm text-indigo-700 border border-indigo-200'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <FileText className="h-4 w-4" />
                Text Only (AI Audio)
              </button>
              <button
                type="button"
                onClick={() => { setCreationMode('audio-upload'); setError(''); }}
                disabled={isProcessing}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all ${
                  creationMode === 'audio-upload'
                    ? 'bg-white shadow-sm text-indigo-700 border border-indigo-200'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <Music className="h-4 w-4" />
                Upload Audio + Transcript
              </button>
            </div>
            
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
                {error}
              </div>
            )}

            <form
              onSubmit={creationMode === 'text-only' ? handleCreateTextOnly : handleCreateWithAudio}
              className="space-y-6"
            >
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                  Lesson Title
                </label>
                <input
                  type="text"
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isProcessing}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  placeholder="e.g., Daily Conversation #1"
                />
              </div>

              {/* Audio Upload (audio-upload mode only) */}
              {creationMode === 'audio-upload' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Audio File
                  </label>
                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                      isDragging
                        ? 'border-indigo-500 bg-indigo-50'
                        : audioFile
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      disabled={isProcessing}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                    />
                    {audioFile ? (
                      <div className="flex flex-col items-center gap-2">
                        <Music className="h-10 w-10 text-green-500" />
                        <p className="text-sm font-medium text-green-700">{audioFile.name}</p>
                        <p className="text-xs text-green-600">
                          {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                        <p className="text-xs text-gray-400 mt-1">Click or drag to replace</p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-10 w-10 text-gray-400" />
                        <p className="text-sm text-gray-600">
                          <span className="font-medium text-indigo-600">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-gray-400">MP3, WAV, M4A, OGG — max 10 MB</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="text" className="block text-sm font-medium text-gray-700">
                    {creationMode === 'text-only' ? 'Lesson Text' : 'Transcript'}
                    {creationMode === 'audio-upload' && (
                      <span className="text-gray-400 font-normal ml-1">(optional — can be auto-generated)</span>
                    )}
                  </label>
                  {creationMode === 'audio-upload' && audioFile && (
                    <button
                      type="button"
                      onClick={handleGenerateTranscript}
                      disabled={isProcessing || isTranscribing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition-colors disabled:opacity-50"
                    >
                      {isTranscribing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Transcribing...
                        </>
                      ) : (
                        <>
                          <Wand2 className="h-3.5 w-3.5" />
                          Generate Transcript
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="mt-1">
                  <textarea
                    id="text"
                    rows={8}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={isProcessing || isTranscribing}
                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border border-gray-300 rounded-md py-2 px-3"
                    placeholder={
                      creationMode === 'text-only'
                        ? 'Paste the English text here. The AI will split it into sentences and generate audio for each.'
                        : 'Paste the transcript here, or click "Generate Transcript" above to auto-transcribe from the audio.'
                    }
                  />
                </div>
              </div>

              {isProcessing && (
                <div className="rounded-md bg-blue-50 p-4">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />
                    </div>
                    <div className="ml-3 flex-1 md:flex md:justify-between">
                      <p className="text-sm text-blue-700">{progress.status}</p>
                      {progress.total > 0 && (
                        <p className="mt-3 text-sm md:mt-0 md:ml-6 text-blue-700">
                          {progress.current} / {progress.total}
                        </p>
                      )}
                    </div>
                  </div>
                  {progress.total > 0 && (
                    <div className="mt-4 w-full bg-blue-200 rounded-full h-2.5">
                      <div 
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {isProcessing
                    ? 'Processing...'
                    : creationMode === 'text-only'
                    ? 'Create Lesson'
                    : 'Process & Review Clips'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
