import math
import sys
from pathlib import Path

from PIL import Image

source = Path(sys.argv[1])
target = Path(sys.argv[2])
x0, y0, x1, y1 = map(float, sys.argv[3:7])
assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1
with Image.open(source) as image:
    bounds = (
        math.floor(x0 * image.width),
        math.floor(y0 * image.height),
        math.ceil(x1 * image.width),
        math.ceil(y1 * image.height),
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    image.crop(bounds).save(target, format="PNG")
print(f"{target}|{bounds[0]},{bounds[1]},{bounds[2]},{bounds[3]}")
