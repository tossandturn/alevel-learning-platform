from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from ipaddress import ip_address
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import urlsplit

try:
    from runner import (
        ARTIFACT_SCHEMA,
        DEFAULT_DPI,
        ENGINE_NAME,
        PIPELINE_VERSION,
        REVIEW_QUEUE_SCHEMA,
        WorkerLock,
        _page_record_is_valid,
        _render_page,
        _work_path,
        append_event,
        atomic_write_json,
        atomic_write_jsonl,
        build_staging_artifact,
        initial_job_state,
        safe_error_message,
        sha256_file,
        extract_layout_blocks,
    )
except ImportError:
    from .runner import (
        ARTIFACT_SCHEMA,
        DEFAULT_DPI,
        ENGINE_NAME,
        PIPELINE_VERSION,
        REVIEW_QUEUE_SCHEMA,
        WorkerLock,
        _page_record_is_valid,
        _render_page,
        _work_path,
        append_event,
        atomic_write_json,
        atomic_write_jsonl,
        build_staging_artifact,
        initial_job_state,
        safe_error_message,
        sha256_file,
        extract_layout_blocks,
    )


API_URL = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs"
MODEL = "PaddleOCR-VL-1.6"
TOKEN_ENV = "PADDLEOCR_ACCESS_TOKEN"
LEGACY_TOKEN_ENV = "PADDLEOCR_API_TOKEN"
API_STATE_SCHEMA = "stem-paddle-ocr-api-job-state.v1"
FAILURE_SCHEMA = "stem-paddle-ocr-api-quarantine.v1"
DEFAULT_DAILY_PAGE_LIMIT = 20_000
DEFAULT_OPTIONAL_PAYLOAD = {
    "useDocOrientationClassify": False,
    "useDocUnwarping": False,
    "useChartRecognition": False,
}
SENSITIVE_KEY_PARTS = ("authorization", "api_key", "apikey", "secret", "signature", "token")


class PaddleApiError(RuntimeError):
    pass


class ResultValidationError(PaddleApiError, ValueError):
    pass


class QuotaExceeded(PaddleApiError):
    pass


def configured_api_token(environ: Mapping[str, str] | None = None) -> tuple[str, str] | None:
    values = environ if environ is not None else os.environ
    for name in (TOKEN_ENV, LEGACY_TOKEN_ENV):
        value = str(values.get(name, "")).strip()
        if value:
            return name, value
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", newline="\n", dir=path.parent, delete=False
        ) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _atomic_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _load_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.is_file():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ResultValidationError(f"expected JSON object at {path}:{line_number}")
            rows.append(value)
    return rows


