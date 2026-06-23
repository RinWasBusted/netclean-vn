import axios from 'axios';

/**
 * Helper to classify texts using the Qwen LoRA model service (generative).
 * Runs as a separate BentoML service, by default on port 3001.
 */
export const performClassificationQwen = async (texts) => {
  if (!texts || !Array.isArray(texts) || texts.length === 0) {
    return [];
  }
  const modelServiceUrl = process.env.MODEL_SERVICE_QWEN_URL || 'http://localhost:3001';

  // Call the Qwen BentoML /predict endpoint
  const response = await axios.post(`${modelServiceUrl}/predict`, {
    texts: texts
  });

  // The Qwen classifier returns { label, explanation } per post. The only
  // hostile label in the taxonomy is 'mocking_criticism' — it absorbs sarcasm,
  // criticism and direct abuse of the Party/State — so it maps to REACTIONARY.
  // 'direct_abuse' is kept for backward compatibility with older adapters.
  const REACTIONARY_LABELS = ['mocking_criticism', 'direct_abuse'];

  return response.data.map(prediction => {
    const isReactionary = REACTIONARY_LABELS.includes(prediction.label);

    return {
      classification: isReactionary ? 'REACTIONARY' : 'NORMAL',
      label: prediction.label,
      explanation: prediction.explanation
    };
  });
};

/**
 * @desc    Classify an array of texts using the Qwen LoRA model service
 * @route   POST /api/v1/classify-qwen
 * @access  Public
 */
export const classifyTextsQwen = async (req, res, next) => {
  try {
    const { texts } = req.body;

    if (!texts || !Array.isArray(texts)) {
      return res.status(400).json({
        success: false,
        message: 'texts must be an array of strings'
      });
    }

    if (texts.length === 0) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    if (texts.some(t => typeof t !== 'string')) {
      return res.status(400).json({
        success: false,
        message: 'All elements in the texts array must be strings'
      });
    }

    const processedPredictions = await performClassificationQwen(texts);

    res.status(200).json({
      success: true,
      data: processedPredictions
    });
  } catch (error) {
    if (error.response) {
      res.status(error.response.status || 500);
      return next(new Error(`Qwen Model Service Error: ${error.response.statusText || error.message}`));
    }
    next(error);
  }
};
