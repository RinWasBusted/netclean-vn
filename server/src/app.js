import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import apiRouter from './routes/api.js';
import { errorHandler, notFound } from './middlewares/error.middleware.js';

const app = express();

// Security HTTP headers
app.use(helmet());

// Enable CORS
app.use(cors());

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Mount API routes
app.use('/api/v1', apiRouter);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to netclean-vn backend API',
    status: 'healthy'
  });
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

export default app;
