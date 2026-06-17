import os
import torch
import numpy as np
import bentoml
from pyvi import ViTokenizer
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# Define labels as per the training config
LABEL_COLS = [
    "ANTI_GOVERNMENT_REGIME",
    "INCITE_VIOLENCE_SOCIAL_DISORDER",
    "OFFICIAL_NEWS_CURRENT_EVENTS",
    "GENERAL_CONTENT"
]

# Get the model from BentoML store
try:
    bento_model = bentoml.models.get("phobert_reactionary_classifier:latest")
except Exception:
    raise RuntimeError("Model 'phobert_reactionary_classifier' not found in store. Please run import_model.py first.")

# Create the service directly, referencing the model in the models list.
@bentoml.service(
    name="phobert_reactionary_classifier_service",
    resources={"gpu": 1} if torch.cuda.is_available() else None,
)
class PhobertReactionaryClassifierService:
    def __init__(self) -> None:
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Loading PhoBERT model on device: {self.device}")

        # load model files from bento_model path
        model_path = bento_model.path
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForSequenceClassification.from_pretrained(model_path).to(self.device)
        self.model.eval()

    @bentoml.api
    def predict(self, texts: list[str]) -> list[dict]:
        # Perform pyvi word segmentation on each text
        segmented_texts = [ViTokenizer.tokenize(text.strip()) for text in texts]

        # Tokenize batch
        inputs = self.tokenizer(
            segmented_texts,
            padding=True,
            truncation=True,
            max_length=256,
            return_tensors="pt"
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            logits = outputs.logits
            # Apply sigmoid for multi-label classification probabilities
            probs = torch.sigmoid(logits).cpu().numpy()

        results = []
        for prob in probs:
            # Construct dictionary of label to probability
            prob_dict = {LABEL_COLS[i]: float(prob[i]) for i in range(len(LABEL_COLS))}
            results.append(prob_dict)
        return results
