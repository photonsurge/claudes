#huntspell


sudo apt install hunspell-en-gb
mkdir -p dumps/{hunspell,scowl,nltk_data}

cp /usr/share/hunspell/en_GB.dic dumps/hunspell/

#scowl

cd dumps
wget http://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz
tar -xzf scowl-2020.12.07.tar.gz
cd scowl-2020.12.07
cat final/english-words.20 final/english-words.35 final/english-words.50 | sort -u > english_words_merged.txt
cat english_words_merged.txt \
  | tr '[:upper:]' '[:lower:]' \
  | grep -E '^[a-z]+$' \
  | sort -u \
  > english_words_clean.txt
cp english_words_clean.txt ../scowl/words.txt



conda run -n wiki-extract python -c "import nltk; nltk.download('wordnet', download_dir='dumps/nltk_data')"
