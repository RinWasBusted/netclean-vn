import express from 'express';
import postsRouter from './posts.route.js';
import classifyRouter from './classify.route.js';
import classifyQwenRouter from './classify-qwen.route.js';

const router = express.Router();

// Mount resources
router.use('/posts', postsRouter);
router.use('/classify', classifyRouter);
router.use('/classify-qwen', classifyQwenRouter);

export default router;
