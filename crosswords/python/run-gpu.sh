export WHISPER_DEVICE=cuda
export WHISPER_COMPUTE=float16   # or int8_float16 for lower VRAM
export WHISPER_MODEL=small       # medium if you’ve got headroom
export LD_LIBRARY_PATH="$CONDA_PREFIX/lib:${LD_LIBRARY_PATH:-}"
#export TTS_DEFAULT_SPEAKER_WAV="./assets/carl-jung-interview-dreams-of-war_G_major.wav"
# # export TTS_DEFAULT_SPEAKER_WAV="./assets/i-love-it-when-you-break-my-heart-female-vocal.wav"
# # export TTS_DEFAULT_SPEAKER_WAV="./assets/prosecutor-speech-vocals-warning_F#_minor.wav"
#export TTS_DEFAULT_SPEAKER_WAV="./assets/japanese-vocals-sky-with-sunset-colors.wav"
#export TTS_DEFAULT_SPEAKER_WAV="./assets/books-and-coffee-cozy-house-vocal_C_minor.wav"
#export TTS_DEFAULT_SPEAKER_WAV="./assets/rec20260208_053402.wav"



export TTS_DEFAULT_SPEAKER_WAV="./assets/rec20260208_053402.wav"
uvicorn main:app --host 0.0.0.0 --port 3002