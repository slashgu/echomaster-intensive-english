import React, { useState, useEffect } from 'react';
import { authService, dbService } from '../services';
import { Lesson, User, Progress } from '../services/types';
import { Plus, BookOpen, Users, LogOut, Activity, ChevronRight, ArrowLeft, Trash2 } from 'lucide-react';
import { LessonCreator } from './LessonCreator';

interface TeacherDashboardProps {
  user: User;
  onSelectLesson: (lessonId: string) => void;
}

export function TeacherDashboard({ user, onSelectLesson }: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<'lessons' | 'students'>('lessons');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<User[]>([]);
  const [showCreator, setShowCreator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
  const [studentProgress, setStudentProgress] = useState<Progress[]>([]);

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

  const handleLogout = async () => {
    await authService.logout();
  };

  if (showCreator) {
    return <LessonCreator onBack={() => setShowCreator(false)} onCreated={(id) => {
      setShowCreator(false);
      onSelectLesson(id);
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
                          className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1 absolute top-4 right-4"
                          title="Delete Lesson"
                        >
                          <Trash2 className="h-5 w-5" />
                        </button>
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
                        <div className="flex items-center justify-between">
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
                            <p className="text-xs text-gray-400 mt-1">
                              {prog.completedAt?.toDate ? prog.completedAt.toDate().toLocaleDateString() : 'Recently'}
                            </p>
                          </div>
                        </div>
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
