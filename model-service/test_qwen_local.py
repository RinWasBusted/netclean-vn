"""Quick local smoke test for the merged Qwen classifier (no server needed).

Run:  .venv/Scripts/python.exe test_qwen_local.py
"""
import json
import re
import sys
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# Windows console defaults to cp1252 and chokes on Vietnamese output
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

MODEL_DIR = Path(__file__).resolve().parent / "models" / "qwen2_5_thoibao_classifier_lora_adapter"

cfg = json.load(open(MODEL_DIR / "inference_config.json", encoding="utf-8"))
SYSTEM_PROMPT = cfg["system_prompt"]
USER_TEMPLATE = cfg["user_prompt_template"]
BASE_MODEL = cfg.get("base_model", "Qwen/Qwen2.5-1.5B-Instruct")
IS_ADAPTER = (MODEL_DIR / "adapter_config.json").exists()
print("Labels:", cfg["labels"], "| adapter:", IS_ADAPTER)

tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), trust_remote_code=True)
if IS_ADAPTER:
    from peft import PeftModel

    print(f"Loading base {BASE_MODEL} (~3GB, tải từ HuggingFace lần đầu) + adapter...")
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, torch_dtype=torch.float32, trust_remote_code=True
    )
    model = PeftModel.from_pretrained(base, str(MODEL_DIR))
else:
    print("Loading merged model (CPU)...")
    model = AutoModelForCausalLM.from_pretrained(
        str(MODEL_DIR), torch_dtype=torch.float32, trust_remote_code=True
    )
model.eval()


def classify(text):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": USER_TEMPLATE.replace("{post}", text.strip())},
    ]
    inputs = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True,
        return_tensors="pt", return_dict=True,
    )
    prompt_len = inputs["input_ids"].shape[-1]
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=384,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    resp = tokenizer.decode(output_ids[0][prompt_len:], skip_special_tokens=True).strip()
    try:
        return json.loads(resp)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", resp, re.DOTALL)
        return json.loads(m.group(0)) if m else {"raw_output": resp}


tests = [
    "Lũ cộng sản khốn nạn",
    "Thủ tướng tiếp đoàn doanh nghiệp Nhật Bản sáng nay tại Hà Nội.",
    "Theo tôi, nên công khai lịch trình và tài liệu để người dân giám sát minh bạch hơn.",
    "Quán phở mới mở đầu ngõ ăn ngon mà giá lại rẻ.",
]

for t in tests:
    r = classify(t)
    print("\nPOST:", t)
    print("=>", json.dumps(r, ensure_ascii=False))
