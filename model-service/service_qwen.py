import json
import os
import re
from pathlib import Path

import torch
import bentoml
from transformers import AutoModelForCausalLM, AutoTokenizer

# Path to the local model directory. Defaults to the merged full model under
# models/. Point QWEN_MODEL_DIR at a LoRA adapter folder to use the adapter flow.
MODEL_DIR = os.environ.get("QWEN_MODEL_DIR") or str(
    Path(__file__).resolve().parent / "models" / "qwen2_5_thoibao_classifier_lora_adapter"
)

if not os.path.exists(os.path.join(MODEL_DIR, "inference_config.json")):
    raise RuntimeError(
        f"Model not found at '{MODEL_DIR}'. Extract the trained model there "
        f"first, or set the QWEN_MODEL_DIR environment variable."
    )

# Labels, prompts and base model all ship with the model (inference_config.json)
# so inference stays in-distribution and auto-syncs whenever it is retrained.
with open(os.path.join(MODEL_DIR, "inference_config.json"), "r", encoding="utf-8") as f:
    INFER_CFG = json.load(f)

LABELS = INFER_CFG.get("labels", [
    "political_news",
    "mocking_criticism",
    "need_review",
    "political_opinion",
])
SYSTEM_PROMPT = INFER_CFG["system_prompt"]
BASE_MODEL = INFER_CFG.get("base_model", "Qwen/Qwen2.5-1.5B-Instruct")
USER_PROMPT_TEMPLATE = INFER_CFG["user_prompt_template"]

# A merged model ships full weights (config.json + model.safetensors) and loads
# directly; a LoRA adapter ships adapter_config.json and needs base model + peft.
IS_ADAPTER = os.path.exists(os.path.join(MODEL_DIR, "adapter_config.json"))


def _safe_parse_json(text):
    """A generative model can wrap its JSON in prose or markdown fences. Extract
    the first balanced object and parse it; fall back to a neutral verdict so a
    single malformed generation never breaks the rest of the batch."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    return {
        "label": "need_review",
        "explanation": "Không phân tích được JSON hợp lệ từ mô hình.",
        "raw_output": text[:500],
        "_parse_error": True,
    }


@bentoml.service(
    name="qwen_thoibao_classifier_service",
    # CPU generation of a batch can take minutes; lift the default 60s cap.
    traffic={"timeout": 600},
    resources={"gpu": 1} if torch.cuda.is_available() else None,
)
class QwenThoibaoClassifierService:
    def __init__(self) -> None:
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if self.device == "cuda" else torch.float32
        kind = "adapter" if IS_ADAPTER else "merged"
        print(f"Loading Qwen classifier ({kind}) from {MODEL_DIR} on {self.device}")

        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)

        if IS_ADAPTER:
            from peft import PeftModel

            base_model = AutoModelForCausalLM.from_pretrained(
                BASE_MODEL, torch_dtype=dtype, trust_remote_code=True
            )
            self.model = PeftModel.from_pretrained(base_model, MODEL_DIR).to(self.device)
        else:
            self.model = AutoModelForCausalLM.from_pretrained(
                MODEL_DIR, torch_dtype=dtype, trust_remote_code=True
            ).to(self.device)

        self.model.eval()

    def _classify_one(self, text: str) -> dict:
        if not text or not text.strip():
            return {
                "label": "need_review",
                "explanation": "Bài viết rỗng.",
            }

        user_content = USER_PROMPT_TEMPLATE.replace("{post}", text.strip())
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]
        inputs = self.tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            return_dict=True,
        ).to(self.device)
        prompt_len = inputs["input_ids"].shape[-1]

        with torch.no_grad():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=384,
                do_sample=False,
                pad_token_id=self.tokenizer.eos_token_id,
            )

        response = self.tokenizer.decode(
            output_ids[0][prompt_len:], skip_special_tokens=True
        )
        return _safe_parse_json(response)

    @bentoml.api
    def predict(self, texts: list[str]) -> list[dict]:
        # Generative inference does not batch like an encoder head; classify
        # one post at a time. Acceptable here since latency is not a concern.
        return [self._classify_one(t) for t in texts]
