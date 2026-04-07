import React, { useState, useEffect } from 'react';
import { authService, dbService } from '../services';
import { Lesson, User } from '../services/types';
import { BookOpen, LogOut, PlayCircle, Activity, Loader2 } from 'lucide-react';

interface StudentDashboardProps {
  user: User;
  onSelectLesson: (lessonId: string) => void;
}

export function StudentDashboard({ user, onSelectLesson }: StudentDashboardProps) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    if (user.teacherId) {
      const unsubscribeLessons = dbService.subscribeToLessons(user.teacherId, (lessonsData) => {
        setLessons(lessonsData);
        setLoading(false);
      }, (error) => {
        console.error(error);
        setLoading(false);
      });
      return () => unsubscribeLessons();
    } else {
      setLoading(false);
    }
  }, [user.teacherId]);

  const handleLogout = async () => {
    await authService.logout();
  };

  const handleLinkTeacher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    
    setLinking(true);
    setLinkError('');
    try {
      await dbService.linkStudentToTeacher(user.uid, inviteCode.trim().toUpperCase());
      // The App component's onAuthStateChanged listener might not pick up the change 
      // if it only listens to auth state, not document changes.
      // But we'll rely on the parent component to re-render if needed, 
      // or we might need to force a refresh here.
      // For now, let's assume the parent handles it or we can just reload.
      window.location.reload();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to link to teacher. Please check the code.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <BookOpen className="h-8 w-8 text-indigo-600" />
            My Practice
          </h1>
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
        <div className="px-4 py-6 sm:px-0">
          {!user.teacherId ? (
            <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-md border border-gray-100 mt-10">
              <h2 className="text-xl font-semibold text-gray-900 mb-4 text-center">Join a Class</h2>
              <p className="text-sm text-gray-600 mb-6 text-center">
                Enter the 6-character invite code provided by your teacher to access your lessons.
              </p>
              <form onSubmit={handleLinkTeacher} className="space-y-4">
                {linkError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                    {linkError}
                  </div>
                )}
                <div>
                  <label htmlFor="inviteCode" className="sr-only">Invite Code</label>
                  <input
                    id="inviteCode"
                    type="text"
                    required
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    className="appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm text-center font-mono tracking-widest uppercase"
                    placeholder="e.g. A1B2C3"
                    maxLength={6}
                  />
                </div>
                <button
                  type="submit"
                  disabled={linking || inviteCode.length < 6}
                  className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-70"
                >
                  {linking ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Join Class'}
                </button>
              </form>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-gray-800 mb-6">Available Lessons</h2>

              {loading ? (
                <div className="text-center py-12 text-gray-500">Loading lessons...</div>
              ) : lessons.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-lg shadow border border-gray-200">
                  <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No lessons available</h3>
                  <p className="mt-1 text-sm text-gray-500">Check back later when your teacher adds new material.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {lessons.map((lesson) => (
                    <div
                      key={lesson.id}
                      className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 hover:border-indigo-500 transition-colors cursor-pointer group"
                      onClick={() => onSelectLesson(lesson.id)}
                    >
                      <div className="px-4 py-5 sm:p-6">
                        <div className="flex justify-between items-start">
                          <h3 className="text-lg font-medium text-gray-900 truncate group-hover:text-indigo-600 transition-colors">{lesson.title}</h3>
                          <PlayCircle className="h-6 w-6 text-indigo-100 group-hover:text-indigo-500 transition-colors" />
                        </div>
                        <div className="mt-2 flex items-center text-sm text-gray-500">
                          <Activity className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                          {lesson.sentenceCount} sentences
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
