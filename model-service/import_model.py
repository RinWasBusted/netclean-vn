import os
import bentoml

# Service to import model and tokenizer into BentoML store

# 1. Check if model files exist locally in 'models/phobert-reactionary-classifier'
model_path = "./models/phobert-reactionary-classifier"
if not os.path.exists(model_path) or not os.path.exists(os.path.join(model_path, "model.safetensors")):
    raise FileNotFoundError(f"Model files not found at local path '{model_path}'. Make sure training has finished and saved the model here.")

from transformers import AutoTokenizer, AutoModelForSequenceClassification

print("Loading tokenizer and model from local path...")
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForSequenceClassification.from_pretrained(model_path)

print("Importing model and tokenizer to BentoML local model store...")
with bentoml.models.create(
    "phobert_reactionary_classifier",
    metadata={
        "model_name": "vinai/phobert-base-v2",
        "description": "Multi-label text classifier for anti-government, inciting violence, official news, and general content based on PhoBERT",
    },
    signatures={"predict": {"batchable": True, "batch_dim": 0}}
) as bento_model:
    bento_model_path = bento_model.path
    tokenizer.save_pretrained(bento_model_path)
    model.save_pretrained(bento_model_path)
    print(f"Model saved to BentoML model store successfully with tag: {bento_model.tag}")
