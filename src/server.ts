import 'dotenv/config';
import express from 'express';
import catalogRoutes from './routes/catalogRoutes';
import listingRoutes from './routes/listingRoutes';
import searchRoutes from './search/routes/searchRoutes';
import authRoutes from './routes/authRoutes';
import meRoutes from './routes/meRoutes';
import { errorHandler } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { authPlaceholder } from './middleware/auth';
import path from 'path';

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(requestIdMiddleware);
app.use(authPlaceholder);

app.use((req, _res, next) => {
  console.log(`[${req.headers['x-request-id']}] ${req.method} ${req.path}`);
  next();
});

const publicDir = path.join(process.cwd(), 'public');

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.redirect('/search');
});

app.get(['/search', '/search/', '/search.html'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'search.html'));
});

app.use(express.static(publicDir));
app.use('/app', express.static(publicDir));

app.use('/api/auth', authRoutes);
app.use('/api', meRoutes);
app.use('/catalog', catalogRoutes);
app.use('/', listingRoutes);
app.use('/search', searchRoutes);

app.use(errorHandler);

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(port, () => {
  console.log(`API listening on ${port}`);
});
