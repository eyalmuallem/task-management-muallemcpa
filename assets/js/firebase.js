import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
    getAuth,
    createUserWithEmailAndPassword,
    signOut as firebaseSignOut,
    setPersistence,
    inMemoryPersistence
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

export const firebaseConfig = {
    apiKey: 'AIzaSyDOpsv-fuEN79loRfc6nZZAXxXBiQe4lzY',
    authDomain: 'moalem-tasks.firebaseapp.com',
    projectId: 'moalem-tasks',
    storageBucket: 'moalem-tasks.firebasestorage.app',
    messagingSenderId: '253795755183',
    appId: '1:253795755183:web:2df7102d41ccffa0aaa05a',
    measurementId: 'G-39RBM8LM10'
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const employeeCreatorApp = initializeApp(firebaseConfig, 'employee-creator');
const employeeCreatorAuth = getAuth(employeeCreatorApp);
const employeeCreatorReady = setPersistence(employeeCreatorAuth, inMemoryPersistence).catch((error) => {
    console.warn('Could not set in-memory persistence for secondary auth:', error);
});

export async function createEmployeeAuthAccount(email, password) {
    await employeeCreatorReady;
    const credential = await createUserWithEmailAndPassword(employeeCreatorAuth, email, password);
    await firebaseSignOut(employeeCreatorAuth);
    return credential.user;
}
