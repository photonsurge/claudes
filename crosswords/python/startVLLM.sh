#!/usr/bin/env bash
set -euo pipefail

export HF_HOME=/home/rich/code/thronix/crossword/HF-HUB

TOKEN_FILE="${HOME}/.config/hf/token"
if [[ -z "${HUGGINGFACE_HUB_TOKEN:-}" && -f "${TOKEN_FILE}" ]]; then
  export HUGGINGFACE_HUB_TOKEN="$(<"${TOKEN_FILE}")"
fi

if [[ -z "${HUGGINGFACE_HUB_TOKEN:-}" ]]; then
  echo "warning: no Hugging Face token found at ${TOKEN_FILE}; private/gated models may fail"
fi

# python - <<'PY'
# import sys
# from importlib.metadata import PackageNotFoundError, version
# from packaging.version import Version
# import torch

# try:
#     vllm_ver = Version(version("vllm"))
#     transformers_ver = Version(version("transformers"))
#     hub_ver = Version(version("huggingface_hub"))
#     numpy_ver = Version(version("numpy"))
#     numba_ver = Version(version("numba"))
# except PackageNotFoundError as exc:
#     print(f"error: missing package in current python environment: {exc.name}")
#     print(f"python executable: {sys.executable}")
#     print("fix: activate your llm env first (example: conda activate llm)")
#     sys.exit(2)

# print(f"vllm={vllm_ver}, transformers={transformers_ver}, huggingface_hub={hub_ver}")
# print(f"numpy={numpy_ver}, numba={numba_ver}")

# if transformers_ver >= Version("5"):
#     print("error: vLLM requires transformers<5 but transformers>=5 is installed.")
#     print("fix: pip install --upgrade 'transformers>=4.56,<5'")
#     sys.exit(2)

# # numba 0.61.x fails to import with NumPy > 2.2 and vLLM imports numba at startup.
# if numba_ver < Version("0.62") and numpy_ver > Version("2.2.99"):
#     print("error: numba<0.62 is incompatible with NumPy>2.2 in this env.")
#     print("fix: pip install --upgrade 'numpy<=2.2.2'")
#     sys.exit(2)

# cuda_ok = torch.cuda.is_available()
# cuda_count = torch.cuda.device_count() if cuda_ok else 0
# print(f"torch={torch.__version__}, cuda_available={cuda_ok}, cuda_device_count={cuda_count}")
# if not cuda_ok or cuda_count == 0:
#     print("error: CUDA is not available to this process; vLLM GPU server will fail.")
#     print("fix: verify NVIDIA driver/CUDA visibility, then retry in same shell.")
#     print("tip: run `python -c \"import torch; print(torch.cuda.is_available(), torch.cuda.device_count())\"`")
#     sys.exit(2)
# PY

# if command -v hf >/dev/null 2>&1; then
#   hf auth whoami >/dev/null 2>&1 || true
# fi

# python -c "from huggingface_hub import HfApi; print('user:', HfApi().whoami()['name'])" >/dev/null 2>&1 || true
pkill -f "vllm.entrypoints.openai.api_server" || true
pkill -f "VLLM::EngineCore" || true
sleep 1
ps aux | egrep -i 'vllm|enginecore' | grep -v egrep || true


# exec python -m vllm.entrypoints.openai.api_server \
#   --model meta-llama/Llama-3.2-3B-Instruct \
#   --host 0.0.0.0 \
#   --port 9090 \
#   --dtype float16 \
#   --gpu-memory-utilization 0.85 \
#   --max-model-len 4096

# export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

# exec python -m vllm.entrypoints.openai.api_server \
#   --model mistralai/Mistral-7B-Instruct-v0.3 \
#   --host 0.0.0.0 \
#   --port 9090 \
#   --dtype float16 \
#   --gpu-memory-utilization 0.82 \
#   --max-model-len 2048


python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct-AWQ \
  --host 0.0.0.0 \
  --port 9090 \
  --dtype float16 \
  --quantization awq_marlin \
  --gpu-memory-utilization 0.80 \
  --max-model-len 4096 \
  --max-num-seqs 16 \
  --enforce-eager


# exec python -m vllm.entrypoints.openai.api_server \
#   --model meta-llama/Meta-Llama-3.1-8B-Instruct \
#   --host 0.0.0.0 \
#   --port 9090 \
#   --dtype float16 \
#   --quantization awq \
#   --gpu-memory-utilization 0.85 \
#   --max-model-len 2048

# exec python -m vllm.entrypoints.openai.api_server \
#   --model mistralai/Mistral-7B-Instruct-v0.3 \
#   --host 0.0.0.0 \
#   --port 9090 \
#   --dtype float16 \
#   --gpu-memory-utilization 0.85 \
#   --max-model-len 4096 \
#   --enforce-eager

## NO WORK
# exec python -m vllm.entrypoints.openai.api_server \
#   --model Qwen/Qwen2.5-7B-Instruct \
#   --host 0.0.0.0 \
#   --port 9090 \
#   --dtype float16 \
#   --gpu-memory-utilization 0.85 \
#   --max-model-len 4096


## NO WORK
# exec python -m vllm.entrypoints.openai.api_server \
#   --model meta-llama/Meta-Llama-3.1-8B-Instruct \
#   --host 0.0.0.0 \
#   --port 9090 \
#   --dtype float16 \
#   --gpu-memory-utilization 0.85 \
#   --max-model-len 4096
