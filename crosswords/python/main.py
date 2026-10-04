import os

import tempfile
import subprocess
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from faster_whisper import WhisperModel
import re
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import io
import numpy as np
import soundfile as sf

# ---- TTS (XTTS v2) ----
# Coqui TTS API
from TTS.api import TTS


TTS_MODEL = os.getenv("TTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
TTS_DEVICE = os.getenv("TTS_DEVICE", "cuda")  # "cuda" or "cpu"


# PyTorch 2.6+ safe unpickling allowlist for Coqui XTTS checkpoints

# Load once at startup (like Whisper)
tts = TTS(TTS_MODEL).to(TTS_DEVICE)

class TTSRequest(BaseModel):
    text: str
    language: str = "en"
    # if you don't pass speaker_wav, it will use default voice

def _wav_bytes_from_audio(audio: np.ndarray, sample_rate: int) -> bytes:
    """
    audio: float32 numpy array in range [-1,1] (mono)
    """
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV")
    buf.seek(0)
    return buf.read()


def clean_transcript(text: str) -> str:
    if not text:
        return ""

    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()

    # Remove space before punctuation
    text = re.sub(r"\s+([.,!?])", r"\1", text)

    # Capitalize first letter
    text = text[0].upper() + text[1:] if text else text

    return text

FILLER = r"\b(um+|uh+|erm+|ah+|you know)\b"

def remove_filler(text: str) -> str:
    text = re.sub(FILLER, "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def normalize(text: str, field: str | None = None):
    text = clean_transcript(text)
    return remove_filler(text)

app = FastAPI()

MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")  # tiny/base/small/medium/large-v3
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")       # cpu or cuda
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "int8")  # cpu: int8/int8_float16 | cuda: float16/int8_float16

model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)

def convert_to_wav(src_path: str, dst_path: str):
    # Decode whatever the browser sends (webm/opus etc.) -> wav 16k mono for ASR
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-fflags", "+genpts",
        "-i", src_path,
        "-ac", "1", "-ar", "16000", "-f", "wav",
        dst_path
    ]

    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode("utf-8", errors="ignore"))

@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: str | None = Form(default=None),  # e.g. "en"
    vad_filter: bool = Form(default=True),
):
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file")

    with tempfile.TemporaryDirectory() as d:
        raw_path = os.path.join(d, "input")
        wav_path = os.path.join(d, "audio.wav")

        # Save upload
        contents = await audio.read()
        with open(raw_path, "wb") as f:
            f.write(contents)

        # Convert to wav
        try:
            convert_to_wav(raw_path, wav_path)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"ffmpeg decode failed: {e}")

        # Transcribe
        segments, info = model.transcribe(
            wav_path,
            language=language,   # None = auto-detect
            vad_filter=vad_filter,
        )

        text = "".join([seg.text for seg in segments]).strip()

        return {
            "text": text,
            "language": info.language,
            "duration": info.duration,
        }

TTS_DEFAULT_SPEAKER_WAV = os.getenv("TTS_DEFAULT_SPEAKER_WAV")  # optional

@app.post("/tts")
async def tts_speak(
    text: str = Form(...),
    language: str = Form("en"),
    speaker_wav: UploadFile | None = File(default=None),
):
    text = normalize((text or "").strip())
    if not text:
        raise HTTPException(status_code=400, detail="No text")

    with tempfile.TemporaryDirectory() as d:
        speaker_path = None

        # 1) user-provided speaker wav
        if speaker_wav is not None:
            speaker_path = os.path.join(d, "speaker.wav")
            data = await speaker_wav.read()
            with open(speaker_path, "wb") as f:
                f.write(data)

        # 2) fallback default speaker wav (server-side)
        if speaker_path is None and TTS_DEFAULT_SPEAKER_WAV:
            speaker_path = TTS_DEFAULT_SPEAKER_WAV

        try:
            if speaker_path:
                audio = tts.tts(text=text, speaker_wav=speaker_path, language=language)
            else:
                # If you hit this, your model requires a speaker_wav, so error clearly
                raise RuntimeError("No speaker_wav provided and no default configured")

            sr = getattr(tts.synthesizer, "output_sample_rate", 24000)
            wav_bytes = _wav_bytes_from_audio(np.array(audio, dtype=np.float32), sr)

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"TTS failed: {e}")

    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")
