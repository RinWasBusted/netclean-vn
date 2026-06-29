# NetClean-VN — Hướng dẫn cài đặt & chạy local

Lọc nội dung "phản động" trên Threads bằng AI. Gồm 3 thành phần chạy độc lập:

```
Chrome Extension ──WebSocket──> Node server (:5000) ──HTTP──> Model service ──> kết quả
   (client/)                        (server/)                  (model-service/)
                                                         Qwen LoRA (:3002)  ← mặc định
                                                         PhoBERT  (:3000)   ← tuỳ chọn
```

Luồng: extension scrape post trên Threads → gửi qua WebSocket tới Node → Node gọi model service → trả `REACTIONARY/NORMAL` → extension ẩn post bị gắn cờ.

---

## 1. Yêu cầu môi trường

| Phần mềm | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | ≥ 18 | cho `server/` |
| Python | ≥ 3.10 (đã test 3.12) | cho `model-service/` |
| Google Chrome | mới | để load extension |
| RAM trống | ~8GB | chạy Qwen trên CPU |
| Ổ đĩa | ~4GB | base Qwen ~3GB (tự tải) + adapter |
| GPU NVIDIA + CUDA | (tuỳ chọn) | nhanh hơn nhiều; không có thì chạy CPU |

---

## 2. ⚠️ File model (BẮT BUỘC phải có)

Thư mục model **không nằm trong git** (quá nặng). Trước khi chạy, đảm bảo có:

```
model-service/models/qwen2_5_thoibao_classifier_lora_adapter/
├── adapter_model.safetensors   (~73MB)   ← trọng số LoRA đã train
├── adapter_config.json
├── inference_config.json                  ← labels + prompt (4 nhãn)
├── tokenizer.json, tokenizer_config.json, chat_template.jinja
```

Nếu thiếu thư mục này → **xin người gửi** (hoặc giải nén từ file zip adapter vào đúng đường dẫn trên).
Base model `Qwen/Qwen2.5-1.5B-Instruct` (~3GB) **tự tải** từ Hugging Face ở lần chạy đầu, không cần chuẩn bị.

---

## 3. Chạy Model service (Qwen)

```bash
cd model-service
python -m venv .venv

# Kích hoạt venv:
#   Windows:        .venv\Scripts\activate
#   macOS/Linux:    source .venv/bin/activate

pip install -r requirements-qwen.txt

# Serve (LẦN ĐẦU sẽ tải base Qwen ~3GB từ HuggingFace — chờ vài phút):
bentoml serve service_qwen:QwenThoibaoClassifierService --port 3002 --working-dir .
```

Kiểm tra: mở `http://localhost:3002/readyz` → trả `200` là sẵn sàng.

> Test model nhanh không cần server: `python test_qwen_local.py`

---

## 4. Chạy Node server

```bash
cd server
npm install

# Tạo file .env (copy từ .env.example rồi sửa nếu cần):
#   Windows:  copy .env.example .env
#   macOS/Linux:  cp .env.example .env

npm start
```

Kiểm tra: mở `http://localhost:5000` → trả `{"status":"healthy"}`.

Nội dung `.env` (đã trỏ sẵn sang Qwen):
```
CLASSIFIER=qwen
MODEL_SERVICE_QWEN_URL=http://localhost:3002
PORT=5000
NODE_ENV=development
```

---

## 5. Load Extension vào Chrome

1. Mở `chrome://extensions/` → bật **Developer mode** (góc trên phải).
2. Bấm **Load unpacked** → chọn thư mục `client/`.
3. Mở **https://www.threads.com** (hoặc threads.net).
4. Bấm icon extension → bật **Auto Clean** + **Hide Reactionary Posts**.
5. **Cuộn chậm** → post được phân loại → post `mocking_criticism` sẽ bị ẩn; popup hiện trạng thái từng post.

---

## 6. Thứ tự khởi động & kiểm tra nhanh

Chạy theo thứ tự: **(1) model-service → (2) Node server → (3) extension**.

Test nhanh toàn chuỗi (không cần extension):
```bash
echo '{"texts":["Lũ cộng sản khốn nạn","Quán phở mới mở ăn ngon giá rẻ"]}' > p.json
curl -X POST http://localhost:5000/api/v1/classify-qwen \
  -H "Content-Type: application/json" --data-binary @p.json
```
Kỳ vọng: câu 1 → `REACTIONARY (mocking_criticism)`, câu 2 → `NORMAL (need_review)`.

> Tiếng Việt phải gửi qua file (`--data-binary @p.json`), KHÔNG nhúng `-d '...'` trên Windows (lỗi unicode).

---

## 7. Lưu ý

- **CPU rất chậm**: mỗi câu sinh ~30–60s. Cuộn ít post một lúc, kiên nhẫn. Có GPU thì nhanh hơn nhiều.
- 4 nhãn: `political_news`, `mocking_criticism`, `need_review`, `political_opinion`.
  Chỉ `mocking_criticism` → `REACTIONARY` (post bị ẩn); còn lại → `NORMAL`.
- **Dùng PhoBERT thay vì Qwen** (tuỳ chọn): bỏ dòng `CLASSIFIER=qwen` trong `.env`, rồi serve PhoBERT
  (cần file model PhoBERT ở `model-service/models/phobert-reactionary-classifier/`, chạy `python import_model.py`
  rồi `bentoml serve service:PhobertReactionaryClassifierService --port 3000`). Xem thêm `model-service/README-qwen.md`.

---

## 8. Đóng gói gửi đi

Khi nén thư mục gửi cho người khác, **GIỮ** `model-service/models/` (file adapter), nhưng **XOÁ** các thư mục tự sinh để nhẹ (người nhận tự cài lại):

```
model-service/.venv/          ← xoá
server/node_modules/          ← xoá
**/__pycache__/               ← xoá
```
