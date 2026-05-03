import { IDatabaseService, User, Lesson, LessonCategory, Sentence, Progress } from './types';
import { apiFetch } from './apiAuthService';
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidateByPrefix, onCacheInvalidate } from './cache';

/**
 * API-based database service that calls Vercel serverless functions instead of
 * Firestore client SDK. All data goes through /api/db/* endpoints.
 * 
 * Real-time onSnapshot subscriptions are replaced with polling.
 *
 * ── Caching strategy ──
 * GET responses are cached in-memory with a 2-minute TTL.  Polling still runs
 * at POLL_INTERVAL, but if the cache entry is still valid the network request
 * is skipped entirely.  Mutation endpoints (POST / PATCH / DELETE) invalidate
 * the relevant cache keys so the next poll picks up fresh data.
 *
 * Cache key conventions:
 *   lessons:<authorId>        → lesson list for a teacher
 *   sentences:<lessonId>      → sentence list for a lesson
 *   students:<teacherId>      → student list for a teacher
 *   progress:<userId>         → progress list for a user
 */

const POLL_INTERVAL = 180_000; // 180 seconds (3 minutes) — drastically reduced to save quota
const pendingRequests = new Map<string, Promise<any>>();

/**
 * Deduplicates in-flight API requests. If a request for the same URL is
 * already pending, returns the existing promise instead of firing a new one.
 */
async function deduplicatedFetch(url: string, options?: RequestInit) {
  if (pendingRequests.has(url)) {
    return pendingRequests.get(url);
  }

  const promise = apiFetch(url, options).finally(() => {
    pendingRequests.delete(url);
  });

  pendingRequests.set(url, promise);
  return promise;
}

// ── Cache key helpers ────────────────────────────────────────────────

