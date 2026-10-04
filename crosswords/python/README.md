SPEACH ENDPOINT


conda env create -f env.cuda.yml
conda env export --no-builds > env.cuda.yml
conda activate asr_tts_cuda



ASR (Whisper + XTTS)

conda env create -f asr-env-cuda.yml
conda activate asr-whisper-gpu
sh run-gpu.sh

conda env update -f asr-env-cuda.yml --prune
conda env export --no-builds > asr-env-cuda.yml

LLM

conda env create -f llm-env.yml
conda activate llm

# Optional: install CUDA-enabled PyTorch (pick a CUDA version that matches your driver)
# pip install --index-url https://download.pytorch.org/whl/cu121 torch torchvision torchaudio

conda env update -f llm-env.yml --prune
conda env export --no-builds > llm-env.yml









WORDS EXTRACTION

conda env create -f wiki-extract-env.yml
./python/tools/reset_wiki_extract_env.sh
conda env update -f wiki-extract-env.yml --prune


conda activate wiki-extract

# Option A (legacy): parse dump locally with wiktwords (uses Lua/template expansion)
./python/tools/buildRaw.sh

# Option B (recommended): Kaikki pre-extracted data (no local Lua parsing)
./python/tools/buildFromKaikki.sh

# If you already have a raw jsonl/jsonl.gz (from either source), build word->definitions:
python python/tools/build_word_defs.py --single-token-only python/tools/out/raw.jsonl python/tools/out/en_word_defs.jsonl
