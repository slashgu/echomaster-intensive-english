import React, { useState, useEffect, useRef } from 'react';
import { dbService, llmService, authService } from '../services';
import { Sentence } from '../services/types';
import { ArrowLeft, Play, Pause, Repeat, FastForward, Rewind, HelpCircle, Mic, CheckCircle2, Save } from 'lucide-react';
import clsx from 'clsx';

interface StudyRoomProps {
  lessonId: string;
  onBack: () => void;
}

type Mode = 'dictation' | 'gap-fill' | 'shadowing';

export function StudyRoom({ lessonId, onBack }: StudyRoomProps) {
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('dictation');
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [autoPause, setAutoPause] = useState(true);
  
  // Mode specific state
  const [dictationInput, setDictationInput] = useState('');
  const [showExplanation, setShowExplanation] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [isExplaining, setIsExplaining] = useState(false);
  
  // Shadowing specific state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clear recorded audio when changing sentences
  useEffect(() => {
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
  }, [currentIndex]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(audioUrl);
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordedAudioUrl(null);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please check your browser permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  useEffect(() => {
    const unsubscribe = dbService.subscribeToSentences(lessonId, (data) => {
      setSentences(data);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [lessonId]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, currentIndex]);

  const currentSentence = sentences[currentIndex];

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    if (loop && audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    } else if (!autoPause && currentIndex < sentences.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.play();
          setIsPlaying(true);
        }
      }, 500);
    }
  };

  const handleCompletePractice = async () => {
    const user = authService.getCurrentUser();
    if (!user) return;
    
    try {
      await dbService.saveProgress({
        userId: user.uid,
        lessonId,
        mode,
        score: 100, // Simplified for MVP
        completedAt: new Date()
      });
      alert('Progress saved successfully!');
      onBack();
    } catch (error) {
      console.error('Error saving progress:', error);
      alert('Failed to save progress.');
    }
  };

  const handleExplain = async () => {
    if (!currentSentence) return;
    setShowExplanation(true);
    if (currentSentence.explanation) {
      setExplanation(currentSentence.explanation);
    } else {
      setIsExplaining(true);
      const result = await llmService.explainWordOrPhrase(currentSentence.text, currentSentence.text);
      setExplanation(result);
      setIsExplaining(false);
    }
  };

  const checkDictation = () => {
    if (!currentSentence) return;
    const cleanOriginal = currentSentence.text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const cleanInput = dictationInput.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    return cleanOriginal === cleanInput;
  };

  const isCorrect = checkDictation();

  const getAudioSrc = (base64: string) => {
    if (!base64) return '';
    // If it already has a WAV header (RIFF -> UklGR in base64), use it directly
    if (base64.startsWith('UklGR')) {
      return `data:audio/wav;base64,${base64}`;
    }
    // Otherwise, it's an old lesson with raw PCM. Convert it on the fly.
    try {
      const binaryString = atob(base64);
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
      return `data:audio/wav;base64,${btoa(binary)}`;
    } catch (e) {
      return `data:audio/wav;base64,${base64}`;
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>;
  }

  if (sentences.length === 0) {
    return <div className="p-8 text-center">No sentences found for this lesson. <button onClick={onBack} className="text-indigo-600 underline">Go back</button></div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back
          </button>
          <div className="flex space-x-2">
            {(['dictation', 'gap-fill', 'shadowing'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={clsx(
                  "px-3 py-1 rounded-md text-sm font-medium capitalize",
                  mode === m ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100"
                )}
              >
                {m.replace('-', ' ')}
              </button>
            ))}
          </div>
          <button
            onClick={handleCompletePractice}
            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <Save className="h-4 w-4 mr-1.5" />
            Complete
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-6">
        
        {/* Audio Player Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex flex-col items-center gap-6">
            
            {currentSentence && (
              <audio
                ref={audioRef}
                src={getAudioSrc(currentSentence.audioBase64)}
                onEnded={handleAudioEnded}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            )}

            <div className="flex items-center justify-center gap-6 w-full">
              <button 
                onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                disabled={currentIndex === 0}
                className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-50"
              >
                <Rewind className="h-6 w-6" />
              </button>
              
              <button 
                onClick={handlePlayPause}
                className="p-4 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 shadow-md transition-transform active:scale-95"
              >
                {isPlaying ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8 ml-1" />}
              </button>

              <button 
                onClick={() => {
                  setCurrentIndex(Math.min(sentences.length - 1, currentIndex + 1));
                  setDictationInput('');
                  setShowExplanation(false);
                }}
                disabled={currentIndex === sentences.length - 1}
                className="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-50"
              >
                <FastForward className="h-6 w-6" />
              </button>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-600 bg-gray-50 px-4 py-2 rounded-lg">
              <button 
                onClick={() => setPlaybackRate(r => r === 1 ? 0.75 : r === 0.75 ? 0.5 : 1)}
                className="font-mono font-medium hover:text-indigo-600 w-12 text-center"
              >
                {playbackRate}x
              </button>
              <div className="w-px h-4 bg-gray-300"></div>
              <button 
                onClick={() => setLoop(!loop)}
                className={clsx("flex items-center gap-1 hover:text-indigo-600", loop && "text-indigo-600")}
              >
                <Repeat className="h-4 w-4" /> Loop
              </button>
              <div className="w-px h-4 bg-gray-300"></div>
              <label className="flex items-center gap-2 cursor-pointer hover:text-indigo-600">
                <input 
                  type="checkbox" 
                  checked={autoPause} 
                  onChange={(e) => setAutoPause(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                Auto-pause
              </label>
            </div>
            
            <div className="text-sm text-gray-400 font-medium">
              Sentence {currentIndex + 1} of {sentences.length}
            </div>
          </div>
        </div>

        {/* Learning Area */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex-1 flex flex-col">
          
          {mode === 'dictation' && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">Type what you hear</h3>
                <button onClick={handleExplain} className="text-sm text-indigo-600 flex items-center gap-1 hover:underline">
                  <HelpCircle className="h-4 w-4" /> AI Help
                </button>
              </div>
              <textarea
                value={dictationInput}
                onChange={(e) => setDictationInput(e.target.value)}
                className={clsx(
                  "flex-1 w-full p-4 border rounded-lg resize-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-lg",
                  isCorrect && dictationInput.length > 0 ? "border-green-500 bg-green-50" : "border-gray-300"
                )}
                placeholder="Listen and type..."
              />
              {isCorrect && dictationInput.length > 0 && (
                <div className="flex items-center text-green-600 gap-2 font-medium">
                  <CheckCircle2 className="h-5 w-5" /> Perfect!
                </div>
              )}
              {showExplanation && (
                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100 mt-4">
                  <h4 className="font-medium text-indigo-900 mb-2">Original Text & Explanation</h4>
                  <p className="text-gray-800 font-medium mb-2">{currentSentence?.text}</p>
                  {isExplaining ? (
                    <div className="animate-pulse text-indigo-600 text-sm">Generating explanation...</div>
                  ) : (
                    <p className="text-sm text-gray-600">{explanation}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'gap-fill' && (
            <div className="flex-1 flex flex-col gap-4 items-center justify-center text-center">
               <h3 className="text-lg font-medium text-gray-900 mb-4">Gap-fill mode (Coming soon)</h3>
               <p className="text-gray-500">In a full version, random words would be blanked out.</p>
               <p className="text-xl font-medium text-gray-800 mt-4">{currentSentence?.text}</p>
            </div>
          )}

          {mode === 'shadowing' && (
            <div className="flex-1 flex flex-col gap-8 items-center justify-center">
              <div className="text-center space-y-4">
                <h3 className="text-lg font-medium text-gray-900">Listen and Repeat</h3>
                <p className="text-2xl font-medium text-gray-800 max-w-2xl leading-relaxed">
                  {currentSentence?.text}
                </p>
              </div>
              
              <div className="flex flex-col items-center gap-4">
                <button 
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onMouseLeave={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  className={clsx(
                    "p-6 rounded-full transition-all duration-200 shadow-md",
                    isRecording 
                      ? "bg-red-600 text-white scale-110 animate-pulse shadow-red-200" 
                      : "bg-red-100 text-red-600 hover:bg-red-200"
                  )}
                >
                  <Mic className="h-8 w-8" />
                </button>
                <p className="text-sm text-gray-500 font-medium">
                  {isRecording ? "Recording... Release to stop" : "Hold to record your voice"}
                </p>
              </div>

              {recordedAudioUrl && (
                <div className="mt-4 w-full max-w-md bg-gray-50 p-4 rounded-lg border border-gray-200 flex flex-col gap-2">
                  <span className="text-sm font-medium text-gray-700">Your Recording:</span>
                  <audio src={recordedAudioUrl} controls className="w-full h-10" />
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
