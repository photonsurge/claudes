export HF_HOME=/home/rich/code/.huggingfacecache

# curl http://localhost:9090/v1/models



curl http://localhost:9090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"Qwen/Qwen2.5-3B-Instruct",
    "messages":[{"role":"user","content":"Reply with exactly: vLLM is alive"}],
    "temperature":0
  }'
curl http://localhost:9090/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"Qwen/Qwen2.5-3B-Instruct",
    "messages":[{"role":"user","content":"Reply with exactly: vLLM is alive"}],
    "temperature":0
  }'
