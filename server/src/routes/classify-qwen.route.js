import express from 'express';
import { classifyTextsQwen } from '../controllers/classify-qwen.controller.js';

const router = express.Router();

router.post('/', classifyTextsQwen);

export default router;
