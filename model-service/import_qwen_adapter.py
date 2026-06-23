import os
import shutil
import bentoml

# Import the fine-tuned LoRA adapter into the BentoML local model store.
# The Qwen base model is pulled from the Hugging Face hub at serving time, so
# only the small adapter files live in the store.

adapter_src = "./models/qwen2_5_thoibao_classifier_lora_adapter"

required = [
    "adapter_config.json",
    "adapter_model.safetensors",
    "inference_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
]
missing = [f for f in required if not os.path.exists(os.path.join(adapter_src, f))]
if missing:
    raise FileNotFoundError(
        f"Adapter files missing at '{adapter_src}': {missing}. "
        "Extract the trained LoRA adapter into that folder first."
    )

print("Importing LoRA adapter into BentoML local model store...")
with bentoml.models.create(
    "qwen_thoibao_classifier_lora",
    metadata={
        "base_model": "Qwen/Qwen2.5-1.5B-Instruct",
        "adapter_type": "peft_lora",
        "task": "vn_thoibao_political_content_classification",
        "labels": [
            "political_news",
            "mocking_criticism",
            "need_review",
            "political_opinion",
        ],
    },
) as bento_model:
    for item in os.listdir(adapter_src):
        src = os.path.join(adapter_src, item)
        dst = os.path.join(bento_model.path, item)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    print(f"Adapter imported successfully with tag: {bento_model.tag}")
