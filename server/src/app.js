import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import routes from './routes.js';
import { errorHandler, notFound, requestLogger } from './middleware/errors.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.webOrigin, credentials: false }));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

export default app;
