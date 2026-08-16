"""Crop normalized PDF regions into one atomic multipage PDF. No secrets are used."""

from __future__ import annotations

import argparse
import math
import os
import sys
import tempfile
from copy import copy
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject


def absolute_path(value: str, field: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        raise ValueError(f"{field} must be an absolute path")
    return candidate.resolve(strict=False)


def normalized_region(value: str) -> tuple[int, float, float, float, float]:
    parts = value.split(",")
    if len(parts) != 5:
        raise ValueError("region must be page,x0,y0,x1,y1")
    try:
        page = int(parts[0])
        x0, y0, x1, y1 = (float(part) for part in parts[1:])
    except ValueError as error:
        raise ValueError("region must contain numeric values") from error
    if page < 1 or not all(math.isfinite(item) and 0 <= item <= 1 for item in (x0, y0, x1, y1)):
        raise ValueError("region values must be finite and within [0, 1]")
    if x0 >= x1 or y0 >= y1:
        raise ValueError("region must have positive width and height")
    return page, x0, y0, x1, y1


def crop_page(page, x0: float, y0: float, x1: float, y1: float):
    box = page.mediabox
    left = float(box.left)
    bottom = float(box.bottom)
    width = float(box.width)
    height = float(box.height)
    # Input y values originate at the rendered image's top; PDF y originates at bottom.
    crop_box = RectangleObject([
        left + x0 * width,
        bottom + (1 - y1) * height,
        left + x1 * width,
        bottom + (1 - y0) * height,
    ])
    cropped = copy(page)
    cropped.mediabox = crop_box
    cropped.cropbox = crop_box
    return cropped


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Create one cropped multipage PDF from normalized page regions.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--region", action="append", required=True)
    args = parser.parse_args(argv)

    input_path = absolute_path(args.input, "input")
    output_path = absolute_path(args.output, "output")
    if input_path == output_path:
        raise ValueError("output must not overwrite input")
    regions = sorted((normalized_region(value) for value in args.region), key=lambda item: (item[0], item[2], item[1], item[4], item[3]))

    reader = PdfReader(str(input_path))
    writer = PdfWriter()
    for page_number, x0, y0, x1, y1 in regions:
        if page_number > len(reader.pages):
            raise ValueError(f"region page {page_number} exceeds source page count")
        writer.add_page(crop_page(reader.pages[page_number - 1], x0, y0, x1, y1))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=output_path.parent, prefix=f".{output_path.name}.", suffix=".tmp", delete=False) as stream:
            temporary_path = stream.name
            writer.write(stream)
        os.replace(temporary_path, output_path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except (OSError, ValueError) as error:
        print(f"crop_pdf: {error}", file=sys.stderr)
        raise SystemExit(2)
