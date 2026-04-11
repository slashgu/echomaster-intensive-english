import React, { useState, useEffect, useCallback } from 'react';
import { authService, dbService } from '../services';
import { Lesson, User, Progress, Sentence } from '../services/types';

import { Plus, BookOpen, Users, LogOut, Activity, ChevronRight, ArrowLeft, Trash2, Edit3, AlertTriangle, X } from 'lucide-react';
import { LessonCreator } from './LessonCreator';
import { LessonGapEditor } from './LessonGapEditor';
import clsx from 'clsx';

interface TeacherDashboardProps {
  user: User;
  onSelectLesson: (lessonId: string) => void;
}

export function TeacherDashboard({ user, onSelectLesson }: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<'lessons' | 'students'>('lessons');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [showCreator, setShowCreator] = useState(false);
  const [editingGapsLesson, setEditingGapsLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
  const [studentProgress, setStudentProgress] = useState<Progress[]>([]);
  const [expandedProgressId, setExpandedProgressId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [lessonsWithGaps, setLessonsWithGaps] = useState<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribeLessons = dbService.subscribeToLessons(user.uid, (lessonsData) => {
      setLessons(lessonsData);
      setLoading(false);

      // Check each lesson for gap configuration status
      lessonsData.forEach((lesson) => {
        const unsub = dbService.subscribeToSentences(lesson.id, (sentences) => {
          const hasGaps = sentences.length > 0 && sentences.some(s => s.gapIndexes && s.gapIndexes.length > 0);
          setLessonsWithGaps(prev => {
            const next = new Set(prev);
            if (hasGaps) next.add(lesson.id); else next.delete(lesson.id);
            return next;
          });
          unsub(); // one-shot check
        }, () => { /* ignore errors */ });
      });
    }, (error) => {
      console.error(error);
      setLoading(false);
    });

    const unsubscribeStudents = dbService.subscribeToStudents(user.uid, (studentsData) => {
      setStudents(studentsData);
    }, (error) => {
      console.error(error);
    });

    return () => {
      unsubscribeLessons();
      unsubscribeStudents();
    };
  }, [user.uid]);

  useEffect(() => {
    if (!selectedStudent) return;
    const unsubscribe = dbService.subscribeToProgress(selectedStudent.uid, (progressData) => {
      setStudentProgress(progressData);
    }, (error) => {
      console.error(error);
    });
    return () => unsubscribe();
  }, [selectedStudent]);



  const refreshGapStatus = useCallback((lessonId: string) => {
    const unsub = dbService.subscribeToSentences(lessonId, (sentences) => {
      const hasGaps = sentences.length > 0 && sentences.some(s => s.gapIndexes && s.gapIndexes.length > 0);
      setLessonsWithGaps(prev => {
        const next = new Set(prev);
        if (hasGaps) next.add(lessonId); else next.delete(lessonId);
        return next;
      });
      unsub();
    }, () => { /* ignore */ });
  }, []);

  const allLessonsConfigured = lessons.length > 0 && lessons.every(l => lessonsWithGaps.has(l.id));
  const showBanner = !bannerDismissed && !allLessonsConfigured && lessons.length > 0;

  const handleLogout = async () => {
    await authService.logout();
  };

  if (showCreator) {
    return <LessonCreator onBack={() => setShowCreator(false)} onCreated={(id, title) => {
      setShowCreator(false);

      // Open gap editor immediately with a constructed Lesson object
      setEditingGapsLesson({
        id,
        title,
        authorId: user.uid,
        createdAt: new Date(),
        sentenceCount: 0, // not needed by gap editor
      });
    }} />;
  }

  if (editingGapsLesson) {
    return <LessonGapEditor lesson={editingGapsLesson} onBack={() => {
      refreshGapStatus(editingGapsLesson.id);
      setEditingGapsLesson(null);
    }} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="h-8 w-8 text-indigo-600" />
              Teacher Dashboard
            </h1>
            {user.inviteCode && (
              <p className="mt-2 text-sm text-gray-600">
                Class Invite Code: <span className="font-mono font-bold bg-gray-100 px-2 py-1 rounded text-indigo-600">{user.inviteCode}</span>
              </p>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex space-x-4 border-b border-gray-200">
          <button
            onClick={() => { setActiveTab('lessons'); setSelectedStudent(null); }}
            className={`py-2 px-4 border-b-2 font-medium text-sm ${
              activeTab === 'lessons'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Manage Lessons
            </div>
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`py-2 px-4 border-b-2 font-medium text-sm ${
              activeTab === 'students'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Students Progress
            </div>
          </button>
        </div>

        {activeTab === 'lessons' && (
          <div className="px-4 py-6 sm:px-0">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">Available Lessons</h2>
              <button
                onClick={() => setShowCreator(true)}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                <Plus className="h-5 w-5 mr-2" />
                New Lesson
              </button>
            </div>

            {showBanner && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">Don't forget to configure gaps!</p>
                  <p className="text-xs text-amber-600 mt-0.5">Click the <Edit3 className="inline h-3.5 w-3.5" /> edit icon on a lesson to set up gap-fill words for your students.</p>
                </div>
                <button
                  onClick={() => setBannerDismissed(true)}
                  className="text-amber-400 hover:text-amber-600 flex-shrink-0 p-0.5 rounded hover:bg-amber-100 transition-colors"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {loading ? (
              <div className="text-center py-12 text-gray-500">Loading lessons...</div>
            ) : lessons.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
                <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">No lessons</h3>
                <p className="mt-1 text-sm text-gray-500">Get started by creating a new lesson.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {lessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 hover:border-indigo-500 transition-colors cursor-pointer relative group"
                    onClick={() => onSelectLesson(lesson.id)}
                  >
                    <div className="px-4 py-5 sm:p-6">
                      <div className="flex justify-between items-start">
                        <h3 className="text-lg font-medium text-gray-900 truncate pr-8">{lesson.title}</h3>
                        <div className="flex items-center gap-2 absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingGapsLesson(lesson);
                            }}
                            className="text-gray-400 hover:text-indigo-500 p-1"
                            title="Edit Gaps"
                          >
                            <Edit3 className="h-5 w-5" />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (window.confirm('Are you sure you want to delete this lesson?')) {
                                try {
                                  await dbService.deleteLesson(lesson.id);
                                } catch (err) {
                                  console.error('Failed to delete lesson:', err);
                                  alert('Failed to delete lesson.');
                                }
                              }
                            }}
                            className="text-gray-400 hover:text-red-500 p-1"
                            title="Delete Lesson"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center text-sm text-gray-500">
                        <Activity className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                        {lesson.sentenceCount} sentences
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGapsLesson(lesson);
                        }}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Configure Gaps
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'students' && !selectedStudent && (
          <div className="px-4 py-6 sm:px-0">
            <h2 className="text-xl font-semibold text-gray-800 mb-6">Student Roster</h2>
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <ul className="divide-y divide-gray-200">
                {students.length === 0 ? (
                  <li className="px-6 py-4 text-center text-gray-500">No students registered yet.</li>
                ) : (
                  students.map((student) => (
                    <li key={student.uid}>
                      <div 
                        className="px-4 py-4 sm:px-6 hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => setSelectedStudent(student)}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-indigo-600 truncate">{student.email}</p>
                          <div className="ml-2 flex-shrink-0 flex items-center gap-2">
                            <p className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                              Active
                            </p>
                            <ChevronRight className="h-5 w-5 text-gray-400" />
                          </div>
                        </div>
                        <div className="mt-2 sm:flex sm:justify-between">
                          <div className="sm:flex">
                            <p className="flex items-center text-sm text-gray-500">
                              <Users className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                              Student
                            </p>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'students' && selectedStudent && (
          <div className="px-4 py-6 sm:px-0">
            <div className="flex items-center gap-4 mb-6">
              <button 
                onClick={() => setSelectedStudent(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <ArrowLeft className="h-6 w-6" />
              </button>
              <h2 className="text-xl font-semibold text-gray-800">
                Progress for {selectedStudent.email}
              </h2>
            </div>

            <div className="bg-white shadow overflow-hidden sm:rounded-lg">
              {studentProgress.length === 0 ? (
                <div className="px-6 py-12 text-center text-gray-500">
                  <Activity className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                  No practice sessions completed yet.
                </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {studentProgress.map((prog) => {
                    const lesson = lessons.find(l => l.id === prog.lessonId);
                    return (
                      <li key={prog.id} className="px-6 py-4">
                        <div 
                          className="flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors p-2 -mx-2 rounded"
                          onClick={() => setExpandedProgressId(expandedProgressId === prog.id ? null : (prog.id || null))}
                        >
                          <div>
                            <h4 className="text-sm font-medium text-gray-900">
                              {lesson?.title || 'Unknown Lesson'}
                            </h4>
                            <p className="text-sm text-gray-500 capitalize mt-1">
                              Mode: {prog.mode.replace('-', ' ')}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Score: {prog.score}%
                            </span>
                            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1 justify-end">
                              {prog.completedAt?.toDate ? prog.completedAt.toDate().toLocaleDateString() : 'Recently'}
                              <ChevronRight className={clsx("h-4 w-4 transition-transform", expandedProgressId === prog.id && "rotate-90")} />
                            </p>
                          </div>
                        </div>

                        {expandedProgressId === prog.id && (
                          <div className="mt-4 pt-4 border-t border-gray-100">
                            <h5 className="text-sm font-medium text-gray-900 mb-3">Submitted Answers</h5>
                            {prog.answers && prog.answers.length > 0 ? (
                              <ul className="space-y-4">
                                {prog.answers.map((ans, idx) => (
                                  <li key={ans.sentenceId || idx} className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                                    <div className="text-xs font-mono text-gray-400 mb-1">Sentence {idx + 1}</div>
                                    <p className="text-sm text-gray-600 mb-2">{ans.originalText}</p>
                                    <div className="text-sm font-medium text-indigo-700 bg-indigo-50 p-2 rounded border border-indigo-100">
                                      {typeof ans.userAnswer === 'string' 
                                        ? (ans.userAnswer || <span className="text-gray-400 italic">No input</span>)
                                        : (
                                            Object.keys(ans.userAnswer).length > 0 
                                              ? Object.entries(ans.userAnswer).map(([key, val]) => (
                                                  <span key={key} className="inline-block mr-3 bg-white px-2 py-1 rounded shadow-sm text-indigo-600 border border-indigo-100">
                                                    Gap {key}: {val}
                                                  </span>
                                                ))
                                              : <span className="text-gray-400 italic">No input</span>
                                          )
                                      }
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-gray-500 italic">No detailed answers recorded for this session.</p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
