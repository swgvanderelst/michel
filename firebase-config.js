// Firebase web config (public by design; security comes from database.rules.json).
// store.js uses the local dev server on localhost / 127.0.0.1 / ?dev=1, and Firebase everywhere else (or with ?prod=1).
export const firebaseConfig = {
  apiKey: 'AIzaSyCgaiA-meTRN0iog8DxZySrdA3in0BOljg',
  authDomain: 'michel-a29e3.firebaseapp.com',
  databaseURL: 'https://michel-a29e3-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'michel-a29e3',
  storageBucket: 'michel-a29e3.firebasestorage.app',
  messagingSenderId: '73824147224',
  appId: '1:73824147224:web:8803d4c5276d178767706d',
};
