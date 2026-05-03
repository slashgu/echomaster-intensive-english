import React, { useState, useEffect, useMemo } from 'react';
import { authService, dbService } from '../services';
import { Lesson, LessonCategory, Progress, User } from '../services/types';
import {
  BookOpen, LogOut, PlayCircle, Activity, Loader2, Folder, FolderOpen,
  ChevronRight, Award, MessageSquare, CheckCircle2, Clock, GraduationCap, Tag
} from 'lucide-react';
import clsx from 'clsx';

interface StudentDashboardProps {
  user: User;
  onSelectLesson: (lessonId: string) => void;
}

type Tab = 'lessons' | 'grades';

export function StudentDashboard({ user, onSelectLesson }: StudentDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('lessons');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [categories, setCategories] = useState<LessonCategory[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['uncategorized']));
  const [expandedProgressId, setExpandedProgressId] = useState<string | null>(null);

  useEffect(() => {
    if (!user.teacherId) {
      setLoading(false);
      return;
    }

    const unsubscribeLessons = dbService.subscribeToLessons(user.teacherId, (lessonsData) => {
      setLessons(lessonsData);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });

    const unsubscribeCategories = dbService.subscribeToCategories(user.teacherId, (cats) => {
      setCategories(cats);
      setExpandedCategories(prev => {
        const next = new Set(prev);
        cats.forEach(c => next.add(c.id));
        return next;
      });
    }, (error) => console.error(error));

    const unsubscribeProgress = dbService.subscribeToProgress(user.uid, (data) => {
      setProgress(data);
    }, (error) => console.error(error));

    return () => {
      unsubscribeLessons();
      unsubscribeCategories();
      unsubscribeProgress();
    };
  }, [user.teacherId, user.uid]);

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

  const toggleCategory = (id: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group lessons by category
  const lessonsByCategory = useMemo(() => {
    const grouped: Record<string, Lesson[]> = { uncategorized: [] };
    categories.forEach(c => { grouped[c.id] = []; });
    lessons.forEach(lesson => {
      const key = lesson.categoryId && grouped[lesson.categoryId] !== undefined
        ? lesson.categoryId
        : 'uncategorized';
      grouped[key].push(lesson);
    });
    return grouped;
  }, [lessons, categories]);

  // Map lessonId → most recent progress (for completion badge on lesson cards)
  const lastProgressByLesson = useMemo(() => {
    const map: Record<string, Progress> = {};
    progress.forEach(p => {
      const ts = (() => {
        const v = p.completedAt;
        if (!v) return 0;
        if (typeof v === 'string') return new Date(v).getTime();
        if (v?.toDate) return v.toDate().getTime();
        if (v instanceof Date) return v.getTime();
        return 0;
      })();
      const existing = map[p.lessonId];
      const existingTs = existing ? (() => {
        const v = existing.completedAt;
        if (typeof v === 'string') return new Date(v).getTime();
        if (v?.toDate) return v.toDate().getTime();
        if (v instanceof Date) return v.getTime();
        return 0;
      })() : 0;
      if (!existing || ts > existingTs) map[p.lessonId] = p;
    });
    return map;
  }, [progress]);

  const formatDate = (v: any): string => {
    if (!v) return 'Recently';
    try {
      const d = v?.toDate ? v.toDate() : new Date(v);
      if (isNaN(d.getTime())) return 'Recently';
      return d.toLocaleDateString();
    } catch {
      return 'Recently';
    }
  };

  const renderLessonCard = (lesson: Lesson) => {
    const lastProg = lastProgressByLesson[lesson.id];
    const cat = categories.find(c => c.id === lesson.categoryId);
    return (
      <div
        key={lesson.id}
        className="group bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer"
        onClick={() => onSelectLesson(lesson.id)}
      >
        <div
          className="h-1 rounded-t-2xl w-full"
          style={{ backgroundColor: cat?.color || '#6366f1' }}
        />
        <div className="px-4 py-4">
          <div className="flex justify-between items-start mb-3 gap-2">
            <h3 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 flex-1 group-hover:text-indigo-700 transition-colors">
              {lesson.title}
            </h3>
            <PlayCircle className="h-5 w-5 text-slate-200 group-hover:text-indigo-500 transition-colors flex-shrink-0" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-xs text-slate-400">
              <Activity className="h-3 w-3" />
              {lesson.sentenceCount} sentences
            </div>
            {lastProg && (
              <div className="flex items-center gap-1.5">
                {lastProg.teacherGrade !== undefined && lastProg.teacherGrade !== null ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs font-bold">
                    <Award className="h-3 w-3" />
                    {lastProg.teacherGrade}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-xs font-medium">
                    <CheckCircle2 className="h-3 w-3" />
                    Done
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCategorySection = (
    id: string,
    name: string,
    color: string | null,
    sectionLessons: Lesson[]
  ) => {
    if (sectionLessons.length === 0 && id === 'uncategorized') return null;
    const isExpanded = expandedCategories.has(id);
    return (
      <div key={id} className="mb-6">
        <button
          onClick={() => toggleCategory(id)}
          className="flex items-center gap-2 mb-3 w-full text-left"
        >
          {isExpanded
            ? <FolderOpen className="h-4 w-4 flex-shrink-0" style={{ color: color || '#94a3b8' }} />
            : <Folder className="h-4 w-4 flex-shrink-0" style={{ color: color || '#94a3b8' }} />
          }
          <span
            className="text-sm font-bold tracking-wide uppercase truncate"
            style={{ color: color || '#94a3b8' }}
          >
            {name}
          </span>
          <span className="text-xs text-slate-400 font-normal ml-1 flex-shrink-0">
            {sectionLessons.length} {sectionLessons.length === 1 ? 'lesson' : 'lessons'}
          </span>
          <ChevronRight
            className="h-3.5 w-3.5 text-slate-400 transition-transform flex-shrink-0"
            style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          />
        </button>

        {isExpanded && (
          sectionLessons.length === 0 ? (
            <div className="text-xs text-slate-400 italic pl-6 py-2">No lessons in this category yet.</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 pl-1">
              {sectionLessons.map(renderLessonCard)}
            </div>
          )
        )}
        <div className="mt-4 h-px bg-slate-100" />
      </div>
    );
  };

  const gradedCount = progress.filter(p => p.teacherGrade !== undefined && p.teacherGrade !== null).length;

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
            {/* Tab nav */}
            <div className="mb-8 flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
              {([
                { key: 'lessons', icon: BookOpen, label: 'Lessons' },
                { key: 'grades', icon: GraduationCap, label: `Grades & Feedback${gradedCount > 0 ? ` (${gradedCount})` : ''}` },
              ] as const).map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    activeTab === key
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'lessons' && (
              <>
                {loading ? (
                  <div className="text-center py-16 text-slate-400">Loading lessons…</div>
                ) : lessons.length === 0 ? (
                  <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                    <BookOpen className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                    <h3 className="text-sm font-semibold text-slate-700">No lessons available</h3>
                    <p className="mt-1 text-sm text-slate-400">Check back when your teacher adds new material.</p>
                  </div>
                ) : (
                  <div>
                    {categories.map(cat =>
                      renderCategorySection(cat.id, cat.name, cat.color, lessonsByCategory[cat.id] || [])
                    )}
                    {renderCategorySection('uncategorized', 'Other Lessons', null, lessonsByCategory.uncategorized || [])}
                  </div>
                )}
              </>
            )}

            {activeTab === 'grades' && (
              <div>
                <h2 className="text-lg font-bold text-slate-800 mb-5">Practice History & Teacher Feedback</h2>
                {progress.length === 0 ? (
                  <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                    <GraduationCap className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                    <h3 className="text-sm font-semibold text-slate-700">No submissions yet</h3>
                    <p className="mt-1 text-sm text-slate-400">Complete a practice session to see your grades here.</p>
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {progress.map(prog => {
                      const lesson = lessons.find(l => l.id === prog.lessonId);
                      const cat = lesson?.categoryId ? categories.find(c => c.id === lesson.categoryId) : undefined;
                      const isGraded = prog.teacherGrade !== undefined && prog.teacherGrade !== null;
                      const isExpanded = expandedProgressId === prog.id;
                      return (
                        <li
                          key={prog.id}
                          className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                        >
                          <div
                            className="px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between gap-3"
                            onClick={() => setExpandedProgressId(isExpanded ? null : (prog.id || null))}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-semibold text-slate-800 truncate">{lesson?.title || 'Unknown Lesson'}</h4>
                                {cat && (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full"
                                    style={{
                                      backgroundColor: `${cat.color}1a`,
                                      color: cat.color,
                                    }}
                                  >
                                    <Tag className="h-2.5 w-2.5" />
                                    {cat.name}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 capitalize mt-0.5">
                                {prog.mode.replace('-', ' ')} • Submitted {formatDate(prog.completedAt)}
                              </p>
                            </div>

                            <div className="flex items-center gap-3 flex-shrink-0">
                              {isGraded ? (
                                <div className="text-center">
                                  <div className={clsx(
                                    "px-3 py-1 rounded-xl font-extrabold text-lg leading-none",
                                    prog.teacherGrade! >= 80 ? "bg-green-100 text-green-700" :
                                      prog.teacherGrade! >= 50 ? "bg-amber-100 text-amber-700" :
                                        "bg-red-100 text-red-600"
                                  )}>
                                    {prog.teacherGrade}
                                  </div>
                                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5 font-semibold">Grade</p>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center text-amber-500">
                                  <Clock className="h-5 w-5" />
                                  <span className="text-[10px] uppercase tracking-wide mt-0.5 font-semibold">Pending</span>
                                </div>
                              )}
                              <ChevronRight className={clsx("h-4 w-4 text-slate-300 transition-transform", isExpanded && "rotate-90")} />
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-5 pb-5 pt-1 border-t border-slate-100 bg-slate-50/50">
                              {prog.teacherComment && (
                                <div className="mt-4 p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                                  <div className="flex items-center gap-2 mb-2">
                                    <MessageSquare className="h-4 w-4 text-indigo-600" />
                                    <h5 className="text-xs font-bold text-indigo-700 uppercase tracking-wide">Teacher's Feedback</h5>
                                  </div>
                                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{prog.teacherComment}</p>
                                </div>
                              )}

                              {!isGraded && !prog.teacherComment && (
                                <p className="mt-4 text-sm text-slate-400 italic">Your teacher hasn't reviewed this submission yet.</p>
                              )}

                              <div className="mt-4">
                                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                                  Auto-score: <span className="text-slate-700">{prog.score}%</span>
                                </h5>
                                {prog.answers && prog.answers.length > 0 && (
                                  <details className="group">
                                    <summary className="cursor-pointer text-xs font-medium text-indigo-600 hover:text-indigo-800 select-none">
                                      View my answers ({prog.answers.length})
                                    </summary>
                                    <ul className="space-y-2 mt-3">
                                      {prog.answers.map((ans, idx) => (
                                        <li key={ans.sentenceId || idx} className="bg-white p-3 rounded-xl border border-slate-100">
                                          <div className="text-xs text-slate-400 mb-1">Sentence {idx + 1}</div>
                                          <p className="text-sm text-slate-700 mb-2">{ans.originalText}</p>
                                          <div className="text-sm font-medium text-indigo-700 bg-indigo-50 p-2 rounded-lg border border-indigo-100">
                                            {typeof ans.userAnswer === 'string'
                                              ? (ans.userAnswer || <span className="text-slate-400 italic">No input</span>)
                                              : (Object.keys(ans.userAnswer).length > 0
                                                  ? Object.entries(ans.userAnswer).map(([key, val]) => (
                                                      <span key={key} className="inline-block mr-2 bg-white px-1.5 py-0.5 rounded text-indigo-600 border border-indigo-100 text-xs">
                                                        Gap {key}: {val || <span className="italic text-slate-400">empty</span>}
                                                      </span>
                                                    ))
                                                  : <span className="text-slate-400 italic text-xs">No input</span>
                                                )
                                            }
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
