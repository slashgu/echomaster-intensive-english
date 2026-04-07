import React, { useState, useEffect } from 'react';
import { authService, dbService } from './services';
import { User } from './services/types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Auth } from './components/Auth';
import { TeacherDashboard } from './components/TeacherDashboard';
import { StudentDashboard } from './components/StudentDashboard';
import { StudyRoom } from './components/StudyRoom';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged(async (user) => {
      if (user) {
        try {
          const updatedUser = await dbService.ensureUserExists(user);
          setUser(updatedUser);
        } catch (error) {
          console.error("Error ensuring user exists:", error);
          setUser(user);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {!user ? (
        <Auth />
      ) : activeLessonId ? (
        <StudyRoom 
          lessonId={activeLessonId} 
          onBack={() => setActiveLessonId(null)} 
        />
      ) : user.role === 'teacher' ? (
        <TeacherDashboard user={user} onSelectLesson={setActiveLessonId} />
      ) : (
        <StudentDashboard user={user} onSelectLesson={setActiveLessonId} />
      )}
    </ErrorBoundary>
  );
}
