import { Router } from 'express';
import { requireUser } from './middleware/auth.js';
import adminRoutes from './routes/admin.js';
import contentRoutes from './routes/content.js';
import mediaRoutes from './routes/media.js';
import tokenRoutes from './routes/tokens.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok', service: 't-world-module-service' }));

router.use(requireUser);
router.use(contentRoutes);
router.use(tokenRoutes);
router.use(mediaRoutes);
router.use(adminRoutes);

export default router;
