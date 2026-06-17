import express from 'express';
import postsRouter from './posts.route.js';
import classifyRouter from './classify.route.js';

const router = express.Router();

// Mount resources
router.use('/posts', postsRouter);
router.use('/classify', classifyRouter);

export default router;
