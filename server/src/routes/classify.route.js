import express from 'express';
import { classifyTexts } from '../controllers/classify.controller.js';

const router = express.Router();

router.post('/', classifyTexts);

export default router;
