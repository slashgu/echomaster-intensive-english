import React, { useState, useEffect, useRef } from 'react';
import { authService, dbService } from '../services';
import { Lesson, LessonCategory, User, Progress, Sentence } from '../services/types';
import {
  Plus, BookOpen, Users, LogOut, Activity, ChevronRight, ArrowLeft,
  Trash2, Edit3, AlertTriangle, X, Tag, FolderPlus, ChevronDown,
  GripVertical, Folder, FolderOpen
} from 'lucide-react';
import { LessonCreator } from './LessonCreator';
import { LessonGapEditor } from './LessonGapEditor';
import clsx from 'clsx';

interface TeacherDashboardProps {
  user: User;
  onSelectLesson: (lessonId: string) => void;
}

const CATEGORY_COLORS = [
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
];

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

interface CategoryDropdownProps {
  categories: LessonCategory[];
  currentCategoryId?: string;
  onAssign: (categoryId: string | null) => void;
}

function CategoryDropdown({ categories, currentCategoryId, onAssign }: CategoryDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const current = categories.find(c => c.id === currentCategoryId);

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border transition-all"
        style={current ? {
          backgroundColor: `rgb(${hexToRgb(current.color)} / 0.12)`,
          borderColor: `rgb(${hexToRgb(current.color)} / 0.3)`,
          color: current.color,
        } : {
          backgroundColor: 'rgb(241 245 249)',
          borderColor: 'rgb(203 213 225)',
          color: 'rgb(100 116 139)',
        }}
      >
        <Tag className="h-3 w-3" />
        {current ? current.name : 'No category'}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 min-w-[160px]">
          <button
            className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-2"
            onClick={() => { onAssign(null); setOpen(false); }}
          >
            <span className="w-2 h-2 rounded-full bg-slate-300 inline-block" />
            No category
          </button>
          <div className="h-px bg-slate-100 my-1" />
          {categories.map(cat => (
            <button
              key={cat.id}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2"
              onClick={() => { onAssign(cat.id); setOpen(false); }}
            >
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: cat.color }} />
              <span style={{ color: cat.color }} className="font-medium">{cat.name}</span>
              {cat.id === currentCategoryId && <span className="ml-auto text-slate-300">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface NewCategoryModalProps {
  onClose: () => void;
  onSave: (name: string, color: string) => Promise<void>;
}

function NewCategoryModal({ onClose, onSave }: NewCategoryModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(CATEGORY_COLORS[5].value);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(name.trim(), color);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
          <X className="h-5 w-5" />
        </button>
        <h3 className="text-lg font-bold text-slate-800 mb-5">New Category</h3>

        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="e.g. Business English"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>

        <div className="mb-6">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Color</label>
          <div className="flex gap-2 flex-wrap">
            {CATEGORY_COLORS.map(c => (
              <button
                key={c.value}
                onClick={() => setColor(c.value)}
                className="w-7 h-7 rounded-full transition-transform hover:scale-110 relative"
                style={{ backgroundColor: c.value }}
                title={c.label}
              >
                {color === c.value && (
                  <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-50"
            style={{ backgroundColor: color }}
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeacherDashboard({ user, onSelectLesson }: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<'lessons' | 'students'>('lessons');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [categories, setCategories] = useState<LessonCategory[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [showCreator, setShowCreator] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [editingGapsLesson, setEditingGapsLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
  const [studentProgress, setStudentProgress] = useState<Progress[]>([]);
  const [expandedProgressId, setExpandedProgressId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['uncategorized']));

  useEffect(() => {
    const unsubscribeLessons = dbService.subscribeToLessons(user.uid, (lessonsData) => {
      setLessons(lessonsData);
      setLoading(false);
    }, (error) => {
      console.error(error);
      setLoading(false);
    });

    const unsubscribeStudents = dbService.subscribeToStudents(user.uid, (studentsData) => {
      setStudents(studentsData);
    }, (error) => {
      console.error(error);
    });

    const unsubscribeCategories = dbService.subscribeToCategories(user.uid, (cats) => {
      setCategories(cats);
      setExpandedCategories(prev => {
        const next = new Set(prev);
        cats.forEach(c => next.add(c.id));
        return next;
      });
    }, (error) => {
      console.error(error);
    });

    return () => {
      unsubscribeLessons();
      unsubscribeStudents();
      unsubscribeCategories();
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

  const allLessonsConfigured = lessons.length > 0 && lessons.every(l => l.isConfigured);
  const showBanner = !bannerDismissed && !allLessonsConfigured && lessons.length > 0;

  const handleLogout = async () => {
    await authService.logout();
  };

  const handleAssignCategory = async (lessonId: string, categoryId: string | null) => {
    try {
      await dbService.assignLessonCategory(lessonId, categoryId);
    } catch (err) {
      console.error('Failed to assign category:', err);
    }
  };

  const handleCreateCategory = async (name: string, color: string) => {
    await dbService.createCategory(name, user.uid, color);
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!window.confirm('Delete this category? Lessons in it will become uncategorized.')) return;
    try {
      await dbService.deleteCategory(categoryId);
    } catch (err) {
      console.error('Failed to delete category:', err);
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

  if (showCreator) {
    return <LessonCreator onBack={() => setShowCreator(false)} onCreated={(id, title) => {
      setShowCreator(false);
      setEditingGapsLesson({
        id,
        title,
        authorId: user.uid,
        createdAt: new Date(),
        sentenceCount: 0,
      });
    }} />;
  }

  if (editingGapsLesson) {
    return <LessonGapEditor lesson={editingGapsLesson} onBack={() => setEditingGapsLesson(null)} />;
  }

  // Group lessons by category
  const lessonsByCategory: Record<string, Lesson[]> = { uncategorized: [] };
  categories.forEach(c => { lessonsByCategory[c.id] = []; });
  lessons.forEach(lesson => {
    const key = lesson.categoryId && lessonsByCategory[lesson.categoryId] !== undefined
      ? lesson.categoryId
      : 'uncategorized';
    lessonsByCategory[key].push(lesson);
  });

  const renderLessonCard = (lesson: Lesson) => (
    <div
      key={lesson.id}
      className="group bg-white rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-md transition-all cursor-pointer"
      onClick={() => onSelectLesson(lesson.id)}
    >
      {/* Configured status strip — in normal flow so no overflow-hidden needed */}
      <div
        className="h-1 rounded-t-2xl w-full"
        style={{ backgroundColor: lesson.isConfigured ? '#22c55e' : '#f59e0b' }}
      />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2 flex-1">{lesson.title}</h3>
          {/* hover actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button
              onClick={e => { e.stopPropagation(); setEditingGapsLesson(lesson); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
              title="Edit Gaps"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={async e => {
                e.stopPropagation();
                if (window.confirm('Delete this lesson?')) {
                  try { await dbService.deleteLesson(lesson.id); }
                  catch (err) { console.error(err); alert('Failed to delete lesson.'); }
                }
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Delete Lesson"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <Activity className="h-3 w-3" />
            <span>{lesson.sentenceCount} sentences</span>
          </div>
          <CategoryDropdown
            categories={categories}
            currentCategoryId={lesson.categoryId}
            onAssign={catId => handleAssignCategory(lesson.id, catId)}
          />
        </div>

        {!lesson.isConfigured && (
          <button
            onClick={e => { e.stopPropagation(); setEditingGapsLesson(lesson); }}
            className="mt-3 w-full flex items-center justify-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 rounded-lg py-1.5 hover:bg-amber-100 transition-colors"
          >
            <Edit3 className="h-3 w-3" />
            Configure gaps
          </button>
        )}
      </div>
    </div>
  );

  const renderCategorySection = (
    id: string,
    name: string,
    color: string | null,
    sectionLessons: Lesson[],
    deletable = false
  ) => {
    const isExpanded = expandedCategories.has(id);
    return (
      <div key={id} className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => toggleCategory(id)}
            className="flex items-center gap-2 group/header flex-1 min-w-0"
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
          {deletable && (
            <button
              onClick={() => handleDeleteCategory(id)}
              className="p-1 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0"
              title="Delete category"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {isExpanded && (
          <>
            {sectionLessons.length === 0 ? (
              <div className="text-xs text-slate-400 italic pl-6 py-2">
                No lessons in this category. Assign lessons using the tag button on each card.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 pl-1">
                {sectionLessons.map(renderLessonCard)}
              </div>
            )}
          </>
        )}
        <div className="mt-4 h-px bg-slate-100" />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto py-5 px-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
              <BookOpen className="h-6 w-6 text-indigo-600" />
              Teacher Dashboard
            </h1>
            {user.inviteCode && (
              <p className="mt-1.5 text-sm text-slate-500">
                Class Code:{' '}
                <span className="font-mono font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-lg text-xs tracking-widest">
                  {user.inviteCode}
                </span>
              </p>
            )}
          </div>
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
        {/* Tab nav */}
        <div className="mb-8 flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
          {([
            { key: 'lessons', icon: BookOpen, label: 'Lessons', count: lessons.length },
            { key: 'students', icon: Users, label: 'Students', count: students.length },
          ] as const).map(({ key, icon: Icon, label, count }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setSelectedStudent(null); }}
              className={clsx(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                activeTab === key
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {count > 0 && (
                <span className={clsx(
                  'text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center leading-none',
                  activeTab === key ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-500'
                )}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Lessons Tab */}
        {activeTab === 'lessons' && (
          <div>
            <div className="flex flex-wrap gap-2 items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-800">Lessons</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowNewCategory(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  <FolderPlus className="h-4 w-4 text-slate-500" />
                  New Category
                </button>
                <button
                  onClick={() => setShowCreator(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-all shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  New Lesson
                </button>
              </div>
            </div>

            {showBanner && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3.5 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-800">Some lessons need gap configuration</p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Click <Edit3 className="inline h-3.5 w-3.5" /> on a lesson card to set up gap-fill words.
                  </p>
                </div>
                <button
                  onClick={() => setBannerDismissed(true)}
                  className="text-amber-400 hover:text-amber-600 p-0.5 rounded hover:bg-amber-100 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {loading ? (
              <div className="text-center py-16 text-slate-400">Loading lessons…</div>
            ) : lessons.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
                <BookOpen className="mx-auto h-10 w-10 text-slate-300 mb-3" />
                <h3 className="text-sm font-semibold text-slate-700">No lessons yet</h3>
                <p className="mt-1 text-sm text-slate-400">Create your first lesson to get started.</p>
              </div>
            ) : (
              <div>
                {/* Named categories */}
                {categories.map(cat =>
                  renderCategorySection(cat.id, cat.name, cat.color, lessonsByCategory[cat.id] || [], true)
                )}

                {/* Uncategorized */}
                {renderCategorySection('uncategorized', 'Uncategorized', null, lessonsByCategory.uncategorized || [])}
              </div>
            )}
          </div>
        )}

        {/* Students Tab */}
        {activeTab === 'students' && !selectedStudent && (
          <div>
            <h2 className="text-lg font-bold text-slate-800 mb-5">Student Roster</h2>
            <div className="bg-white shadow-sm rounded-2xl border border-slate-200 overflow-hidden">
              {students.length === 0 ? (
                <div className="px-6 py-10 text-center text-slate-400">
                  <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                  No students registered yet.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {students.map((student) => (
                    <li key={student.uid}>
                      <div
                        className="px-5 py-4 hover:bg-slate-50 cursor-pointer transition-colors flex items-center gap-3 justify-between"
                        onClick={() => setSelectedStudent(student)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-bold text-indigo-600 uppercase">
                              {student.email?.[0] ?? '?'}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{student.email}</p>
                            <p className="text-xs text-slate-400 mt-0.5">Student</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700">Active</span>
                          <ChevronRight className="h-4 w-4 text-slate-300" />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === 'students' && selectedStudent && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setSelectedStudent(null)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-sm font-bold text-indigo-600 uppercase">
                    {selectedStudent.email?.[0] ?? '?'}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">{selectedStudent.email}</h2>
                  <p className="text-xs text-slate-400">Practice history</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              {studentProgress.length === 0 ? (
                <div className="px-6 py-16 text-center text-slate-400">
                  <Activity className="mx-auto h-10 w-10 text-slate-200 mb-3" />
                  No practice sessions completed yet.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {studentProgress.map((prog) => {
                    const lesson = lessons.find(l => l.id === prog.lessonId);
                    return (
                      <li key={prog.id} className="px-5 py-4">
                        <div
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => setExpandedProgressId(expandedProgressId === prog.id ? null : (prog.id || null))}
                        >
                          <div>
                            <h4 className="text-sm font-semibold text-slate-800">{lesson?.title || 'Unknown Lesson'}</h4>
                            <p className="text-xs text-slate-400 capitalize mt-0.5">Mode: {prog.mode.replace('-', ' ')}</p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={clsx(
                                      'h-full rounded-full transition-all',
                                      prog.score >= 80 ? 'bg-green-500' : prog.score >= 50 ? 'bg-amber-400' : 'bg-red-400'
                                    )}
                                    style={{ width: `${prog.score}%` }}
                                  />
                                </div>
                                <span className={clsx(
                                  'text-xs font-bold w-9 text-right',
                                  prog.score >= 80 ? 'text-green-600' : prog.score >= 50 ? 'text-amber-600' : 'text-red-500'
                                )}>
                                  {prog.score}%
                                </span>
                              </div>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {prog.completedAt?.toDate ? prog.completedAt.toDate().toLocaleDateString() : 'Recently'}
                              </p>
                            </div>
                            <ChevronRight className={clsx("h-4 w-4 text-slate-300 transition-transform", expandedProgressId === prog.id && "rotate-90")} />
                          </div>
                        </div>

                        {expandedProgressId === prog.id && (
                          <div className="mt-4 pt-4 border-t border-slate-100">
                            <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Submitted Answers</h5>
                            {prog.answers && prog.answers.length > 0 ? (
                              <ul className="space-y-3">
                                {prog.answers.map((ans, idx) => (
                                  <li key={ans.sentenceId || idx} className="bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                                    <div className="text-xs text-slate-400 mb-1">Sentence {idx + 1}</div>
                                    <p className="text-sm text-slate-600 mb-2">{ans.originalText}</p>
                                    <div className="text-sm font-medium text-indigo-700 bg-indigo-50 p-2.5 rounded-lg border border-indigo-100">
                                      {typeof ans.userAnswer === 'string'
                                        ? (ans.userAnswer || <span className="text-slate-400 italic">No input</span>)
                                        : (Object.keys(ans.userAnswer).length > 0
                                            ? Object.entries(ans.userAnswer).map(([key, val]) => (
                                                <span key={key} className="inline-block mr-2 bg-white px-2 py-0.5 rounded-lg shadow-sm text-indigo-600 border border-indigo-100 text-xs">
                                                  Gap {key}: {val}
                                                </span>
                                              ))
                                            : <span className="text-slate-400 italic text-xs">No input</span>
                                          )
                                      }
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-slate-400 italic">No detailed answers recorded.</p>
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

      {showNewCategory && (
        <NewCategoryModal onClose={() => setShowNewCategory(false)} onSave={handleCreateCategory} />
      )}
    </div>
  );
}
