import React, { useState, useEffect } from 'react';
import { dbService } from '../services';
import { Lesson, Sentence } from '../services/types';
import { ArrowLeft, Save, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';

interface LessonGapEditorProps {
  lesson: Lesson;
  onBack: () => void;
}

export function LessonGapEditor({ lesson, onBack }: LessonGapEditorProps) {
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localGaps, setLocalGaps] = useState<Record<string, number[]>>({});

  useEffect(() => {
    const unsubscribe = dbService.subscribeToSentences(lesson.id, (data) => {
      setSentences(data);
      // Initialize local gaps state
      const initialGaps: Record<string, number[]> = {};
      data.forEach(s => {
        initialGaps[s.id] = s.gapIndexes || [];
      });
      setLocalGaps(initialGaps);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [lesson.id]);

  const toggleGap = (sentenceId: string, wordIndex: number) => {
    setLocalGaps(prev => {
      const current = prev[sentenceId] || [];
      if (current.includes(wordIndex)) {
        return { ...prev, [sentenceId]: current.filter(i => i !== wordIndex) };
      } else {
        return { ...prev, [sentenceId]: [...current, wordIndex].sort((a,b) => a-b) };
      }
    });
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      for (const sentence of sentences) {
        const configuredGaps = localGaps[sentence.id] || [];
        // Only update if changed visually
        await dbService.updateSentenceGaps(lesson.id, sentence.id, configuredGaps);
      }
      alert('Gap configurations saved successfully!');
      onBack();
    } catch (error) {
      console.error('Failed to save gaps:', error);
      alert('Failed to save gap configurations.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading sentences...</div>;
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-4xl mx-auto py-6 px-4">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="text-gray-500 hover:text-gray-700">
              <ArrowLeft className="h-6 w-6" />
            </button>
            <h2 className="text-2xl font-bold text-gray-900">Configure Gaps: {lesson.title}</h2>
          </div>
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : <><Save className="h-4 w-4 mr-2" /> Save Configuration</>}
          </button>
        </div>

        <div className="space-y-8">
          <p className="text-gray-600 mb-4">Click on the words you want to hide across all student sessions for this lesson.</p>
          
          {sentences.map((sentence, sIdx) => {
            const pieces = sentence.text.split(/(\b\w+\b)/);
            const sentenceGaps = localGaps[sentence.id] || [];

            return (
              <div key={sentence.id} className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                <div className="text-sm font-mono text-gray-400 mb-3">Sentence {sIdx + 1}</div>
                <div className="text-xl sm:text-2xl leading-[2.5] font-medium text-gray-800">
                  {pieces.map((piece, index) => {
                    const isWord = /^\w+$/.test(piece);
                    if (!isWord) {
                      return <span key={index}>{piece}</span>;
                    }

                    const isGap = sentenceGaps.includes(index);

                    return (
                      <button
                        key={index}
                        onClick={() => toggleGap(sentence.id, index)}
                        className={clsx(
                          "inline-block px-3 py-1 border-2 rounded-full shadow-sm leading-normal transition-all m-0 align-middle",
                          isGap 
                            ? "bg-indigo-100 border-indigo-400 text-indigo-700" 
                            : "bg-white border-gray-200 text-gray-700 hover:border-indigo-300"
                        )}
                      >
                        {piece}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
