import json
import re
import sys
from pypdf import PdfReader

reader = PdfReader(sys.argv[1], strict=False)
if reader.is_encrypted or not 1 <= len(reader.pages) <= 400:
    raise ValueError('Encrypted or unreasonable PDF page count')
text = ' '.join((page.extract_text() or '') for page in reader.pages[:2])
text = re.sub(r'\s+', ' ', text)
refs = sorted(set(re.findall(r'\b(?:W(?:PH|MA|FM|ME|ST)\d{2}|(?:PH|MA|FM)0[1-9]|9PH0|9MA0|7357|7408)(?:\s*[/_]\s*\d{1,2})?\b', text, re.I)))
print(json.dumps({'pages': len(reader.pages), 'paperReferences': refs, 'headerEvidence': text[:4000]}, ensure_ascii=False))
