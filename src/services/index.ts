import { firebaseAuthService, firebaseDbService } from './firebaseService';
import { apiAuthService } from './apiAuthService';
import { apiDbService } from './apiDbService';
import { geminiLLMService } from './geminiService';

// When VITE_USE_API_BACKEND is 'true', all Firebase calls go through
// Vercel serverless functions (/api/auth/*, /api/db/*) instead of the
// client-side Firebase SDK. This allows the app to work behind the
// Great Firewall since the browser never contacts Google domains directly.
//
// The Gemini LLM service already goes through /api/gemini/* regardless.

const USE_API = (import.meta as any).env?.VITE_USE_API_BACKEND === 'true';

export const authService = USE_API ? apiAuthService : firebaseAuthService;
export const dbService = USE_API ? apiDbService : firebaseDbService;
export const llmService = geminiLLMService;
