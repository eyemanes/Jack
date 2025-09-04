require('dotenv').config();
const { initializeApp } = require('firebase/app');
const { getDatabase } = require('firebase/database');

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyApDZ9K_JlMVZGU5b1IOuQk66o-cdQQDjg",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "jacky-b501a.firebaseapp.com",
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://jacky-b501a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: process.env.FIREBASE_PROJECT_ID || "jacky-b501a",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "jacky-b501a.firebasestorage.app",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "1001742501163",
  appId: process.env.FIREBASE_APP_ID || "1:1001742501163:web:0f581c059d7ce1881f716e",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-BBC5VMY73J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Realtime Database and get a reference to the service
const database = getDatabase(app);

module.exports = { database };
