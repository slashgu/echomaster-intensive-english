import React, { useState, useEffect, useRef, useMemo } from 'react';
import { dbService, llmService, authService } from '../services';
import { Sentence, ProgressAnswer } from '../services/types';
import { ArrowLeft, Play, Pause, Repeat, FastForward, Rewind, HelpCircle, Mic, CheckCircle2, XCircle, Save, Edit3, Award, Clock, X } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown from 'react-markdown';

interface StudyRoomProps {
  lessonId: string;
  onBack: () => void;
}

type Mode = 'dictation' | 'gap-fill';

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isSentenceCorrect(sentence: Sentence, answer: ProgressAnswer | undefined, mode: Mode): boolean {
  if (!answer) return false;
  if (mode === 'dictation') {
    if (typeof answer.userAnswer !== 'string') return false;
    return normalizeForCompare(answer.userAnswer) === normalizeForCompare(sentence.text);
  } else {
    if (typeof answer.userAnswer === 'string') return false;
    const pieces = sentence.text.split(/(\b\w+\b)/);
    const gaps = sentence.gapIndexes || [];
    if (gaps.length === 0) return false;
    return gaps.every(gapIdx => {
      const expected = (pieces[gapIdx] || '').toLowerCase();
      const got = (answer.userAnswer as Record<number, string>)[gapIdx];
      return got !== undefined && got.trim().toLowerCase() === expected;
    });
  }
}

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

  // Gap-fill state
  const [sentencePieces, setSentencePieces] = useState<string[]>([]);
  const [gaps, setGaps] = useState<number[]>([]);
  const [gapValues, setGapValues] = useState<Record<number, string>>({});

  // Per-mode session answers — keyed by `${mode}:${sentenceId}`
  const [sessionAnswers, setSessionAnswers] = useState<Record<string, ProgressAnswer>>({});

  // Completion review modal
  const [showReview, setShowReview] = useState(false);
  const [saving, setSaving] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sentencesRef = useRef<Sentence[]>([]);

  const answerKey = (m: Mode, sentenceId: string) => `${m}:${sentenceId}`;

  useEffect(() => {
    const unsubscribe = dbService.subscribeToSentences(lessonId, (data) => {
      setSentences(data);
      sentencesRef.current = data;
      setLoading(false);
      unsubscribe();
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

  // When sentence/mode changes, hydrate inputs from saved answers (auto-save restore)
  useEffect(() => {
    const currentSentences = sentencesRef.current;
    const sentence = currentSentences[currentIndex];
    if (!sentence) return;

    // Always recompute pieces & gaps for the current sentence (needed for gap-fill)
    const pieces = sentence.text.split(/(\b\w+\b)/);
    setSentencePieces(pieces);
    const selectedGaps = sentence.gapIndexes || [];
    setGaps(selectedGaps);

    // Restore previously typed answer for THIS sentence + mode (or reset to empty)
    const saved = sessionAnswers[answerKey(mode, sentence.id)];

    if (mode === 'dictation') {
      setDictationInput(saved && typeof saved.userAnswer === 'string' ? saved.userAnswer : '');
      setGapValues({});
    } else {
      setDictationInput('');
      setGapValues(saved && typeof saved.userAnswer === 'object' ? { ...(saved.userAnswer as Record<number, string>) } : {});
    }

    setIsExplaining(false);
    // Note: intentionally NOT including sessionAnswers — we only want to hydrate on sentence/mode change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, mode, sentences]);

  useEffect(() => {
    if (showExplanation && sentences[currentIndex]) {
      const sentence = sentences[currentIndex];
      if (sentence.explanation) {
        setExplanation(sentence.explanation);
      } else {
        setIsExplaining(true);
        llmService.explainWordOrPhrase(sentence.text, sentence.text)
          .then(result => {
            setExplanation(result);
            setIsExplaining(false);
          })
          .catch(err => {
            console.error(err);
            setExplanation("Explanation failed to load.");
            setIsExplaining(false);
          });
      }
    }
  }, [currentIndex, showExplanation, sentences]);

  const currentSentence = sentences[currentIndex];

  // Auto-save: persist current input to sessionAnswers whenever it changes
  useEffect(() => {
    if (!currentSentence) return;
    const key = answerKey(mode, currentSentence.id);
    setSessionAnswers(prev => ({
      ...prev,
      [key]: {
        sentenceId: currentSentence.id,
        originalText: currentSentence.text,
        userAnswer: mode === 'dictation' ? dictationInput : { ...gapValues },
      },
    }));
  }, [dictationInput, gapValues, currentSentence, mode]);

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
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

  // Compute per-sentence correctness for current mode
  const sentenceResults = useMemo(() => {
    return sentences.map(s => {
      const ans = sessionAnswers[answerKey(mode, s.id)];
      return {
        sentence: s,
        answer: ans,
        correct: isSentenceCorrect(s, ans, mode),
        attempted: !!ans && (
          mode === 'dictation'
            ? typeof ans.userAnswer === 'string' && ans.userAnswer.trim().length > 0
            : typeof ans.userAnswer === 'object' && Object.values(ans.userAnswer as Record<number, string>).some(v => v.trim().length > 0)
        ),
      };
    });
  }, [sentences, sessionAnswers, mode]);

  const correctCount = sentenceResults.filter(r => r.correct).length;
  const attemptedCount = sentenceResults.filter(r => r.attempted).length;
  const score = sentences.length > 0 ? Math.round((correctCount / sentences.length) * 100) : 0;

  const handleOpenReview = () => {
    setShowReview(true);
  };

  const handleSubmitProgress = async () => {
    const user = authService.getCurrentUser();
    if (!user) return;

    setSaving(true);
    try {
      const answers: ProgressAnswer[] = sentences.map(s => {
        const ans = sessionAnswers[answerKey(mode, s.id)];
        return ans || {
          sentenceId: s.id,
          originalText: s.text,
          userAnswer: mode === 'dictation' ? '' : {},
        };
      });

      await dbService.saveProgress({
        userId: user.uid,
        lessonId,
        mode,
        score,
        completedAt: new Date(),
        answers,
      });
      setShowReview(false);
      onBack();
    } catch (error) {
      console.error('Error saving progress:', error);
      alert('Failed to save progress.');
    } finally {
      setSaving(false);
    }
  };

  const handleExplain = () => setShowExplanation(prev => !prev);

  const checkDictation = () => {
    if (!currentSentence) return false;
    return normalizeForCompare(currentSentence.text) === normalizeForCompare(dictationInput);
  };

  const isCorrect = checkDictation();

  const allGapsCorrect = gaps.length > 0 && gaps.every(gapIndex => {
    const original = sentencePieces[gapIndex]?.toLowerCase() || '';
    const current = (gapValues[gapIndex] || '').trim().toLowerCase();
    return original === current;
  });

  const getAudioSrc = (base64: string) => {
    if (!base64) return '';
    if (base64.startsWith('UklGR')) return `data:audio/wav;base64,${base64}`;
    try {
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      const buffer = new ArrayBuffer(44 + bytes.length);
      const view = new DataView(buffer);
      const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
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
      for (let i = 0; i < finalBytes.length; i++) binary += String.fromCharCode(finalBytes[i]);
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
            {(['dictation', 'gap-fill'] as Mode[]).map(m => (
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
            onClick={handleOpenReview}
            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
          >
            <Save className="h-4 w-4 mr-1.5" />
            Complete
          </button>
        </div>

        {/* Progress strip */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
          <div className="flex gap-1.5 items-center">
            {sentenceResults.map((r, i) => (
              <button
                key={r.sentence.id}
                onClick={() => setCurrentIndex(i)}
                className={clsx(
                  "flex-1 h-1.5 rounded-full transition-all relative group",
                  i === currentIndex && "ring-2 ring-indigo-400 ring-offset-1",
                  r.correct ? "bg-green-500" : r.attempted ? "bg-amber-400" : "bg-gray-200"
                )}
                title={`Sentence ${i + 1}: ${r.correct ? 'Correct' : r.attempted ? 'Attempted' : 'Not started'}`}
              />
            ))}
            <span className="ml-2 text-xs text-gray-500 font-mono whitespace-nowrap">
              {correctCount}/{sentences.length}
            </span>
          </div>
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
                onClick={() => setCurrentIndex(Math.min(sentences.length - 1, currentIndex + 1))}
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
                    <div className="text-sm text-gray-700 leading-relaxed space-y-2">
                      <ReactMarkdown
                        components={{
                          strong: ({node, ...props}) => <strong className="font-bold text-gray-900" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc pl-5 mt-2 space-y-1" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal pl-5 mt-2 space-y-1" {...props} />,
                          p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />
                        }}
                      >
                        {explanation}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'gap-fill' && (
            <div className="flex-1 flex flex-col gap-6">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-medium text-gray-900">Fill in the blanks</h3>
                <button onClick={handleExplain} className="text-sm text-indigo-600 flex items-center gap-1 hover:underline">
                  <HelpCircle className="h-4 w-4" /> AI Help
                </button>
              </div>

              {gaps.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
                  <Edit3 className="mx-auto h-10 w-10 text-gray-300 mb-3" />
                  <p className="text-gray-500 font-medium">No gaps configured for this sentence yet.</p>
                  <p className="text-sm text-gray-400 mt-1">Your teacher needs to configure the gap words for this lesson.</p>
                </div>
              ) : (
                <div className="text-xl sm:text-2xl leading-[2.5] font-medium text-gray-800 p-6 bg-gray-50 rounded-xl border border-gray-200">
                  {sentencePieces.map((piece, index) => {
                    const isWord = /^\w+$/.test(piece);
                    if (!isWord) return <span key={index}>{piece}</span>;

                    if (gaps.includes(index)) {
                      const val = gapValues[index] || '';
                      const isGapCorrect = val.trim().toLowerCase() === piece.toLowerCase();
                      return (
                        <input
                          key={index}
                          type="text"
                          value={val}
                          onChange={(e) => setGapValues({ ...gapValues, [index]: e.target.value })}
                          className={clsx(
                            "m-0 inline-block align-middle px-3 py-1 text-center border-2 rounded-full focus:outline-none focus:border-indigo-500 transition-all shadow-sm leading-normal",
                            isGapCorrect
                              ? "bg-green-100 border-green-400 text-green-700 font-medium"
                              : "bg-white border-indigo-200 text-indigo-700"
                          )}
                          style={{ width: `calc(${Math.max(2, val.length)}ch + 32px)` }}
                        />
                      );
                    }
                    return (
                      <span key={index} className="m-0 inline-block align-middle px-3 py-1 bg-white border-2 border-gray-200 text-gray-700 rounded-full shadow-sm leading-normal">
                        {piece}
                      </span>
                    );
                  })}
                </div>
              )}

              {allGapsCorrect && gaps.length > 0 && (
                <div className="flex items-center text-green-600 gap-2 font-medium justify-center mt-4 bg-green-50 p-4 rounded-lg border border-green-200">
                  <CheckCircle2 className="h-6 w-6" /> Perfect! You filled all the blanks.
                </div>
              )}

              {showExplanation && (
                <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100 mt-auto">
                  <h4 className="font-medium text-indigo-900 mb-2">Original Text & Explanation</h4>
                  <p className="text-gray-800 font-medium mb-2">{currentSentence?.text}</p>
                  {isExplaining ? (
                    <div className="animate-pulse text-indigo-600 text-sm">Generating explanation...</div>
                  ) : (
                    <div className="text-sm text-gray-700 leading-relaxed space-y-2">
                      <ReactMarkdown
                        components={{
                          strong: ({node, ...props}) => <strong className="font-bold text-gray-900" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-disc pl-5 mt-2 space-y-1" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal pl-5 mt-2 space-y-1" {...props} />,
                          p: ({node, ...props}) => <p className="mb-2 last:mb-0" {...props} />
                        }}
                      >
                        {explanation}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Completion Review Modal */}
      {showReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !saving && setShowReview(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={clsx(
                  "h-12 w-12 rounded-2xl flex items-center justify-center",
                  score >= 80 ? "bg-green-100 text-green-600" : score >= 50 ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-500"
                )}>
                  <Award className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Practice Summary</h3>
                  <p className="text-xs text-slate-500 capitalize">Mode: {mode.replace('-', ' ')}</p>
                </div>
              </div>
              <button
                onClick={() => !saving && setShowReview(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                disabled={saving}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Stats */}
            <div className="px-6 py-5 grid grid-cols-3 gap-3 bg-slate-50 border-b border-slate-100">
              <div className="text-center">
                <div className="text-2xl font-extrabold text-slate-800">{score}%</div>
                <div className="text-xs text-slate-500 uppercase tracking-wide font-medium">Score</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-extrabold text-green-600">{correctCount}</div>
                <div className="text-xs text-slate-500 uppercase tracking-wide font-medium">Correct</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-extrabold text-slate-400">{sentences.length - attemptedCount}</div>
                <div className="text-xs text-slate-500 uppercase tracking-wide font-medium">Skipped</div>
              </div>
            </div>

            {/* Per-sentence list */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <ul className="space-y-2">
                {sentenceResults.map((r, i) => (
                  <li
                    key={r.sentence.id}
                    className={clsx(
                      "rounded-xl border p-3 flex items-start gap-3 transition-colors",
                      r.correct ? "bg-green-50 border-green-200" : r.attempted ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"
                    )}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {r.correct
                        ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                        : r.attempted
                          ? <XCircle className="h-5 w-5 text-amber-500" />
                          : <Clock className="h-5 w-5 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-slate-400">#{i + 1}</span>
                        <span className={clsx(
                          "text-xs font-semibold px-1.5 py-0.5 rounded",
                          r.correct ? "bg-green-100 text-green-700" : r.attempted ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-500"
                        )}>
                          {r.correct ? 'Correct' : r.attempted ? 'Incorrect' : 'Not attempted'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 leading-snug">{r.sentence.text}</p>
                      {r.attempted && !r.correct && r.answer && (
                        <p className="text-xs text-slate-500 mt-1.5">
                          <span className="font-medium">Your answer: </span>
                          {typeof r.answer.userAnswer === 'string'
                            ? <span className="italic">"{r.answer.userAnswer}"</span>
                            : Object.entries(r.answer.userAnswer).map(([k, v]) => (
                                <span key={k} className="inline-block mr-2 bg-white px-1.5 py-0.5 rounded text-slate-700 border border-slate-200">
                                  gap {k}: {v || <span className="italic text-slate-400">empty</span>}
                                </span>
                              ))
                          }
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {/* Footer actions */}
            <div className="px-6 py-4 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => setShowReview(false)}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Keep practicing
              </button>
              <button
                onClick={handleSubmitProgress}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Submit & Finish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
