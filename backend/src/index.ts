import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import routes from './routes';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------
app.use(helmet());
app.use(cors({
  origin: process.env.DASHBOARD_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));

// Rate limit tracking endpoints (protect against bot floods)
const trackLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  message: 'Too many requests',
});
app.use('/track', trackLimiter);
app.use('/postback', trackLimiter);

// Rate limit API endpoints
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
});
app.use('/api', apiLimiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------
app.use('/', routes);

// ---------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Affiliate Tracking Server running on port ${PORT}`);
  console.log(`Postback URL: http://yourserver.com/postback?click_id={CLICK_ID}&txn={TXN_ID}&payout={PAYOUT}`);
});

export default app;
