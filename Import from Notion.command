#!/bin/zsh
cd "$(dirname "$0")"
python3 backup.py
echo; echo "Finished. Press Enter to close."; read
