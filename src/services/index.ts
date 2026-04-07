import { firebaseAuthService, firebaseDbService } from './firebaseService';
import { geminiLLMService } from './geminiService';

// Export the active implementations. 
// To switch to a Chinese provider later (e.g., WeChat Auth, Tencent Cloud, DeepSeek LLM), 
// you would just change these exports to point to your new service implementations.

export const authService = firebaseAuthService;
export const dbService = firebaseDbService;
export const llmService = geminiLLMService;
