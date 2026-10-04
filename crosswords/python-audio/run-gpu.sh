export WHISPER_DEVICE=cuda
export WHISPER_COMPUTE=float16   # or int8_float16 for lower VRAM
export WHISPER_MODEL=small       # medium if you’ve got headroom

uvicorn main:app --host 0.0.0.0 --port 3002