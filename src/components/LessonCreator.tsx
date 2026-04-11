import React, { useState } from 'react';
import { authService, dbService, llmService } from '../services';
import { ArrowLeft, Loader2 } from 'lucide-react';

interface LessonCreatorProps {
  onBack: () => void;
  onCreated: (lessonId: string, title: string) => void;
}

export function LessonCreator({ onBack, onCreated }: LessonCreatorProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
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
            
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
                {error}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-6">
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

              <div>
                <label htmlFor="text" className="block text-sm font-medium text-gray-700">
                  Lesson Text
                </label>
                <div className="mt-1">
                  <textarea
                    id="text"
                    rows={8}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={isProcessing}
                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border border-gray-300 rounded-md py-2 px-3"
                    placeholder="Paste the English text here. The AI will split it into sentences and generate audio for each."
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
                  {isProcessing ? 'Processing...' : 'Create Lesson'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
