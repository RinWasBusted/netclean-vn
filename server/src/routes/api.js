import express from 'express';
import postsRouter from './posts.route.js';

const router = express.Router();

// Mount resources
router.use('/posts', postsRouter);

export default router;
