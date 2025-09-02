// Firebase configuration for backend
const { initializeApp } = require('firebase/app');
const { getDatabase } = require('firebase/database');

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyApDZ9K_JlMVZGU5b1IOuQk66o-cdQQDjg",
  authDomain: "jacky-b501a.firebaseapp.com",
  databaseURL: "https://jacky-b501a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jacky-b501a",
  storageBucket: "jacky-b501a.firebasestorage.app",
  messagingSenderId: "1001742501163",
  appId: "1:1001742501163:web:0f581c059d7ce1881f716e",
  measurementId: "G-BBC5VMY73J"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

module.exports = { app, database };
