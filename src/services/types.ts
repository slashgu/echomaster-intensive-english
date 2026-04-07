export interface User {
  uid: string;
  email: string | null;
  role: 'teacher' | 'student';
  teacherId?: string;
  inviteCode?: string;
}

export interface Lesson {
  id: string;
  title: string;
  authorId: string;
  createdAt: any;
  sentenceCount: number;
}

export interface Sentence {
  id: string;
  text: string;
  audioBase64: string;
  orderIndex: number;
}

export interface Progress {
  id?: string;
  userId: string;
  lessonId: string;
  mode: 'dictation' | 'gap-fill' | 'shadowing';
  score: number;
  completedAt: any;
}

export interface IAuthService {
  loginWithEmail(email: string, password: string): Promise<void>;
  registerWithEmail(email: string, password: string, role: 'teacher' | 'student'): Promise<void>;
  logout(): Promise<void>;
  onAuthStateChanged(callback: (user: User | null) => void): () => void;
  getCurrentUser(): User | null;
}

export interface IDatabaseService {
  ensureUserExists(user: User): Promise<User>;
  subscribeToLessons(authorId: string, callback: (lessons: Lesson[]) => void, onError: (error: Error) => void): () => void;
  createLesson(title: string, authorId: string, sentenceCount: number): Promise<string>;
  subscribeToSentences(lessonId: string, callback: (sentences: Sentence[]) => void, onError: (error: Error) => void): () => void;
  addSentenceToLesson(lessonId: string, sentence: Omit<Sentence, 'id'>): Promise<void>;
  
  // New methods for Teacher/Student roles
  subscribeToStudents(teacherId: string, callback: (students: User[]) => void, onError: (error: Error) => void): () => void;
  subscribeToProgress(userId: string, callback: (progress: Progress[]) => void, onError: (error: Error) => void): () => void;
  saveProgress(progress: Progress): Promise<void>;
  linkStudentToTeacher(studentId: string, inviteCode: string): Promise<void>;
}

export interface ILLMService {
  splitIntoSentences(text: string): Promise<string[]>;
  generateAudioForSentence(sentence: string): Promise<string | null>;
  explainWordOrPhrase(phrase: string, context: string): Promise<string>;
}
