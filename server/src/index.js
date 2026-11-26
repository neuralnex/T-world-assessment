import { config } from './config.js';
import { connectDatabase } from './db.js';
import app from './app.js';

try {
  await connectDatabase(config.mongoUri);
  app.listen(config.port, () => console.info(`API listening on http://localhost:${config.port}`));
} catch (error) {
  console.error('Could not start the API:', error.message);
  process.exitCode = 1;
}
