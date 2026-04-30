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
      window.location.reload();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to link to teacher. Please check the code.');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto py-5 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <BookOpen className="h-6 w-6 text-indigo-600" />
            My Practice
          </h1>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {!user.teacherId ? (
          <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-sm border border-slate-200 mt-10">
            <h2 className="text-xl font-bold text-slate-800 mb-2 text-center">Join a Class</h2>
            <p className="text-sm text-slate-500 mb-6 text-center">
              Enter the 6-character invite code provided by your teacher to access your lessons.
            </p>
            <form onSubmit={handleLinkTeacher} className="space-y-4">
              {linkError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
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
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-center font-mono tracking-widest uppercase placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="e.g. A1B2C3"
                  maxLength={6}
                />
              </div>
              <button
                type="submit"
                disabled={linking || inviteCode.length < 6}
                className="w-full flex justify-center py-2.5 px-4 rounded-xl text-white text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {linking ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Join Class'}
              </button>
            </form>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-slate-800 mb-5">Available Lessons</h2>

            {loading ? (
              <div className="text-center py-16 text-slate-400">Loading lessons…</div>
            ) : lessons.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                <BookOpen className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                <h3 className="text-sm font-semibold text-slate-700">No lessons available</h3>
                <p className="mt-1 text-sm text-slate-400">Check back when your teacher adds new material.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {lessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="group bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => onSelectLesson(lesson.id)}
                  >
                    <div className="h-1 rounded-t-2xl w-full bg-indigo-500" />
                    <div className="px-4 py-4">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 flex-1 group-hover:text-indigo-700 transition-colors">
                          {lesson.title}
                        </h3>
                        <PlayCircle className="h-5 w-5 text-slate-200 group-hover:text-indigo-500 transition-colors flex-shrink-0 ml-2" />
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-400">
                        <Activity className="h-3 w-3" />
                        {lesson.sentenceCount} sentences
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
