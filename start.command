#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js غير مثبّت. حمّله من https://nodejs.org ثم شغّل الملف مرة أخرى."
  read -n 1 -s -r -p "اضغط أي زر للخروج"
  exit 1
fi
node launch.js
