import json
import sys
from pathlib import Path

import pdfplumber

source = Path(sys.argv[1])
assert source.suffix.lower() == ".pdf"
page_number = int(sys.argv[2])
with pdfplumber.open(source) as document:
    page = document.pages[page_number - 1]
    words = page.extract_words()
    output = {
        "w": page.width,
        "h": page.height,
        "entries": [
            {
                "text": word["text"],
                "bbox": [
                    word["x0"] / page.width,
                    word["top"] / page.height,
                    word["x1"] / page.width,
                    word["bottom"] / page.height,
                ],
            }
            for word in words
        ],
    }
print(json.dumps(output, ensure_ascii=True))
