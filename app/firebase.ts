import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCFltPP-g1yKSY9YXMB9CrUm86jzuOeb_w",
  authDomain: "post-office-ecr.firebaseapp.com",
  projectId: "post-office-ecr",
  storageBucket: "post-office-ecr.firebasestorage.app",
  messagingSenderId: "571296585764",
  appId: "1:571296585764:web:326cbc1155d5c8e4ef60b1",
  measurementId: "G-J0T6WSMM37"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;