const CACHE_KEY = {
  lessons:    (authorId: string)  => `lessons:${authorId}`,
  sentences:  (lessonId: string)  => `sentences:${lessonId}`,
  students:   (teacherId: string) => `students:${teacherId}`,
  progress:   (userId: string)    => `progress:${userId}`,
  categories: (teacherId: string) => `categories:${teacherId}`,
} as const;

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
    const cacheKey = CACHE_KEY.lessons(authorId);

    const fetchLessons = async () => {
      try {
        // Check cache first
        const cached = cacheGet<Lesson[]>(cacheKey);
        if (cached) {
          if (!cancelled) callback(cached);
          return;
        }

        const response = await deduplicatedFetch(`/api/db/lessons?authorId=${encodeURIComponent(authorId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch lessons.'));
          return;
        }

        cacheSet(cacheKey, data.lessons);
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

    // Immediately re-fetch when a mutation invalidates this cache key
    const unsubInvalidate = onCacheInvalidate(cacheKey, () => {
      if (!cancelled) fetchLessons();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubInvalidate();
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

    // Invalidate all lesson caches so the next poll picks up the new lesson
    cacheInvalidateByPrefix('lessons:');
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

    // Invalidate lesson & sentence caches
    cacheInvalidateByPrefix('lessons:');
    cacheInvalidate(CACHE_KEY.sentences(lessonId));
  },

  subscribeToSentences(lessonId: string, callback: (sentences: Sentence[]) => void, onError: (error: Error) => void): () => void {
    let cancelled = false;
    const cacheKey = CACHE_KEY.sentences(lessonId);

    const fetchSentences = async () => {
      try {
        // Check cache first
        const cached = cacheGet<Sentence[]>(cacheKey);
        if (cached) {
          if (!cancelled) callback(cached);
          return;
        }

        const response = await deduplicatedFetch(`/api/db/sentences?lessonId=${encodeURIComponent(lessonId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch sentences.'));
          return;
        }

        cacheSet(cacheKey, data.sentences);
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

    // Immediately re-fetch when a mutation invalidates this cache key
    const unsubInvalidate = onCacheInvalidate(cacheKey, () => {
      if (!cancelled) fetchSentences();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubInvalidate();
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

    // Invalidate sentence cache for this lesson
    cacheInvalidate(CACHE_KEY.sentences(lessonId));
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

    // Invalidate caches
    cacheInvalidate(CACHE_KEY.sentences(lessonId));
    cacheInvalidateByPrefix('lessons:');
  },

  async updateSentenceGapsBatch(lessonId: string, updates: { sentenceId: string, gapIndexes: number[] }[]): Promise<void> {
    const response = await apiFetch('/api/db/sentences', {
      method: 'PATCH',
      body: JSON.stringify({ lessonId, updates, isBatch: true }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update gaps (batch).');
    }

    // Invalidate caches
    cacheInvalidate(CACHE_KEY.sentences(lessonId));
    cacheInvalidateByPrefix('lessons:');
  },

  subscribeToStudents(teacherId: string, callback: (students: User[]) => void, onError: (error: Error) => void): () => void {
    let cancelled = false;
    const cacheKey = CACHE_KEY.students(teacherId);

    const fetchStudents = async () => {
      try {
        // Check cache first
        const cached = cacheGet<User[]>(cacheKey);
        if (cached) {
          if (!cancelled) callback(cached);
          return;
        }

        const response = await deduplicatedFetch(`/api/db/students?teacherId=${encodeURIComponent(teacherId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch students.'));
          return;
        }

        cacheSet(cacheKey, data.students);
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

    // Immediately re-fetch when a mutation invalidates this cache key
    const unsubInvalidate = onCacheInvalidate(cacheKey, () => {
      if (!cancelled) fetchStudents();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubInvalidate();
    };
  },

  subscribeToProgress(userId: string, callback: (progress: Progress[]) => void, onError: (error: Error) => void): () => void {
    let cancelled = false;
    const cacheKey = CACHE_KEY.progress(userId);

    const fetchProgress = async () => {
      try {
        // Check cache first
        const cached = cacheGet<Progress[]>(cacheKey);
        if (cached) {
          if (!cancelled) callback(cached);
          return;
        }

        const response = await deduplicatedFetch(`/api/db/progress?userId=${encodeURIComponent(userId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch progress.'));
          return;
        }

        cacheSet(cacheKey, data.progress);
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

    // Immediately re-fetch when a mutation invalidates this cache key
    const unsubInvalidate = onCacheInvalidate(cacheKey, () => {
      if (!cancelled) fetchProgress();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubInvalidate();
    };
  },

  async gradeProgress(progressId: string, teacherGrade: number | null, teacherComment: string): Promise<void> {
    const response = await apiFetch('/api/db/progress', {
      method: 'PATCH',
      body: JSON.stringify({ id: progressId, teacherGrade, teacherComment }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to grade progress.');
    }

    cacheInvalidateByPrefix('progress:');
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

    // Invalidate progress cache for this user
    cacheInvalidate(CACHE_KEY.progress(progress.userId));
  },

  async assignLessonCategory(lessonId: string, categoryId: string | null): Promise<void> {
    const response = await apiFetch('/api/db/lessons', {
      method: 'PATCH',
      body: JSON.stringify({ id: lessonId, categoryId }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to assign category.');
    }

    cacheInvalidateByPrefix('lessons:');
  },

  subscribeToCategories(teacherId: string, callback: (categories: LessonCategory[]) => void, onError: (error: Error) => void): () => void {
    if (!teacherId) {
      callback([]);
      return () => {};
    }

    let cancelled = false;
    const cacheKey = CACHE_KEY.categories(teacherId);

    const fetchCategories = async () => {
      try {
        const cached = cacheGet<LessonCategory[]>(cacheKey);
        if (cached) {
          if (!cancelled) callback(cached);
          return;
        }

        const response = await deduplicatedFetch(`/api/db/categories?teacherId=${encodeURIComponent(teacherId)}`);
        if (cancelled) return;

        const data = await response.json();
        if (!response.ok) {
          onError(new Error(data.error || 'Failed to fetch categories.'));
          return;
        }

        cacheSet(cacheKey, data.categories);
        callback(data.categories);
      } catch (error: any) {
        if (!cancelled) onError(error);
      }
    };

    fetchCategories();
    const interval = setInterval(() => {
      if (!cancelled) fetchCategories();
    }, POLL_INTERVAL);

    const unsubInvalidate = onCacheInvalidate(cacheKey, () => {
      if (!cancelled) fetchCategories();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubInvalidate();
    };
  },

  async createCategory(name: string, teacherId: string, color: string): Promise<string> {
    const response = await apiFetch('/api/db/categories', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create category.');
    }

    cacheInvalidateByPrefix('categories:');
    return data.id;
  },

  async deleteCategory(categoryId: string): Promise<void> {
    const response = await apiFetch(`/api/db/categories?id=${encodeURIComponent(categoryId)}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete category.');
    }

    cacheInvalidateByPrefix('categories:');
    cacheInvalidateByPrefix('lessons:');
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

    // Invalidate all student caches (we don't know the teacherId yet)
    cacheInvalidateByPrefix('students:');
  },
};
