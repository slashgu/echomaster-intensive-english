import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, doc, setDoc, getDoc, serverTimestamp, where, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { IAuthService, IDatabaseService, User, Lesson, Sentence, Progress } from './types';

export const firebaseAuthService: IAuthService = {
  async loginWithEmail(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
  },
  async registerWithEmail(email, password, role) {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const inviteCode = role === 'teacher' ? Math.random().toString(36).substring(2, 8).toUpperCase() : null;
    await setDoc(doc(db, 'users', userCred.user.uid), {
      uid: userCred.user.uid,
      email,
      role,
      streak: 0,
      lastActive: serverTimestamp(),
      ...(inviteCode ? { inviteCode } : {})
    });
  },
  async logout() {
    await signOut(auth);
  },
  onAuthStateChanged(callback) {
    return onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', authUser.uid));
          let role: 'teacher' | 'student' = authUser.email === 'guchengslash@gmail.com' ? 'teacher' : 'student';
          let teacherId = undefined;
          let inviteCode = undefined;
          
          if (userDoc.exists()) {
            const data = userDoc.data();
            role = data.role as 'teacher' | 'student';
            teacherId = data.teacherId;
            inviteCode = data.inviteCode;
          }
          
          callback({ uid: authUser.uid, email: authUser.email, role, teacherId, inviteCode, streak: 0, lastActive: new Date() });
        } catch (error) {
          console.error("Error fetching user role:", error);
          callback({ uid: authUser.uid, email: authUser.email, role: 'student', streak: 0, lastActive: new Date() });
        }
      } else {
        callback(null);
      }
    });
  },
  getCurrentUser() {
    const user = auth.currentUser;
    return user ? { 
      uid: user.uid, 
      email: user.email, 
      role: user.email === 'guchengslash@gmail.com' ? 'teacher' : 'student',
      streak: 0,
      lastActive: new Date()
    } : null;
  }
};

export const firebaseDbService: IDatabaseService = {
  async ensureUserExists(user) {
    const userRef = doc(db, 'users', user.uid);
    let snap;
    try {
      snap = await getDoc(userRef);
    } catch (e) {
      console.error("ensureUserExists getDoc failed:", e);
      throw e;
    }
    let inviteCode = user.inviteCode;

    if (!snap.exists()) {
      inviteCode = user.role === 'teacher' ? Math.random().toString(36).substring(2, 8).toUpperCase() : undefined;
      try {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email || "no-email@example.com",
          role: user.role,
          streak: 0,
          lastActive: serverTimestamp(),
          ...(inviteCode ? { inviteCode } : {})
        });
      } catch (e) {
        console.error("ensureUserExists setDoc (create) failed:", e);
        throw e;
      }
    } else {
      const data = snap.data();
      inviteCode = data?.inviteCode;
      if (user.role === 'teacher' && !inviteCode) {
        inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      }

      const updateData = { 
        uid: user.uid,
        email: user.email || data?.email || "no-email@example.com",
        role: user.email === 'guchengslash@gmail.com' ? 'teacher' : (data?.role || user.role),
        streak: data?.streak ?? 0,
        lastActive: serverTimestamp(),
        ...(inviteCode ? { inviteCode } : {})
      };
      console.log("ensureUserExists updating user with:", updateData);

      try {
        await setDoc(userRef, updateData, { merge: true });
      } catch (e) {
        console.error("ensureUserExists setDoc (update) failed:", e);
        throw e;
      }
    }
    
    return { ...user, inviteCode };
  },
  subscribeToLessons(authorId, callback, onError) {
    if (!authorId) {
      callback([]);
      return () => {};
    }
    const q = query(collection(db, 'lessons'), where('authorId', '==', authorId), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const lessons = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Lesson[];
      callback(lessons);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'lessons');
      } catch(e: any) {
        onError(e);
      }
    });
  },
  async createLesson(title, authorId, sentenceCount) {
    const lessonRef = doc(collection(db, 'lessons'));
    await setDoc(lessonRef, {
      title,
      authorId,
      createdAt: serverTimestamp(),
      sentenceCount
    });
    return lessonRef.id;
  },
  async deleteLesson(lessonId) {
    await deleteDoc(doc(db, 'lessons', lessonId));
  },
  subscribeToSentences(lessonId, callback, onError) {
    const q = query(collection(db, `lessons/${lessonId}/sentences`), orderBy('orderIndex', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const sentences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Sentence[];
      callback(sentences);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, `lessons/${lessonId}/sentences`);
      } catch(e: any) {
        onError(e);
      }
    });
  },
  async addSentenceToLesson(lessonId, sentence) {
    const sentenceRef = doc(collection(db, `lessons/${lessonId}/sentences`));
    await setDoc(sentenceRef, sentence);
  },
  async updateSentenceGaps(lessonId, sentenceId, gapIndexes) {
    const sentenceRef = doc(db, `lessons/${lessonId}/sentences`, sentenceId);
    await updateDoc(sentenceRef, { gapIndexes });
  },
  subscribeToStudents(teacherId, callback, onError) {
    const q = query(collection(db, 'users'), where('role', '==', 'student'), where('teacherId', '==', teacherId));
    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map(doc => doc.data() as User));
    }, onError);
  },
  subscribeToProgress(userId, callback, onError) {
    const q = query(collection(db, 'progress'), where('userId', '==', userId), orderBy('completedAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Progress));
    }, onError);
  },
  async saveProgress(progress) {
    await addDoc(collection(db, 'progress'), {
      ...progress,
      completedAt: serverTimestamp()
    });
  },
  async linkStudentToTeacher(studentId, inviteCode) {
    // Find teacher by invite code
    const q = query(collection(db, 'users'), where('role', '==', 'teacher'), where('inviteCode', '==', inviteCode));
    const snap = await getDoc(doc(db, 'users', studentId)); // Just to use getDocs for query
    const { getDocs } = await import('firebase/firestore');
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      throw new Error("Invalid invite code");
    }
    
    const teacherDoc = querySnapshot.docs[0];
    const teacherId = teacherDoc.data().uid;
    
    // Update student
    await setDoc(doc(db, 'users', studentId), { teacherId }, { merge: true });
  }
};
