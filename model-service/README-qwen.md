# Qwen LoRA classifier service (bổ sung, song song với PhoBERT)

Service phân loại nội dung chính trị tiếng Việt bằng **Qwen2.5-1.5B-Instruct + LoRA adapter**
(sinh JSON: `label`, `explanation`). Taxonomy 4 nhãn: `political_news`, `mocking_criticism`,
`need_review`, `political_opinion`. Labels + prompt được đọc động từ `inference_config.json`
trong adapter, nên đổi taxonomy chỉ cần thay adapter, không sửa code.
Chạy **độc lập** với service PhoBERT cũ — không thay thế.

| | PhoBERT (cũ) | Qwen LoRA (mới) |
|---|---|---|
| File service | `service.py` | `service_qwen.py` |
| Import model | `import_model.py` | `import_qwen_adapter.py` |
| Bentofile | `bentofile.yaml` | `bentofile.qwen.yaml` |
| Deps | `requirements.txt` | `requirements-qwen.txt` |
| Port (gợi ý) | 3000 | 3001 |
| API qua server | `POST /api/v1/classify` | `POST /api/v1/classify-qwen` |

## Chạy Qwen service

```bash
cd model-service

# 1. Adapter phải nằm ở models/qwen2_5_thoibao_classifier_lora_adapter/
#    (nếu chưa có, giải nén từ file adapter đã train):
#    unzip <duong-dan>/.zip -d models/

# 2. Cài deps (nên dùng virtualenv riêng)
pip install -r requirements-qwen.txt

# 3. Serve. Service tự load thẳng từ models/qwen2_5_thoibao_classifier_lora_adapter
#    (tự nhận diện adapter → tải base Qwen ~3GB từ HF lần đầu; hoặc merged → load thẳng).
#    Dùng port 3002 nếu 3001 đang bận.
bentoml serve service_qwen:QwenThoibaoClassifierService --port 3002 --working-dir .
```

> `import_qwen_adapter.py` (nạp vào BentoML store) là tùy chọn — service hiện load
> trực tiếp từ thư mục `models/`, hoặc đặt `QWEN_MODEL_DIR` để trỏ model khác.

## Test nhanh

Tiếng Việt phải gửi qua file UTF-8 (`--data-binary @file`), KHÔNG nhúng trực tiếp `-d '...'`
trên Windows (sẽ lỗi `Invalid JSON unicode`):

```bash
# Tạo file payload (UTF-8)
echo '{"texts":["Lũ cộng sản khốn nạn","Quán phở mới mở ăn ngon giá rẻ"]}' > payload.json

# Gọi thẳng model service
curl -X POST http://localhost:3002/predict \
  -H "Content-Type: application/json" --data-binary @payload.json

# Hoặc qua Node server (set MODEL_SERVICE_QWEN_URL=http://localhost:3002 nếu khác mặc định)
curl -X POST http://localhost:5000/api/v1/classify-qwen \
  -H "Content-Type: application/json" --data-binary @payload.json
```

Server map sang `REACTIONARY` khi `label === 'mocking_criticism'` (nhãn thù địch duy nhất
trong taxonomy mới; `direct_abuse` được giữ để tương thích adapter cũ).
Cấu hình URL trong server bằng biến môi trường `MODEL_SERVICE_QWEN_URL` (mặc định `http://localhost:3001`).

> Lưu ý CPU: mỗi câu sinh tới 384 token nên rất chậm (~5 câu ≈ 4–5 phút). Service đã đặt
> `traffic={"timeout": 600}` để request batch không bị cắt ở mốc 60s mặc định. Muốn nhanh cần GPU.
