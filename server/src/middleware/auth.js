import admin from 'firebase-admin';
import { config } from '../config.js';
import { User } from '../models.js';

const demoUsers = {
  admin: { email: 'admin@tworld.local', role: 'admin' },
  user: { email: 'learner@tworld.local', role: 'user' },
};

function getFirebaseApp() {
  if (admin.apps.length) return admin.app();
  const { firebaseProjectId, firebaseClientEmail, firebasePrivateKey } = config;
  if (!firebaseProjectId || !firebaseClientEmail || !firebasePrivateKey) return null;
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: firebaseProjectId,
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey.replace(/\\n/g, '\n'),
    }),
  });
}

export async function requireUser(req, res, next) {
  try {
    const authorization = req.get('authorization');
    if (authorization?.startsWith('Bearer ')) {
      const app = getFirebaseApp();
      if (!app) return res.status(503).json({ error: 'Firebase authentication is not configured' });
      const claims = await app.auth().verifyIdToken(authorization.slice(7));
      if (!claims.uid || !claims.email) return res.status(401).json({ error: 'A verified email is required' });
      let user = await User.findOne({ firebaseUid: claims.uid });
      if (!user) {
        user = await User.findOne({ email: claims.email.toLowerCase() });
        if (user && !user.firebaseUid) {
          user.firebaseUid = claims.uid;
          await user.save();
        }
      }
      if (!user) user = await User.create({ firebaseUid: claims.uid, email: claims.email });
      req.user = user;
      return next();
    }

    const isLocalDevelopment = config.nodeEnv !== 'production' && config.devAuthEnabled;
    if (isLocalDevelopment) {
      const requestedRole = req.get('x-demo-role') === 'admin' ? 'admin' : 'user';
      const identity = demoUsers[requestedRole];
      let user = await User.findOne({ email: identity.email });
      if (!user) user = await User.create(identity);
      req.user = user;
      return next();
    }
    return res.status(401).json({ error: 'Sign in with a Firebase ID token' });
  } catch (error) {
    console.warn('Authentication rejected:', error.message);
    return res.status(401).json({ error: 'Your session is invalid or expired' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access is required' });
  next();
}
