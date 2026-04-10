import { IDatabaseService, User, Lesson, Sentence, Progress } from './types';
import { apiFetch } from './apiAuthService';

/**
 * API-based database service that calls Vercel serverless functions instead of
 * Firestore client SDK. All data goes through /api/db/* endpoints.
 * 
 * Real-time onSnapshot subscriptions are replaced with polling.
 */

const POLL_INTERVAL = 30000; // 30 seconds — reduced from 5s to conserve Firestore free-tier read quota

export const apiDbService: IDatabaseService = {
  async ensureUserExists(user: User): Promise<User> {
    const response = await apiFetch('/api/db/users', {
      method: 'POST',
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        role: user.role,
        teacherId: user.teacherId,
        inviteCode: user.inviteCode,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to ensure user exists.');
    }

    return data.user;
  },

  subscribeToLessons(authorId: string, callback: (lessons: Lesson[]) => void, onError: (error: Error) => void): () => void {
    if (!authorId) {
      callback([]);
      return () => {};
    }

    let cancelled = false;

    const fetchLessons = async () => {
      try {
        const response = await apiFetch(`/api/db/lessons?authorId=${encodeURIComponent(authorId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch lessons.'));
          return;
        }

        callback(data.lessons);
      } catch (error: any) {
        if (!cancelled) {
          onError(error);
        }
      }
    };

    // Initial fetch
    fetchLessons();

    // Poll for updates
    const interval = setInterval(() => {
      if (!cancelled) fetchLessons();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  async createLesson(title: string, authorId: string, sentenceCount: number): Promise<string> {
    const response = await apiFetch('/api/db/lessons', {
      method: 'POST',
      body: JSON.stringify({ title, sentenceCount }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create lesson.');
    }

    return data.id;
  },

  async deleteLesson(lessonId: string): Promise<void> {
    const response = await apiFetch(`/api/db/lessons?id=${encodeURIComponent(lessonId)}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete lesson.');
    }
  },

  subscribeToSentences(lessonId: string, callback: (sentences: Sentence[]) => void, onError: (error: Error) => void): () => void {
    let cancelled = false;

    const fetchSentences = async () => {
      try {
        const response = await apiFetch(`/api/db/sentences?lessonId=${encodeURIComponent(lessonId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch sentences.'));
          return;
        }

        callback(data.sentences);
      } catch (error: any) {
        if (!cancelled) {
          onError(error);
        }
      }
    };

    fetchSentences();
    const interval = setInterval(() => {
      if (!cancelled) fetchSentences();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  async addSentenceToLesson(lessonId: string, sentence: Omit<Sentence, 'id'>): Promise<void> {
    const response = await apiFetch('/api/db/sentences', {
      method: 'POST',
      body: JSON.stringify({ lessonId, ...sentence }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to add sentence.');
    }
  },

  async updateSentenceGaps(lessonId: string, sentenceId: string, gapIndexes: number[]): Promise<void> {
    const response = await apiFetch('/api/db/sentences', {
      method: 'PATCH',
      body: JSON.stringify({ lessonId, sentenceId, gapIndexes }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update gaps.');
    }
  },

  subscribeToStudents(teacherId: string, callback: (students: User[]) => void, onError: (error: Error) => void): () => void {
    let cancelled = false;

    const fetchStudents = async () => {
      try {
        const response = await apiFetch(`/api/db/students?teacherId=${encodeURIComponent(teacherId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch students.'));
          return;
        }

        callback(data.students);
      } catch (error: any) {
        if (!cancelled) {
          onError(error);
        }
      }
    };

    fetchStudents();
    const interval = setInterval(() => {
      if (!cancelled) fetchStudents();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  subscribeToProgress(userId: string, callback: (progress: Progress[]) => void, onError: (error: Error) => void): () => void {
    let cancelled = false;

    const fetchProgress = async () => {
      try {
        const response = await apiFetch(`/api/db/progress?userId=${encodeURIComponent(userId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch progress.'));
          return;
        }

        callback(data.progress);
      } catch (error: any) {
        if (!cancelled) {
          onError(error);
        }
      }
    };

    fetchProgress();
    const interval = setInterval(() => {
      if (!cancelled) fetchProgress();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  async saveProgress(progress: Progress): Promise<void> {
    const response = await apiFetch('/api/db/progress', {
      method: 'POST',
      body: JSON.stringify(progress),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to save progress.');
    }
  },

  async linkStudentToTeacher(studentId: string, inviteCode: string): Promise<void> {
    const response = await apiFetch('/api/db/students', {
      method: 'POST',
      body: JSON.stringify({ studentId, inviteCode }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to link student to teacher.');
    }
  },
};
