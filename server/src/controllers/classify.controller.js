import axios from 'axios';

/**
 * @desc    Classify an array of texts using the model service
 * @route   POST /api/v1/classify
 * @access  Public
 */
export const classifyTexts = async (req, res, next) => {
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

    // Ensure all elements in the array are strings
    if (texts.some(t => typeof t !== 'string')) {
      return res.status(400).json({
        success: false,
        message: 'All elements in the texts array must be strings'
      });
    }

    const modelServiceUrl = process.env.MODEL_SERVICE_URL || 'http://localhost:3000';

    // Call the BentoML /predict endpoint
    const response = await axios.post(`${modelServiceUrl}/predict`, {
      texts: texts
    });

    // Map predictions to REACTIONARY or NORMAL based on label probabilities
    const processedPredictions = response.data.map(prediction => {
      const antiGovProb = prediction.ANTI_GOVERNMENT_REGIME || 0;
      const inciteViolenceProb = prediction.INCITE_VIOLENCE_SOCIAL_DISORDER || 0;
      
      const isReactionary = antiGovProb > 0.5 || inciteViolenceProb > 0.5;
      
      return {
        classification: isReactionary ? 'REACTIONARY' : 'NORMAL',
        probabilities: prediction
      };
    });

    res.status(200).json({
      success: true,
      data: processedPredictions
    });
  } catch (error) {
    // If the model-service returned an error response
    if (error.response) {
      res.status(error.response.status || 500);
      return next(new Error(`Model Service Error: ${error.response.statusText || error.message}`));
    }
    next(error);
  }
};
