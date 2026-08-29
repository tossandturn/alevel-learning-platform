from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from api_worker import (
    QuotaExceeded,
    _upsert_review_queue,
    configured_api_token,
    materialize_api_page,
    parse_provider_jsonl,
    reserve_daily_pages,
    safe_asset_path,
)


def png_bytes(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


class ApiResultTests(unittest.TestCase):
    def test_api_review_queue_requests_codex_not_qwen(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-api-review-") as temporary:
            root = Path(temporary)
            _upsert_review_queue(root, {
                "jobId": "sha256:" + "a" * 64,
                "paperId": "cie-0580-0580_s24_qp_12",
                "stagingArtifactPath": "artifacts/staging/paper/artifact.json",
            })
            row = json.loads((root / "queue" / "structure-review.jsonl").read_text(encoding="utf-8"))

            self.assertEqual(row["providers"], ["codex"])
            self.assertNotIn("qwen", json.dumps(row).lower())

    def test_provider_jsonl_requires_exact_page_count(self) -> None:
        payload = {
            "result": {
                "layoutParsingResults": [
                    {"markdown": {"text": "Question 1"}, "parsing_res_list": []}
                ]
            }
        }
        pages = parse_provider_jsonl(json.dumps(payload) + "\n", expected_pages=1)
        self.assertEqual(pages[0]["markdown"]["text"], "Question 1")

        with self.assertRaisesRegex(ValueError, "page count"):
            parse_provider_jsonl(json.dumps(payload) + "\n", expected_pages=2)

    def test_materialization_keeps_source_provenance_and_removes_signed_urls(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-api-page-") as temporary:
            root = Path(temporary)
            source = root / "source-page.png"
            source.write_bytes(png_bytes(120, 160, (240, 240, 240)))
            source_page = {
                "path": str(source),
                "sha256": __import__("hashlib").sha256(source.read_bytes()).hexdigest(),
                "width": 120,
                "height": 160,
                "dpi": 180,
                "page": 1,
            }
            layout = {
                "markdown": {
                    "text": "Question 1\n\n![diagram](images/diagram.png?token=remove-me)",
                    "images": {
                        "images/diagram.png": "https://cdn.example/diagram.png?token=remove-me"
                    },
                },
                "outputImages": {},
                "parsing_res_list": [
                    {"block_label": "image", "block_bbox": [10, 20, 80, 120]}
                ],
            }
            downloads = {
                "https://cdn.example/diagram.png?token=remove-me": png_bytes(20, 20, (255, 0, 0))
            }

            record = materialize_api_page(
                layout=layout,
                source_page=source_page,
                page_dir=root / "page",
                fetch_bytes=downloads.__getitem__,
            )

            self.assertEqual(record["sourcePage"]["sha256"], source_page["sha256"])
            self.assertEqual(record["layoutBlockCount"], 1)
            self.assertTrue(Path(record["rawResultPath"]).is_file())
            self.assertTrue(Path(record["markdownPath"]).is_file())
            self.assertTrue(Path(record["layoutBlocksPath"]).is_file())
            persisted = "\n".join(
                path.read_text(encoding="utf-8")
                for path in (root / "page").rglob("*.json")
            )
            persisted += (root / "page" / "page.md").read_text(encoding="utf-8")
            self.assertNotIn("remove-me", persisted)

    def test_provider_asset_path_cannot_escape_root(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-api-path-") as temporary:
            root = Path(temporary)
            self.assertEqual(
                safe_asset_path(root, "../../outside.png", "fallback.png"),
                root / "fallback.png",
            )


class QuotaTests(unittest.TestCase):
    def test_official_token_name_is_preferred_with_legacy_alias_supported(self) -> None:
        self.assertEqual(
            configured_api_token({"PADDLEOCR_ACCESS_TOKEN": "official", "PADDLEOCR_API_TOKEN": "legacy"}),
            ("PADDLEOCR_ACCESS_TOKEN", "official"),
        )
        self.assertEqual(
            configured_api_token({"PADDLEOCR_API_TOKEN": "legacy"}),
            ("PADDLEOCR_API_TOKEN", "legacy"),
        )
        self.assertIsNone(configured_api_token({}))

    def test_quota_reservation_is_idempotent_and_bounded(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-api-quota-") as temporary:
            ledger = Path(temporary) / "quota.json"
            reserve_daily_pages(ledger, day="2026-08-29", reservation_id="job-a", pages=9)
            reserve_daily_pages(ledger, day="2026-08-29", reservation_id="job-a", pages=9)
            with self.assertRaises(QuotaExceeded):
                reserve_daily_pages(
                    ledger,
                    day="2026-08-29",
                    reservation_id="job-b",
                    pages=2,
                    daily_limit=10,
                )


if __name__ == "__main__":
    unittest.main()
