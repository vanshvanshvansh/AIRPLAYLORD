// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDrhFLeYAuMW2_8kTjOwWrvoJtkWqBdlnY",
  authDomain: "airplay-210eb.firebaseapp.com",
  databaseURL: "https://airplay-210eb-default-rtdb.firebaseio.com",
  projectId: "airplay-210eb",
  storageBucket: "airplay-210eb.firebasestorage.app",
  messagingSenderId: "666332831791",
  appId: "1:666332831791:web:05e3262041497bfc6166da",
  measurementId: "G-E9RLGGT6ML"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);






let db = null;
let isFirebaseActive = false;

try {
  if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== "YOUR_API_KEY") {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    isFirebaseActive = true;
    console.log("Firebase Realtime Database initialized successfully.");
  } else {
    console.warn("Firebase config not populated or Firebase SDK not present. Operating in Local Multi-Tab / BroadcastChannel Fallback Mode.");
  }
} catch (e) {
  console.error("Firebase init error, using Local Fallback:", e);
}

window.AIRPLAY_CONFIG = {
  firebaseConfig,
  getDb: () => db,
  isFirebaseActive: () => isFirebaseActive,
  STUN_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