def _is_remote_url(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme.lower() in {"http", "https"} and bool(parsed.netloc)


def _redact_text(value: str) -> str:
    value = re.sub(r"(?i)https?://[^\s)]+", "[remote-url-removed]", value)
    value = re.sub(
        r"(?i)(authorization|bearer|token|api[_-]?key|secret|signature)\s*[:=]\s*[^\s,}]+",
        r"\1=[redacted]",
        value,
    )
    return value


def sanitize_for_persistence(value: Any) -> Any:
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key)
            normalized = name.lower().replace("-", "_")
            if any(part in normalized for part in SENSITIVE_KEY_PARTS):
                result[name] = "[redacted]"
            else:
                result[name] = sanitize_for_persistence(item)
        return result
    if isinstance(value, list):
        return [sanitize_for_persistence(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_for_persistence(item) for item in value]
    if isinstance(value, str):
        return _redact_text(value) if _is_remote_url(value) or "http" in value.lower() else value
    return value


def _safe_component(value: str, fallback: str) -> str:
    result = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip(".-")
    return result or fallback


def safe_asset_path(root: Path, provider_name: str, fallback: str) -> Path:
    resolved_root = root.resolve()
    normalized = provider_name.replace("\\", "/")
    normalized = normalized.split("?", 1)[0].split("#", 1)[0]
    candidate = PurePosixPath(normalized)
    if candidate.is_absolute() or any(part in ("", ".", "..") for part in candidate.parts) or ":" in normalized:
        candidate = PurePosixPath(_safe_component(fallback, "asset.bin"))
    target = resolved_root.joinpath(*[_safe_component(part, "asset") for part in candidate.parts]).resolve()
    try:
        target.relative_to(resolved_root)
    except ValueError:
        target = resolved_root / _safe_component(fallback, "asset.bin")
    return target


def _validate_download_url(value: str) -> None:
    parsed = urlsplit(value)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ResultValidationError("provider asset URL must use HTTPS")
    hostname = parsed.hostname.lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ResultValidationError("provider asset URL points to localhost")
    try:
        address = ip_address(hostname)
    except ValueError:
        return
    if address.is_private or address.is_loopback or address.is_link_local:
        raise ResultValidationError("provider asset URL points to a non-public address")


def _image_extension(value: bytes, provider_name: str) -> str:
    suffix = Path(urlsplit(provider_name).path).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
        return suffix
    try:
        from PIL import Image

        from_bytes = Image.open(__import__("io").BytesIO(value))
        image_format = (from_bytes.format or "").lower()
        from_bytes.close()
    except Exception:
        image_format = ""
    return {
        "jpeg": ".jpg",
        "png": ".png",
        "webp": ".webp",
        "bmp": ".bmp",
        "tiff": ".tiff",
    }.get(image_format, ".bin")


def _image_dimensions(value: bytes) -> tuple[int, int] | None:
    try:
        from PIL import Image

        with Image.open(__import__("io").BytesIO(value)) as image:
            return image.size
    except Exception:
        return None


def parse_provider_jsonl(jsonl_text: str, expected_pages: int) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(jsonl_text.splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise ResultValidationError(f"invalid provider JSON at line {line_number}") from error
        if not isinstance(payload, Mapping):
            raise ResultValidationError(f"provider result at line {line_number} is not an object")
        result = payload.get("result", payload)
        if not isinstance(result, Mapping):
            raise ResultValidationError(f"provider result at line {line_number} has no object result")
        candidates = result.get("layoutParsingResults")
        if not isinstance(candidates, list):
            raise ResultValidationError(f"provider result at line {line_number} has no layoutParsingResults")
        for page in candidates:
            if not isinstance(page, Mapping):
                raise ResultValidationError(f"provider page at line {line_number} is not an object")
            pages.append(dict(page))
    if len(pages) != expected_pages:
        raise ResultValidationError(
            f"provider page count {len(pages)} does not match expected page count {expected_pages}"
        )
    return pages


def reserve_daily_pages(
    ledger_path: Path,
    *,
    day: str,
    reservation_id: str,
    pages: int,
    daily_limit: int = DEFAULT_DAILY_PAGE_LIMIT,
    external_used_pages: int = 0,
) -> dict[str, Any]:
    if pages <= 0:
        raise ValueError("pages must be positive")
    if daily_limit <= 0:
        raise ValueError("daily_limit must be positive")
    if external_used_pages < 0 or external_used_pages > daily_limit:
        raise ValueError("external_used_pages is outside the daily limit")
    if not reservation_id:
        raise ValueError("reservation_id must not be empty")
    ledger = _load_json(
        ledger_path,
        {"schema_version": "paddleocr_api_daily_quota_v1", "daily_limit": daily_limit, "days": {}},
    )
    effective_limit = min(int(ledger.get("daily_limit", daily_limit)), daily_limit)
    ledger["daily_limit"] = effective_limit
    days = ledger.setdefault("days", {})
    day_record = days.setdefault(day, {"external_used_pages": 0, "reservations": {}})
    day_record["external_used_pages"] = max(
        int(day_record.get("external_used_pages", 0)), external_used_pages
    )
    reservations = day_record.setdefault("reservations", {})
    existing = reservations.get(reservation_id)
    if existing is not None and int(existing) != pages:
        raise ValueError(f"reservation {reservation_id!r} has a different page count")
    reserved = sum(int(value) for value in reservations.values())
    candidate = reserved if existing is not None else reserved + pages
    effective = candidate + int(day_record["external_used_pages"])
    if effective > effective_limit:
        raise QuotaExceeded(f"daily page limit would be exceeded: {effective}/{effective_limit}")
    reservations[reservation_id] = pages
    day_record["reserved_pages"] = candidate
    day_record["effective_pages"] = effective
    day_record["remaining_pages"] = effective_limit - effective
    day_record["updated_at"] = _now_iso()
    atomic_write_json(ledger_path, ledger)
    return dict(day_record)


class PaddleApiClient:
    def __init__(self, token: str, *, base_url: str = API_URL, session: Any | None = None) -> None:
        if not token or not token.strip():
            raise PaddleApiError(f"{TOKEN_ENV} is empty")
        parsed = urlsplit(base_url)
        if parsed.scheme.lower() != "https" or not parsed.netloc:
            raise PaddleApiError("Paddle API endpoint must be HTTPS")
        try:
            import requests
        except ImportError as error:
            raise PaddleApiError("requests is not installed in the selected Python environment") from error
        self._requests = requests
        self._session = session or requests.Session()
        self._base_url = base_url.rstrip("/")
        self._headers = {"Authorization": f"bearer {token.strip()}"}

    @staticmethod
    def _json(response: Any, operation: str) -> dict[str, Any]:
        if not 200 <= int(response.status_code) < 300:
            raise PaddleApiError(f"{operation} failed with HTTP {response.status_code}")
        try:
            value = response.json()
        except ValueError as error:
            raise PaddleApiError(f"{operation} returned invalid JSON") from error
        if not isinstance(value, dict):
            raise PaddleApiError(f"{operation} returned an invalid payload")
        return value

    def submit_pdf(self, pdf_path: Path, optional_payload: Mapping[str, Any] | None = None) -> str:
        payload = optional_payload or DEFAULT_OPTIONAL_PAYLOAD
        try:
            with pdf_path.open("rb") as handle:
                response = self._session.post(
                    self._base_url,
                    headers=self._headers,
                    data={"model": MODEL, "optionalPayload": json.dumps(payload, separators=(",", ":"))},
                    files={"file": (pdf_path.name, handle, "application/pdf")},
                    timeout=(30, 600),
                )
        except self._requests.RequestException as error:
            raise PaddleApiError("job submission ended without a confirmed response") from error
        value = self._json(response, "job submission")
        data = value.get("data")
        job_id = data.get("jobId") if isinstance(data, Mapping) else None
        if not isinstance(job_id, str) or not job_id:
            raise PaddleApiError("job submission response did not include a jobId")
        return job_id

    def get_job(self, job_id: str) -> dict[str, Any]:
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                response = self._session.get(
                    f"{self._base_url}/{job_id}", headers=self._headers, timeout=(30, 120)
                )
                return self._json(response, "job status")
            except self._requests.RequestException as error:
                last_error = error
                if attempt < 3:
                    time.sleep(min(2**attempt, 8))
        raise PaddleApiError("job status request failed after bounded retries") from last_error

    def download_bytes(self, url: str) -> bytes:
        _validate_download_url(url)
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                response = self._session.get(url, timeout=(30, 300))
                if response.status_code == 200 and response.content:
                    return bytes(response.content)
                if response.status_code < 500 and response.status_code != 429:
                    raise PaddleApiError(f"provider asset download failed with HTTP {response.status_code}")
            except self._requests.RequestException as error:
                last_error = error
            if attempt < 3:
                time.sleep(min(2**attempt, 8))
        raise PaddleApiError("provider asset download failed after bounded retries") from last_error

    def download_text(self, url: str) -> str:
        value = self.download_bytes(url)
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ResultValidationError("provider JSONL result is not UTF-8") from error


def _relative_to_work(work_root: Path, target: Path) -> str:
    try:
        return target.resolve().relative_to(work_root.resolve()).as_posix()
    except ValueError as error:
        raise ResultValidationError(f"path escapes OCR work root: {target}") from error


def _verify_source(document: Mapping[str, Any]) -> Path:
    path = Path(str(document.get("path", ""))).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"source PDF is missing: {path}")
    if sha256_file(path) != str(document.get("sha256", "")):
        raise ResultValidationError(f"source PDF SHA-256 changed: {path}")
    return path


def _render_source_pages(
    document: Mapping[str, Any],
    output_root: Path,
    *,
    dpi: int,
) -> dict[int, dict[str, Any]]:
    source = _verify_source(document)
    pages: dict[int, dict[str, Any]] = {}
    for page_number in range(1, int(document["pageCount"]) + 1):
        page_dir = output_root / "pages" / f"{page_number:04d}"
        image_path = page_dir / "source-page.png"
        if image_path.is_file():
            actual_hash = sha256_file(image_path)
            try:
                from PIL import Image

                with Image.open(image_path) as image:
                    width, height = image.size
            except Exception:
                width = height = 0
            if actual_hash and width > 0 and height > 0:
                pages[page_number] = {
                    "path": str(image_path),
                    "sha256": actual_hash,
                    "width": width,
                    "height": height,
                    "dpi": dpi,
                    "page": page_number,
                }
                continue
        rendered = _render_page(source, page_number, image_path, dpi)
        rendered["page"] = page_number
        pages[page_number] = rendered
    return pages


def _localize_markdown(
    text: str,
    images: Mapping[str, Any],
    page_dir: Path,
    fetch_bytes: Callable[[str], bytes],
) -> tuple[str, list[dict[str, Any]]]:
    localized = str(text or "")
    assets: list[dict[str, Any]] = []
    for index, (provider_name, remote_url) in enumerate(images.items(), start=1):
        if not isinstance(remote_url, str) or not _is_remote_url(remote_url):
            raise ResultValidationError("provider markdown image URL is invalid")
        _validate_download_url(remote_url)
        value = fetch_bytes(remote_url)
        if not isinstance(value, bytes) or not value:
            raise ResultValidationError("provider returned an empty markdown image")
        target = safe_asset_path(
            page_dir / "imgs",
            str(provider_name),
            f"image-{index:03d}{_image_extension(value, str(provider_name))}",
        )
        _atomic_bytes(target, value)
        relative = target.relative_to(page_dir).as_posix()
        for reference in (str(provider_name), f"./{provider_name}"):
            localized = localized.replace(f"]({reference})", f"]({relative})")
        localized = localized.replace(str(provider_name), relative)
        assets.append({
            "kind": "markdown-image",
            "path": str(target),
            "sha256": sha256_bytes(value),
            "bytes": len(value),
        })
    return _redact_text(localized), assets


def _localize_output_images(
    output_images: Mapping[str, Any],
    page_dir: Path,
    fetch_bytes: Callable[[str], bytes],
) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for index, (provider_name, remote_url) in enumerate(output_images.items(), start=1):
        if not isinstance(remote_url, str) or not _is_remote_url(remote_url):
            raise ResultValidationError("provider output image URL is invalid")
        _validate_download_url(remote_url)
        value = fetch_bytes(remote_url)
        if not isinstance(value, bytes) or not value:
            raise ResultValidationError("provider returned an empty output image")
        stem = _safe_component(str(provider_name), f"output-{index:03d}")
        target = page_dir / "visualizations" / f"{stem}-output{_image_extension(value, remote_url)}"
        _atomic_bytes(target, value)
        dimensions = _image_dimensions(value)
        asset: dict[str, Any] = {
            "kind": "paddle-visualization",
            "providerName": str(provider_name),
            "path": str(target),
            "sha256": sha256_bytes(value),
            "bytes": len(value),
        }
        if dimensions:
            asset["width"], asset["height"] = dimensions
        assets.append(asset)
    return assets


def materialize_api_page(
    *,
    layout: Mapping[str, Any],
    source_page: Mapping[str, Any],
    page_dir: Path,
    fetch_bytes: Callable[[str], bytes],
) -> dict[str, Any]:
    source_path = Path(str(source_page.get("path", ""))).resolve()
    if not source_path.is_file() or sha256_file(source_path) != source_page.get("sha256"):
        raise ResultValidationError(f"source page is missing or changed: {source_path}")
    page_dir.mkdir(parents=True, exist_ok=True)
    markdown_value = layout.get("markdown") if isinstance(layout.get("markdown"), Mapping) else {}
    markdown_text = str(
        markdown_value.get("markdown_texts")
        or markdown_value.get("markdown_text")
        or markdown_value.get("text")
        or ""
    )
    markdown_images = markdown_value.get("images", {})
    if not isinstance(markdown_images, Mapping):
        markdown_images = {}
    markdown_text, markdown_assets = _localize_markdown(
        markdown_text, markdown_images, page_dir, fetch_bytes
    )
    output_images = layout.get("outputImages", {})
    if not isinstance(output_images, Mapping):
        output_images = {}
    output_assets = _localize_output_images(output_images, page_dir, fetch_bytes)

    localized_layout = dict(sanitize_for_persistence(layout))
    localized_markdown = dict(localized_layout.get("markdown", {}))
    localized_markdown["text"] = markdown_text
    localized_markdown["images"] = {
        str(name): str(Path(asset["path"]).relative_to(page_dir).as_posix())
        for name, asset in zip(markdown_images.keys(), markdown_assets)
    }
    localized_layout["markdown"] = localized_markdown
    localized_layout["outputImages"] = {
        asset["providerName"]: Path(asset["path"]).relative_to(page_dir).as_posix()
        for asset in output_assets
    }
    localized_layout = sanitize_for_persistence(localized_layout)

    raw_path = page_dir / "paddle-result.json"
    atomic_write_json(raw_path, localized_layout)
    width = int(source_page["width"])
    height = int(source_page["height"])
    blocks = extract_layout_blocks(dict(layout), width, height)
    if not blocks and isinstance(layout.get("prunedResult"), Mapping):
        blocks = extract_layout_blocks(dict(layout["prunedResult"]), width, height)
    blocks_path = page_dir / "layout-blocks.json"
    atomic_write_json(blocks_path, {"page": dict(source_page), "blocks": blocks})
    markdown_path = page_dir / "page.md"
    _atomic_text(markdown_path, markdown_text)
    assets = [
        {
            **asset,
            "path": str(Path(asset["path"]).resolve()),
        }
        for asset in (*markdown_assets, *output_assets)
    ]
    return {
        "sourcePage": dict(source_page),
        "rawResultPath": str(raw_path.resolve()),
        "rawResultSha256": sha256_file(raw_path),
        "markdownPath": str(markdown_path.resolve()),
        "markdownSha256": sha256_file(markdown_path),
        "layoutBlocksPath": str(blocks_path.resolve()),
        "layoutBlocksSha256": sha256_file(blocks_path),
        "layoutBlockCount": len(blocks),
        "assets": assets,
        "status": "completed",
        "completedAt": _now_iso(),
    }


def _api_page_record_is_valid(record: Any, work_root: Path) -> bool:
    if not isinstance(record, Mapping) or record.get("status") != "completed":
        return False
    paths = [
        (record.get("rawResultPath"), record.get("rawResultSha256")),
        (record.get("markdownPath"), record.get("markdownSha256")),
        (record.get("layoutBlocksPath"), record.get("layoutBlocksSha256")),
    ]
    source = record.get("sourcePage")
    if not isinstance(source, Mapping):
        return False
    paths.append((source.get("path"), source.get("sha256")))
    for raw_path, expected in paths:
        if not isinstance(raw_path, str) or not isinstance(expected, str):
            return False
        path = Path(raw_path).resolve()
        try:
            path.relative_to(work_root.resolve())
        except ValueError:
            return False
        if not path.is_file() or sha256_file(path) != expected:
            return False
    for asset in record.get("assets", []):
        if not isinstance(asset, Mapping) or not isinstance(asset.get("path"), str):
            return False
        asset_path = Path(str(asset["path"])).resolve()
        try:
            asset_path.relative_to(work_root.resolve())
        except ValueError:
            return False
        if not asset_path.is_file() or sha256_file(asset_path) != asset.get("sha256"):
            return False
    return True


def _api_output_root(work_root: Path, job: Mapping[str, Any]) -> Path:
    return _work_path(work_root, f"ocr-api/{job['jobKey']}")


def _api_state_path(work_root: Path, job: Mapping[str, Any]) -> Path:
    return _work_path(work_root, f"state/api/{job['jobKey']}.json")


def _new_api_state(job: Mapping[str, Any]) -> dict[str, Any]:
    now = _now_iso()
    return {
        "schemaVersion": API_STATE_SCHEMA,
        "jobId": job["jobId"],
        "jobKey": job["jobKey"],
        "paperId": job["paperId"],
        "provider": "PaddleOCR official API",
        "model": MODEL,
        "status": "pending",
        "createdAt": now,
        "updatedAt": now,
        "documents": {
            kind: {
                "status": "pending",
                "sourceSha256": job["documents"][kind]["sha256"],
                "pageCount": int(job["documents"][kind]["pageCount"]),
                "pages": {},
            }
            for kind in ("qp", "ms")
        },
    }


def _ensure_api_state(work_root: Path, job: Mapping[str, Any]) -> dict[str, Any]:
    path = _api_state_path(work_root, job)
    state = _load_json(path)
    if not isinstance(state, dict) or state.get("jobId") != job["jobId"]:
        state = {
            "schemaVersion": API_STATE_SCHEMA,
            "jobId": job["jobId"],
            "jobKey": job["jobKey"],
            "paperId": job["paperId"],
            "provider": "PaddleOCR official API",
            "model": MODEL,
            "status": "pending",
            "createdAt": _now_iso(),
            "updatedAt": _now_iso(),
            "documents": {},
        }
    output_root = _api_output_root(work_root, job)
    for kind in ("qp", "ms"):
        document = state.setdefault("documents", {}).setdefault(
            kind,
            {
                "status": "pending",
                "sourceSha256": job["documents"][kind]["sha256"],
                "pageCount": int(job["documents"][kind]["pageCount"]),
                "pages": {},
            },
        )
        document["sourceSha256"] = job["documents"][kind]["sha256"]
        document["pageCount"] = int(job["documents"][kind]["pageCount"])
        document["outputRoot"] = _relative_to_work(work_root, output_root / kind)
    return state


def _persist_api_state(work_root: Path, job: Mapping[str, Any], state: dict[str, Any]) -> None:
    state["updatedAt"] = _now_iso()
    atomic_write_json(_api_state_path(work_root, job), state)


def _sync_common_state(work_root: Path, job: Mapping[str, Any], api_state: Mapping[str, Any]) -> dict[str, Any]:
    state_path = _work_path(work_root, str(job["statePath"]))
    common = _load_json(state_path, initial_job_state(dict(job)))
    if not isinstance(common, dict) or common.get("jobId") != job["jobId"]:
        raise ResultValidationError("common OCR state jobId mismatch")
    common["api"] = sanitize_for_persistence(dict(api_state))
    api_documents = api_state.get("documents", {})
    all_completed = True
    for kind in ("qp", "ms"):
        api_document = api_documents.get(kind, {}) if isinstance(api_documents, Mapping) else {}
        common_document = common.setdefault("documents", {}).setdefault(kind, {})
        if api_document.get("status") == "completed":
            pages = api_document.get("pages", {})
            common_document["status"] = "completed"
            common_document["pages"] = pages
            common_document["completedPages"] = sorted(int(page) for page in pages)
            common_document["apiProvider"] = "PaddleOCR official API"
        else:
            all_completed = False
            if api_document.get("status") in {"running", "submitted", "partial"}:
                common_document["status"] = "partial"
    common["status"] = "completed" if all_completed else api_state.get("status", "partial")
    common["updatedAt"] = _now_iso()
    atomic_write_json(state_path, common)
    artifact = build_staging_artifact(dict(job), common)
    artifact["ocr"].update({
        "provider": "PaddleOCR official API",
        "model": MODEL,
        "executionMode": "remote_api",
        "apiStatePath": _relative_to_work(work_root, _api_state_path(work_root, job)),
    })
    atomic_write_json(_work_path(work_root, str(job["stagingArtifactPath"])), artifact)
    return common


def _review_queue_path(work_root: Path) -> Path:
    return work_root / "queue" / "structure-review.jsonl"


def _upsert_review_queue(work_root: Path, job: Mapping[str, Any]) -> None:
    path = _review_queue_path(work_root)
    rows = _load_jsonl(path)
    row = {
        "schemaVersion": REVIEW_QUEUE_SCHEMA,
        "reviewId": job["jobId"],
        "paperId": job["paperId"],
        "artifactPath": job["stagingArtifactPath"],
        "status": "pending_provider_review",
        "providers": ["codex"],
        "requiredChecks": [
            "whole_question_boundaries",
            "question_part_structure",
            "qp_ms_question_binding",
            "diagram_region_integrity",
            "official_syllabus_topic_binding",
        ],
        "studentStudyEligible": False,
    }
    by_id = {str(item.get("reviewId")): item for item in rows if item.get("reviewId")}
    by_id[str(row["reviewId"])] = row
    atomic_write_jsonl(path, [by_id[key] for key in sorted(by_id)])


def _failure_path(work_root: Path, job: Mapping[str, Any]) -> Path:
    return _work_path(work_root, str(job["quarantinePath"]))


def _write_failure(work_root: Path, job: Mapping[str, Any], error: BaseException, document: str) -> None:
    atomic_write_json(
        _failure_path(work_root, job),
        {
            "schemaVersion": FAILURE_SCHEMA,
            "artifactId": job["jobId"],
            "paperId": job["paperId"],
            "status": "ocr-quarantined",
            "failedDocument": document,
            "reasonCode": "PADDLE_API_RESULT_INVALID" if isinstance(error, ResultValidationError) else "PADDLE_API_FAILED",
            "errorType": type(error).__name__,
            "error": safe_error_message(error),
            "provider": "PaddleOCR official API",
            "model": MODEL,
            "studentStudyEligible": False,
            "formalProgressEligible": False,
            "createdAt": _now_iso(),
        },
    )


def _result_url(data: Mapping[str, Any]) -> str:
    result_url = data.get("resultUrl")
    if isinstance(result_url, Mapping):
        value = result_url.get("jsonUrl") or result_url.get("json_url")
        if isinstance(value, str) and value:
            return value
    value = data.get("jsonUrl") or data.get("json_url")
    if isinstance(value, str) and value:
        return value
    raise PaddleApiError("completed provider job did not include a JSONL result URL")


def _provider_progress(data: Mapping[str, Any]) -> dict[str, Any]:
    progress = data.get("extractProgress", {})
    if not isinstance(progress, Mapping):
        progress = {}
    return {
        key: sanitize_for_persistence(progress[key])
        for key in ("totalPages", "extractedPages", "startTime", "endTime")
        if key in progress
    }


def _process_document(
    *,
    client: PaddleApiClient,
    work_root: Path,
    job: Mapping[str, Any],
    api_state: dict[str, Any],
    kind: str,
    daily_limit: int,
    external_used_pages: int,
    poll_interval: float,
    max_wait_seconds: float,
    dpi: int,
    allow_resubmit_unknown: bool,
) -> None:
    document = job["documents"][kind]
    document_state = api_state["documents"][kind]
    output_root = _api_output_root(work_root, job) / kind
    source_pages = _render_source_pages(document, output_root, dpi=dpi)
    document_state["sourceSha256"] = document["sha256"]
    document_state["pageCount"] = int(document["pageCount"])
    document_state["sourcePages"] = {
        str(page): {
            "sha256": record["sha256"],
            "width": record["width"],
            "height": record["height"],
            "dpi": record["dpi"],
            "path": _relative_to_work(work_root, Path(record["path"])),
        }
        for page, record in source_pages.items()
    }
    previous_status = str(document_state.get("status", "pending"))
    document_state["status"] = "rendered"
    _persist_api_state(work_root, job, api_state)

    provider_job_id = document_state.get("providerJobId")
    if not provider_job_id:
        if previous_status == "submission_unknown" and not allow_resubmit_unknown:
            raise PaddleApiError(
                f"submission state is unknown for {job['paperId']} {kind}; verify the provider dashboard before resubmitting"
            )
        reservation_id = f"{job['jobKey']}:{kind}"
        reserve_daily_pages(
            work_root / "state" / "api-quota-ledger.json",
            day=datetime.now().astimezone().date().isoformat(),
            reservation_id=reservation_id,
            pages=int(document["pageCount"]),
            daily_limit=daily_limit,
            external_used_pages=external_used_pages,
        )
        try:
            provider_job_id = client.submit_pdf(Path(str(document["path"])))
        except Exception:
            document_state["status"] = "submission_unknown"
            _persist_api_state(work_root, job, api_state)
            raise
        document_state["providerJobId"] = provider_job_id
        document_state["providerStatus"] = "submitted"
        document_state["submittedAt"] = _now_iso()
        _persist_api_state(work_root, job, api_state)
        append_event(
            work_root,
            "api_document_submitted",
            jobId=job["jobId"],
            paperId=job["paperId"],
            document=kind,
            provider="PaddleOCR official API",
            model=MODEL,
        )

    document_state["status"] = "running"
    started = time.monotonic()
    while True:
        status_payload = client.get_job(str(provider_job_id))
        data = status_payload.get("data")
        if not isinstance(data, Mapping):
            raise PaddleApiError("provider job status response is missing data")
        provider_status = str(data.get("state", "")).lower()
        document_state["providerStatus"] = provider_status or "unknown"
        document_state["progress"] = _provider_progress(data)
        document_state["lastStatusAt"] = _now_iso()
        _persist_api_state(work_root, job, api_state)
        append_event(
            work_root,
            "api_document_status",
            jobId=job["jobId"],
            paperId=job["paperId"],
            document=kind,
            providerStatus=provider_status,
            progress=document_state["progress"],
        )
        if provider_status == "done":
            result_url = _result_url(data)
            jsonl_text = client.download_text(result_url)
            layouts = parse_provider_jsonl(jsonl_text, int(document["pageCount"]))
            records: dict[str, Any] = {}
            for page_number, layout in enumerate(layouts, start=1):
                page_dir = output_root / "pages" / f"{page_number:04d}"
                record = materialize_api_page(
                    layout=layout,
                    source_page=source_pages[page_number],
                    page_dir=page_dir,
                    fetch_bytes=client.download_bytes,
                )
                records[str(page_number)] = record
            document_state["pages"] = records
            document_state["completedPages"] = list(range(1, int(document["pageCount"]) + 1))
            document_state["status"] = "completed"
            document_state["completedAt"] = _now_iso()
            _persist_api_state(work_root, job, api_state)
            append_event(
                work_root,
                "api_document_completed",
                jobId=job["jobId"],
                paperId=job["paperId"],
                document=kind,
                pages=len(records),
            )
            return
        if provider_status == "failed":
            message = sanitize_for_persistence(str(data.get("errorMsg", "provider job failed")))
            raise PaddleApiError(f"provider job failed for {job['paperId']} {kind}: {message}")
        if provider_status not in {"pending", "running"}:
            raise PaddleApiError(f"provider returned unknown job state {provider_status!r}")
        if time.monotonic() - started >= max_wait_seconds:
            document_state["status"] = "partial"
            document_state["timeoutAt"] = _now_iso()
            _persist_api_state(work_root, job, api_state)
            raise TimeoutError(f"polling window ended for {job['paperId']} {kind}; rerun to resume")
        time.sleep(poll_interval)


def _job_is_complete(work_root: Path, job: Mapping[str, Any], api_state: Mapping[str, Any]) -> bool:
    for kind in ("qp", "ms"):
        document = api_state.get("documents", {}).get(kind, {})
        pages = document.get("pages", {}) if isinstance(document, Mapping) else {}
        if document.get("status") != "completed" or len(pages) != int(job["documents"][kind]["pageCount"]):
            return False
        if not all(_api_page_record_is_valid(record, work_root) for record in pages.values()):
            return False
    return True


def run_api_jobs(
    work_root: Path,
    *,
    job_selector: str | None,
    max_jobs: int | None,
    device: str | None = None,
    endpoint: str = API_URL,
    model: str = MODEL,
    daily_limit: int = DEFAULT_DAILY_PAGE_LIMIT,
    external_used_pages: int = 0,
    poll_interval: float = 5.0,
    max_wait_seconds: float = 7200.0,
    dpi: int = DEFAULT_DPI,
    allow_resubmit_unknown: bool = False,
    retry_quarantined: bool = False,
    fail_fast: bool = False,
    client_factory: Callable[[str, str], PaddleApiClient] | None = None,
) -> dict[str, Any]:
    if poll_interval < 1 or poll_interval > 60:
        raise ValueError("poll_interval must be between 1 and 60 seconds")
    if max_wait_seconds <= 0:
        raise ValueError("max_wait_seconds must be positive")
    if dpi <= 0 or dpi > 300:
        raise ValueError("dpi must be between 1 and 300")
    queue_path = work_root / "queue" / "ocr-jobs.jsonl"
    jobs = _load_jsonl(queue_path)
    if job_selector:
        jobs = [
            job for job in jobs
            if job_selector in (job.get("jobId"), job.get("jobKey"), job.get("paperId"))
        ]
        if not jobs:
            raise KeyError(f"No queue job matches: {job_selector}")
    if max_jobs is not None:
        if max_jobs <= 0:
            raise ValueError("max_jobs must be positive")
        jobs = jobs[:max_jobs]
    configured_token = configured_api_token()
    if not configured_token:
        raise PaddleApiError(
            f"{TOKEN_ENV} or {LEGACY_TOKEN_ENV} is not set; provide it to this process without writing it to a file"
        )
    _, token = configured_token
    client = client_factory(token, endpoint) if client_factory else PaddleApiClient(token, base_url=endpoint)
    summary = {"selectedJobs": len(jobs), "completed": 0, "partial": 0, "quarantined": 0, "skipped": 0}
    append_event(
        work_root,
        "api_worker_started",
        pid=os.getpid(),
        selectedJobs=len(jobs),
        provider="PaddleOCR official API",
        model=model,
    )
    for job in jobs:
        api_state = _ensure_api_state(work_root, job)
        if _job_is_complete(work_root, job, api_state):
            summary["skipped"] += 1
            _sync_common_state(work_root, job, api_state)
            continue
        api_state["status"] = "running"
        _persist_api_state(work_root, job, api_state)
        failed_kind = "unknown"
        try:
            for kind in ("qp", "ms"):
                failed_kind = kind
                document_state = api_state["documents"][kind]
                if document_state.get("status") == "completed" and all(
                    _api_page_record_is_valid(record, work_root)
                    for record in document_state.get("pages", {}).values()
                ):
                    continue
                if document_state.get("status") == "quarantined" and not retry_quarantined:
                    raise PaddleApiError(f"{job['paperId']} {kind} is quarantined; use retry explicitly")
                _process_document(
                    client=client,
                    work_root=work_root,
                    job=job,
                    api_state=api_state,
                    kind=kind,
                    daily_limit=daily_limit,
                    external_used_pages=external_used_pages,
                    poll_interval=poll_interval,
                    max_wait_seconds=max_wait_seconds,
                    dpi=dpi,
                    allow_resubmit_unknown=allow_resubmit_unknown,
                )
            api_state["status"] = "completed"
            _persist_api_state(work_root, job, api_state)
            _sync_common_state(work_root, job, api_state)
            _upsert_review_queue(work_root, job)
            summary["completed"] += 1
            append_event(work_root, "api_job_completed", jobId=job["jobId"], paperId=job["paperId"])
        except TimeoutError as error:
            api_state["status"] = "partial"
            api_state["lastError"] = {"type": type(error).__name__, "message": safe_error_message(error)}
            _persist_api_state(work_root, job, api_state)
            _sync_common_state(work_root, job, api_state)
            summary["partial"] += 1
            append_event(work_root, "api_job_partial", jobId=job["jobId"], paperId=job["paperId"], document=failed_kind)
        except Exception as error:
            api_state["status"] = "quarantined"
            api_state["lastError"] = {
                "type": type(error).__name__,
                "message": safe_error_message(error),
                "document": failed_kind,
            }
            api_state["documents"].setdefault(failed_kind, {})["status"] = "quarantined"
            _persist_api_state(work_root, job, api_state)
            _sync_common_state(work_root, job, api_state)
            _write_failure(work_root, job, error, failed_kind)
            summary["quarantined"] += 1
            append_event(
                work_root,
                "api_job_quarantined",
                jobId=job["jobId"],
                paperId=job["paperId"],
                document=failed_kind,
                errorType=type(error).__name__,
                error=safe_error_message(error),
            )
            if fail_fast:
                raise
    append_event(work_root, "api_worker_finished", pid=os.getpid(), **summary)
    return summary


def build_dry_run_plan(
    work_root: Path,
    *,
    job_selector: str | None = None,
    max_jobs: int | None = None,
    daily_limit: int = DEFAULT_DAILY_PAGE_LIMIT,
    external_used_pages: int = 0,
) -> dict[str, Any]:
    jobs = _load_jsonl(work_root / "queue" / "ocr-jobs.jsonl")
    if job_selector:
        jobs = [job for job in jobs if job_selector in (job.get("jobId"), job.get("jobKey"), job.get("paperId"))]
    if max_jobs is not None:
        jobs = jobs[:max_jobs]
    pages = sum(
        int(job["documents"][kind]["pageCount"])
        for job in jobs
        for kind in ("qp", "ms")
    )
    if external_used_pages + pages > daily_limit:
        raise QuotaExceeded(f"planned submissions exceed daily quota: {external_used_pages + pages}/{daily_limit}")
    return {
        "status": "dry_run",
        "provider": "PaddleOCR official API",
        "model": MODEL,
        "jobs": len(jobs),
        "pages": pages,
        "externalUsedPages": external_used_pages,
        "dailyLimit": daily_limit,
        "remainingPages": daily_limit - external_used_pages - pages,
        "studentStudyEligible": False,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Resumable STEM PaddleOCR official API worker")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("dry-run", "run"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("--work-root", type=Path, default=Path(r"D:\CodexWork\stem-ocr-work"))
        command_parser.add_argument("--job", dest="job_selector")
        command_parser.add_argument("--max-jobs", type=int)
        command_parser.add_argument("--daily-page-limit", type=int, default=DEFAULT_DAILY_PAGE_LIMIT)
        command_parser.add_argument("--external-used-pages", type=int, default=0)
    run = subparsers.choices["run"]
    run.add_argument("--endpoint", default=API_URL)
    run.add_argument("--poll-interval", type=float, default=5.0)
    run.add_argument("--max-wait-seconds", type=float, default=7200.0)
    run.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    run.add_argument("--allow-resubmit-unknown", action="store_true")
    run.add_argument("--retry-quarantined", action="store_true")
    run.add_argument("--fail-fast", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        work_root = args.work_root.resolve()
        if args.command == "dry-run":
            result = build_dry_run_plan(
                work_root,
                job_selector=args.job_selector,
                max_jobs=args.max_jobs,
                daily_limit=args.daily_page_limit,
                external_used_pages=args.external_used_pages,
            )
        else:
            with WorkerLock(work_root / "locks" / "worker.lock"):
                result = {
                    "status": "run_finished",
                    **run_api_jobs(
                        work_root,
                        job_selector=args.job_selector,
                        max_jobs=args.max_jobs,
                        endpoint=args.endpoint,
                        daily_limit=args.daily_page_limit,
                        external_used_pages=args.external_used_pages,
                        poll_interval=args.poll_interval,
                        max_wait_seconds=args.max_wait_seconds,
                        dpi=args.dpi,
                        allow_resubmit_unknown=args.allow_resubmit_unknown,
                        retry_quarantined=args.retry_quarantined,
                        fail_fast=args.fail_fast,
                    ),
                }
        print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
        return 0
    except Exception as error:
        print(
            json.dumps(
                {"status": "failed", "errorType": type(error).__name__, "error": safe_error_message(error)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
            flush=True,
        )
        if os.environ.get("STEM_PADDLE_OCR_DEBUG") == "1":
            raise
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
