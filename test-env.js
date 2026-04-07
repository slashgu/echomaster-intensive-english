import { loadEnv } from 'vite';
process.env.GEMINI_API_KEY = 'TEST_KEY';
const env = loadEnv('production', '.', '');
console.log('Result:', env.GEMINI_API_KEY);
