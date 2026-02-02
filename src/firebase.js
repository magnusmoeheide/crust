import { initializeApp } from 'firebase/app'
import { getAnalytics, isSupported } from 'firebase/analytics'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: 'AIzaSyCmu5CKyrzYfdF0V5GfZck6IB-uTwT8QOA',
  authDomain: 'crust-11575.firebaseapp.com',
  projectId: 'crust-11575',
  storageBucket: 'crust-11575.firebasestorage.app',
  messagingSenderId: '1045646519412',
  appId: '1:1045646519412:web:adbb415271d47a2d563521',
  measurementId: 'G-GXQGM47CX2',
}

const app = initializeApp(firebaseConfig)

// Analytics is optional and only works in supported browser contexts.
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      getAnalytics(app)
    }
  })
}

export const db = getFirestore(app)
export const storage = getStorage(app)
export const auth = getAuth(app)
