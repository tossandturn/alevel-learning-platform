from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import traceback
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable


MANIFEST_SCHEMA = "stem-paddle-ocr-manifest.v1"
JOB_SCHEMA = "stem-paddle-ocr-job.v1"
STATE_SCHEMA = "stem-paddle-ocr-job-state.v1"
ARTIFACT_SCHEMA = "stem-paddle-ocr-staging-artifact.v1"
FAILURE_SCHEMA = "stem-paddle-ocr-quarantine.v1"
REVIEW_QUEUE_SCHEMA = "stem-paddle-ocr-structure-review.v1"
PIPELINE_VERSION = "v1.6"
ENGINE_NAME = "PaddleOCR-VL-1.6"
DEFAULT_PDF_ROOT = Path(r"D:\CodexWork\cie-fraft-fetcher\output\pdf")
DEFAULT_WORK_ROOT = Path(r"D:\CodexWork\stem-ocr-work")
DEFAULT_DPI = 180
TARGET_YEARS = range(2021, 2026)

PAPER_NAME_PATTERN = re.compile(
    r"^(?P<subject>\d{4})_(?P<session>[msw])(?P<year>\d{2})_qp_"
    r"(?P<component>\d)(?P<variant>\d)\.pdf$",
    re.IGNORECASE,
)

SUBJECT_POLICY: dict[str, dict[int, list[tuple[str, str, str]]]] = {
    "9702": {
        1: [("AS", "cie-9702-as-physics", "P1")],
        2: [("AS", "cie-9702-as-physics", "P2")],
        4: [("A2", "cie-9702-a2-physics", "P4")],
    },
    "9709": {
        1: [
            ("AS", "cie-9709-as-p1-p2", "P1"),
            ("AS", "cie-9709-as-p1-p4", "P1"),
            ("AS", "cie-9709-as-p1-p5", "P1"),
        ],
        2: [("AS", "cie-9709-as-p1-p2", "P2")],
        3: [
            ("A2", "cie-9709-a2-after-p1-p5-p3-p4", "P3"),
            ("A2", "cie-9709-a2-after-p1-p5-p3-p6", "P3"),
            ("A2", "cie-9709-a2-after-p1-p4-p3-p5", "P3"),
        ],
        4: [
            ("AS", "cie-9709-as-p1-p4", "M1"),
            ("A2", "cie-9709-a2-after-p1-p5-p3-p4", "M1"),
        ],
        5: [
            ("AS", "cie-9709-as-p1-p5", "S1"),
            ("A2", "cie-9709-a2-after-p1-p4-p3-p5", "S1"),
        ],
        6: [("A2", "cie-9709-a2-after-p1-p5-p3-p6", "S2")],
    },
    "0580": {
        component: [("IGCSE", "cie-0580-igcse-mathematics", f"P{component}")]
        for component in range(1, 5)
    },
    "0625": {
        2: [("IGCSE", "cie-0625-igcse-physics", "P2-theory")],
    },
}

_HELD_WORKER_LOCKS: set[Path] = set()


class SourcePdfHashChangedError(ValueError):
    pass


class WorkerLock:
    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        self.handle = None

    def __enter__(self):
        if self.path in _HELD_WORKER_LOCKS:
            raise RuntimeError(f"OCR queue is already locked: {self.path}")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        try:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            handle.close()
            raise RuntimeError(f"OCR queue is already locked: {self.path}") from error
        self.handle = handle
        _HELD_WORKER_LOCKS.add(self.path)
        metadata = json.dumps({"pid": os.getpid(), "acquiredAt": utc_now()}, separators=(",", ":"))
        handle.seek(0)
        handle.truncate()
        handle.write(metadata.encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())
        return self

    def __exit__(self, exc_type, exc_value, exc_traceback) -> None:
        handle = self.handle
        self.handle = None
        _HELD_WORKER_LOCKS.discard(self.path)
        if handle is None:
            return
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_pdf(path: Path) -> dict[str, object]:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(str(path))
    try:
        page_count = len(document)
    finally:
        document.close()
    if page_count <= 0:
        raise ValueError(f"PDF has no pages: {path}")
    return {
        "sha256": sha256_file(path),
        "pageCount": page_count,
        "bytes": path.stat().st_size,
    }


def parse_question_paper_name(name: str) -> dict[str, object] | None:
    match = PAPER_NAME_PATTERN.fullmatch(name)
    if not match:
        return None
    return {
        "subject": match.group("subject"),
        "session": match.group("session").lower(),
        "year": 2000 + int(match.group("year")),
        "component": int(match.group("component")),
        "variant": int(match.group("variant")),
    }


def is_eligible_paper(subject: str, year: int, component: int) -> bool:
    return year in TARGET_YEARS and component in SUBJECT_POLICY.get(subject, {})


def route_bindings(subject: str, component: int) -> list[dict[str, object]]:
    bindings = SUBJECT_POLICY.get(subject, {}).get(component, [])
    return [
        {
            "routeCandidateId": route_candidate_id,
            "routeResolutionStatus": "candidate_requires_adapter_validation",
            "qualificationStage": stage,
            "paper": paper,
            "component": component,
            "reviewStatus": "pending_official_review",
        }
        for stage, route_candidate_id, paper in bindings
    ]


def stable_job_identity(paper_id: str, qp_sha256: str, ms_sha256: str) -> dict[str, str]:
    canonical = {
        "paperId": paper_id.strip(),
        "questionPdfSha256": qp_sha256.lower(),
        "markSchemePdfSha256": ms_sha256.lower(),
    }
    encoded = json.dumps(canonical, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    return {"jobId": f"sha256:{digest}", "jobKey": digest}


def _relative_output_paths(paper_id: str, job_key: str) -> dict[str, str]:
    return {
        "statePath": f"state/jobs/{job_key}.json",
        "ocrOutputRoot": f"ocr/{job_key}",
        "stagingArtifactPath": f"artifacts/staging/{paper_id}/{job_key}/artifact.json",
        "quarantinePath": f"artifacts/quarantine/{paper_id}/{job_key}/failure.json",
    }


def enumerate_paper_pairs(
    pdf_root: Path,
    *,
    inspect_pdf: Callable[[Path], dict[str, object]] = inspect_pdf,
) -> dict[str, object]:
    root = pdf_root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"PDF root does not exist: {root}")

    exclusions = {
        "yearOutOfRange": 0,
        "ineligibleComponent": 0,
        "missingExactMarkScheme": 0,
        "malformedQuestionPaperName": 0,
        "inspectionFailed": 0,
    }
    exclusion_details: list[dict[str, object]] = []
    jobs: list[dict[str, object]] = []
    scanned_pdf_files = 0
    scanned_question_papers = 0

    for subject in sorted(SUBJECT_POLICY):
        subject_dir = root / subject
        if not subject_dir.is_dir():
            exclusion_details.append({"reason": "subjectDirectoryMissing", "subject": subject})
            continue
        scanned_pdf_files += sum(1 for path in subject_dir.rglob("*.pdf") if path.is_file())
        for qp_path in sorted(subject_dir.rglob("*_qp_*.pdf"), key=lambda path: path.name.lower()):
            if not qp_path.is_file():
                continue
            scanned_question_papers += 1
            parsed = parse_question_paper_name(qp_path.name)
            if parsed is None or parsed["subject"] != subject:
                exclusions["malformedQuestionPaperName"] += 1
                exclusion_details.append({"reason": "malformedQuestionPaperName", "path": str(qp_path)})
                continue
            year = int(parsed["year"])
            component = int(parsed["component"])
            if year not in TARGET_YEARS:
                exclusions["yearOutOfRange"] += 1
                continue
            if component not in SUBJECT_POLICY[subject]:
                exclusions["ineligibleComponent"] += 1
                exclusion_details.append({
                    "reason": "ineligibleComponent",
                    "path": str(qp_path),
                    "subject": subject,
                    "year": year,
                    "component": component,
                })
                continue

            ms_path = qp_path.with_name(qp_path.name.replace("_qp_", "_ms_", 1))
            if not ms_path.is_file():
                exclusions["missingExactMarkScheme"] += 1
                exclusion_details.append({
                    "reason": "missingExactMarkScheme",
                    "questionPaperPath": str(qp_path),
                    "expectedMarkSchemePath": str(ms_path),
                })
                continue

            try:
                qp_info = inspect_pdf(qp_path)
                ms_info = inspect_pdf(ms_path)
            except Exception as error:
                exclusions["inspectionFailed"] += 1
                exclusion_details.append({
                    "reason": "inspectionFailed",
                    "questionPaperPath": str(qp_path),
                    "markSchemePath": str(ms_path),
                    "errorType": type(error).__name__,
                    "error": safe_error_message(error),
                })
                continue

            paper_stem = qp_path.stem.lower()
            paper_id = f"cie-{subject}-{paper_stem}"
            identity = stable_job_identity(
                paper_id,
                str(qp_info["sha256"]),
                str(ms_info["sha256"]),
            )
            output_paths = _relative_output_paths(paper_id, identity["jobKey"])
            jobs.append({
                "schemaVersion": JOB_SCHEMA,
                **identity,
                "paperId": paper_id,
                "subject": subject,
                "year": year,
                "session": parsed["session"],
                "component": component,
                "variant": int(parsed["variant"]),
                "routeBindings": route_bindings(subject, component),
                "documents": {
                    "qp": {"path": str(qp_path.resolve()), **qp_info},
                    "ms": {"path": str(ms_path.resolve()), **ms_info},
                },
                **output_paths,
                "reviewStatus": "pending_ai_structure_review",
                "syllabusBindingStatus": "pending_official_review",
                "studentStudyEligible": False,
                "formalProgressEligible": False,
            })

    jobs.sort(key=lambda job: str(job["paperId"]))
    qp_pages = sum(int(job["documents"]["qp"]["pageCount"]) for job in jobs)
    ms_pages = sum(int(job["documents"]["ms"]["pageCount"]) for job in jobs)
    by_subject: dict[str, dict[str, int]] = {}
    for subject in sorted(SUBJECT_POLICY):
        subject_jobs = [job for job in jobs if job["subject"] == subject]
        by_subject[subject] = {
            "jobs": len(subject_jobs),
            "qpPages": sum(int(job["documents"]["qp"]["pageCount"]) for job in subject_jobs),
            "msPages": sum(int(job["documents"]["ms"]["pageCount"]) for job in subject_jobs),
        }
        by_subject[subject]["totalPages"] = by_subject[subject]["qpPages"] + by_subject[subject]["msPages"]

    return {
        "jobs": jobs,
        "stats": {
            "scannedPdfFiles": scanned_pdf_files,
            "scannedQuestionPapers": scanned_question_papers,
            "pairedJobs": len(jobs),
            "qpPages": qp_pages,
            "msPages": ms_pages,
            "totalPages": qp_pages + ms_pages,
            "bySubject": by_subject,
        },
        "exclusions": exclusions,
        "exclusionDetails": exclusion_details,
    }


def _atomic_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            newline="\n",
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=path.parent,
            delete=False,
        ) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def atomic_write_json(path: Path, value: object) -> None:
    _atomic_text(path, json.dumps(value, ensure_ascii=False, indent=2, default=_json_default) + "\n")


def atomic_write_jsonl(path: Path, rows: Iterable[object]) -> None:
    lines = [json.dumps(row, ensure_ascii=False, separators=(",", ":"), default=_json_default) for row in rows]
    _atomic_text(path, "\n".join(lines) + ("\n" if lines else ""))


def append_event(work_root: Path, event: str, **fields: object) -> None:
    path = work_root / "logs" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {"timestamp": utc_now(), "event": event, **fields}
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":"), default=_json_default))
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def _json_default(value: object) -> object:
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "tolist"):
        return value.tolist()
    if hasattr(value, "item"):
        return value.item()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def initial_job_state(job: dict[str, object]) -> dict[str, object]:
    now = utc_now()
    documents = job["documents"]
    return {
        "schemaVersion": STATE_SCHEMA,
        "jobId": job["jobId"],
        "paperId": job["paperId"],
        "status": "pending",
        "createdAt": now,
        "updatedAt": now,
        "attempts": 0,
        "documents": {
            kind: {
                "status": "pending",
                "sourceSha256": documents[kind]["sha256"],
                "pageCount": documents[kind]["pageCount"],
                "completedPages": [],
                "pages": {},
            }
            for kind in ("qp", "ms")
        },
    }


def pending_document_kinds(job: dict[str, object], state: dict[str, object]) -> list[str]:
    state_documents = state.get("documents", {})
    return [
        kind
        for kind in ("qp", "ms")
        if kind in job["documents"] and state_documents.get(kind, {}).get("status") != "completed"
    ]


def build_staging_artifact(job: dict[str, object], state: dict[str, object]) -> dict[str, object]:
    state_status = str(state.get("status", "pending"))
    status = {
        "pending": "ocr-pending",
        "running": "ocr-running",
        "partial": "ocr-partial",
        "completed": "ocr-complete-pending-review",
        "quarantined": "ocr-quarantined",
    }.get(state_status, "ocr-pending")
    return {
        "schemaVersion": ARTIFACT_SCHEMA,
        "artifactId": job["jobId"],
        "paperId": job["paperId"],
        "subject": job["subject"],
        "year": job["year"],
        "session": job["session"],
        "component": job["component"],
        "variant": job["variant"],
        "status": status,
        "reviewStatus": "pending_ai_structure_review",
        "syllabusBinding": {
            "status": "pending_official_review",
            "routeBindings": job["routeBindings"],
            "topicIds": [],
        },
        "sourcePair": {
            "bindingMethod": "exact_filename_substitution_and_sha256",
            "questionPaper": job["documents"]["qp"],
            "markScheme": job["documents"]["ms"],
        },
        "ocr": {
            "engine": ENGINE_NAME,
            "pipelineVersion": PIPELINE_VERSION,
            "executionMode": "local_gpu",
            "statePath": job.get("statePath", f"state/jobs/{job['jobKey']}.json"),
            "outputRoot": job.get("ocrOutputRoot", f"ocr/{job['jobKey']}"),
            "documents": state.get("documents", {}),
        },
        "questionGroups": [],
        "studentStudyEligible": False,
        "formalProgressEligible": False,
        "requiredReview": [
            "whole_question_boundaries",
            "question_part_structure",
            "qp_ms_question_binding",
            "diagram_region_integrity",
            "official_syllabus_topic_binding",
        ],
        "updatedAt": state.get("updatedAt", utc_now()),
    }


def safe_error_message(error: BaseException) -> str:
    message = str(error).replace("\r", " ").replace("\n", " ")[:1000]
    message = re.sub(r"(?i)(authorization|bearer|token|api[_-]?key)\s*[:=]?\s*\S+", r"\1=[redacted]", message)
    return message


def build_failure_artifact(job: dict[str, object], document_kind: str, error: BaseException) -> dict[str, object]:
    return {
        "schemaVersion": FAILURE_SCHEMA,
        "artifactId": job["jobId"],
        "paperId": job["paperId"],
        "status": "ocr-quarantined",
        "failedDocument": document_kind,
        "reasonCode": failure_reason_code(error),
        "errorType": type(error).__name__,
        "error": safe_error_message(error),
        "sourcePair": {
            "questionPdfSha256": job["documents"]["qp"]["sha256"],
            "markSchemePdfSha256": job["documents"]["ms"]["sha256"],
        },
        "studentStudyEligible": False,
        "formalProgressEligible": False,
        "createdAt": utc_now(),
    }


def _load_json(path: Path) -> dict[str, object]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise TypeError(f"Expected JSON object: {path}")
    return value


def _load_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise TypeError(f"Expected JSON object at {path}:{line_number}")
            rows.append(value)
    return rows


def _work_path(work_root: Path, relative: str) -> Path:
    root = work_root.resolve()
    target = (root / Path(PurePosixPath(relative))).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Output path escapes work root: {relative}")
    return target


def _initialize_job_files(work_root: Path, job: dict[str, object]) -> None:
    state_path = _work_path(work_root, str(job["statePath"]))
    if state_path.exists():
        state = _load_json(state_path)
        if state.get("jobId") != job["jobId"]:
            raise ValueError(f"State jobId mismatch: {state_path}")
    else:
        state = initial_job_state(job)
        atomic_write_json(state_path, state)
    artifact_path = _work_path(work_root, str(job["stagingArtifactPath"]))
    atomic_write_json(artifact_path, build_staging_artifact(job, state))


def build_manifest(pdf_root: Path, work_root: Path) -> dict[str, object]:
    enumeration = enumerate_paper_pairs(pdf_root)
    generated_at = utc_now()
    manifest = {
        "schemaVersion": MANIFEST_SCHEMA,
        "generatedAt": generated_at,
        "sourceRoot": str(pdf_root.resolve()),
        "workRoot": str(work_root.resolve()),
        "engine": {
            "name": ENGINE_NAME,
            "pipelineVersion": PIPELINE_VERSION,
            "executionMode": "local_gpu",
            "officialApiUsed": False,
            "officialApiPagesConsumed": 0,
        },
        "selection": {
            "years": list(TARGET_YEARS),
            "subjects": {
                subject: sorted(components)
                for subject, components in SUBJECT_POLICY.items()
            },
            "pairing": "exact_same_directory_qp_to_ms_filename_substitution",
        },
        "readiness": {
            "status": "ocr_queue_only",
            "studentStudyEligible": False,
            "syllabusBindingStatus": "pending_official_review",
            "bulkApprovalAllowed": False,
        },
        "stats": enumeration["stats"],
        "exclusions": enumeration["exclusions"],
        "paths": {
            "queue": "queue/ocr-jobs.jsonl",
            "reviewQueue": "queue/structure-review.jsonl",
            "states": "state/jobs",
            "stagingArtifacts": "artifacts/staging",
            "quarantine": "artifacts/quarantine",
        },
        "jobs": enumeration["jobs"],
    }
    work_root.mkdir(parents=True, exist_ok=True)
    for job in enumeration["jobs"]:
        _initialize_job_files(work_root, job)
    atomic_write_json(work_root / "manifest" / "manifest.json", manifest)
    atomic_write_jsonl(work_root / "manifest" / "exclusions.jsonl", enumeration["exclusionDetails"])
    atomic_write_jsonl(work_root / "queue" / "ocr-jobs.jsonl", enumeration["jobs"])
    review_queue = work_root / "queue" / "structure-review.jsonl"
    if not review_queue.exists():
        atomic_write_jsonl(review_queue, [])
    return manifest


def _render_page(pdf_path: Path, page_number: int, output_path: Path, dpi: int) -> dict[str, object]:
    import pypdfium2 as pdfium
    from PIL import Image

    output_path.parent.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(pdf_path))
    try:
        if page_number < 1 or page_number > len(document):
            raise IndexError(f"Page {page_number} is outside PDF page count {len(document)}")
        page = document[page_number - 1]
        try:
            bitmap = page.render(scale=dpi / 72.0, rev_byteorder=True)
            try:
                image = bitmap.to_pil().convert("RGB")
                temporary = output_path.with_name(f".{output_path.name}.{os.getpid()}.tmp.png")
                try:
                    image.save(temporary, format="PNG", optimize=False)
                    os.replace(temporary, output_path)
                finally:
                    image.close()
                    if temporary.exists():
                        temporary.unlink()
            finally:
                bitmap.close()
        finally:
            page.close()
    finally:
        document.close()
    with Image.open(output_path) as image:
        width, height = image.size
    return {
        "path": str(output_path),
        "sha256": sha256_file(output_path),
        "width": width,
        "height": height,
        "dpi": dpi,
    }


def _safe_asset_path(page_dir: Path, requested: str, fallback: str) -> Path:
    normalized = requested.replace("\\", "/").strip("/")
    pure = PurePosixPath(normalized)
    if not normalized or pure.is_absolute() or ".." in pure.parts or ":" in normalized:
        pure = PurePosixPath(fallback)
    target = (page_dir / Path(pure)).resolve()
    page_root = page_dir.resolve()
    if page_root not in target.parents:
        target = page_root / fallback
    return target


def _save_image(value: object, path: Path, *, bgr: bool = False) -> None:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(value, Image.Image):
        image = value.convert("RGB")
    else:
        array = value
        if hasattr(array, "ndim") and getattr(array, "ndim") == 3 and bgr:
            array = array[:, :, ::-1]
        image = Image.fromarray(array).convert("RGB")
    try:
        image.save(path)
    finally:
        image.close()


def _result_json(result: object) -> dict[str, object]:
    value = getattr(result, "json")
    if callable(value):
        value = value()
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise TypeError("PaddleOCR result.json must be an object")
    return value


def _bbox_from(value: object) -> list[float] | None:
    if not isinstance(value, (list, tuple)):
        return None
    if len(value) == 4 and all(isinstance(item, (int, float)) for item in value):
        return [float(item) for item in value]
    if len(value) >= 4 and all(isinstance(item, (list, tuple)) and len(item) >= 2 for item in value):
        xs = [float(item[0]) for item in value]
        ys = [float(item[1]) for item in value]
        return [min(xs), min(ys), max(xs), max(ys)]
    return None


def extract_layout_blocks(payload: dict[str, object], width: int, height: int) -> list[dict[str, object]]:
    candidates: list[object] = []
    root = payload.get("res", payload)
    if isinstance(root, dict):
        parsing = root.get("parsing_res_list")
        if isinstance(parsing, list):
            candidates.extend(parsing)
        layout = root.get("layout_det_res")
        if isinstance(layout, dict):
            boxes = layout.get("boxes")
            if isinstance(boxes, list):
                candidates.extend(boxes)
    blocks: list[dict[str, object]] = []
    for index, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            continue
        bbox = None
        for key in ("block_bbox", "bbox", "coordinate", "polygon_points"):
            bbox = _bbox_from(candidate.get(key))
            if bbox is not None:
                break
        if bbox is None:
            continue
        x0, y0, x1, y1 = bbox
        x0, x1 = max(0.0, min(x0, width)), max(0.0, min(x1, width))
        y0, y1 = max(0.0, min(y0, height)), max(0.0, min(y1, height))
        if x0 >= x1 or y0 >= y1:
            continue
        blocks.append({
            "index": index,
            "label": candidate.get("block_label") or candidate.get("label") or "unknown",
            "bboxPx": [x0, y0, x1, y1],
            "region": {
                "x0": x0 / width,
                "y0": y0 / height,
                "x1": x1 / width,
                "y1": y1 / height,
            },
        })
    return blocks


def _save_result_bundle(result: object, page_dir: Path, source_page: dict[str, object]) -> dict[str, object]:
    payload = _result_json(result)
    raw_json_path = page_dir / "paddle-result.json"
    atomic_write_json(raw_json_path, payload)
    blocks_path = page_dir / "layout-blocks.json"
    blocks = extract_layout_blocks(payload, int(source_page["width"]), int(source_page["height"]))
    atomic_write_json(blocks_path, {"page": source_page, "blocks": blocks})

    markdown_value = getattr(result, "markdown", {})
    if callable(markdown_value):
        markdown_value = markdown_value()
    markdown_text = ""
    markdown_images: dict[str, object] = {}
    if isinstance(markdown_value, dict):
        markdown_text = str(
            markdown_value.get("markdown_texts")
            or markdown_value.get("markdown_text")
            or markdown_value.get("text")
            or ""
        )
        for key in ("markdown_images", "images"):
            value = markdown_value.get(key)
            if isinstance(value, dict):
                markdown_images.update(value)
    markdown_path = page_dir / "page.md"
    _atomic_text(markdown_path, markdown_text)

    assets: list[dict[str, object]] = []
    for index, (requested, image) in enumerate(sorted(markdown_images.items())):
        target = _safe_asset_path(page_dir, str(requested), f"images/image-{index + 1:03d}.png")
        _save_image(image, target)
        assets.append({
            "kind": "markdown-image",
            "path": str(target),
            "sha256": sha256_file(target),
        })

    result_images = getattr(result, "img", {})
    if callable(result_images):
        result_images = result_images()
    if isinstance(result_images, dict):
        for index, (name, image) in enumerate(sorted(result_images.items())):
            safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", str(name)).strip(".-") or f"image-{index + 1}"
            target = page_dir / "visualizations" / f"{safe_name}.jpg"
            _save_image(image, target, bgr=True)
            assets.append({
                "kind": "paddle-visualization",
                "path": str(target),
                "sha256": sha256_file(target),
            })

    return {
        "sourcePage": source_page,
        "rawResultPath": str(raw_json_path),
        "rawResultSha256": sha256_file(raw_json_path),
        "markdownPath": str(markdown_path),
        "markdownSha256": sha256_file(markdown_path),
        "layoutBlocksPath": str(blocks_path),
        "layoutBlocksSha256": sha256_file(blocks_path),
        "layoutBlockCount": len(blocks),
        "assets": assets,
    }


def create_pipeline(device: str, pipeline_version: str = PIPELINE_VERSION):
    from paddleocr import PaddleOCRVL

    return PaddleOCRVL(
        pipeline_version=pipeline_version,
        device=device,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_chart_recognition=False,
        use_ocr_for_image_block=False,
    )


def _verify_source(document: dict[str, object]) -> None:
    path = Path(str(document["path"]))
    if not path.is_file():
        raise FileNotFoundError(f"Source PDF is missing: {path}")
    actual = sha256_file(path)
    if actual != document["sha256"]:
        raise SourcePdfHashChangedError(f"Source PDF SHA-256 changed: {path}")


def failure_reason_code(error: BaseException) -> str:
    if isinstance(error, SourcePdfHashChangedError):
        return "SOURCE_PDF_HASH_CHANGED"
    return "PADDLE_OCR_EXECUTION_FAILED"


def _page_record_is_valid(record: object) -> bool:
    if not isinstance(record, dict) or record.get("status") != "completed":
        return False
    for key, hash_key in (
        ("rawResultPath", "rawResultSha256"),
        ("markdownPath", "markdownSha256"),
        ("layoutBlocksPath", "layoutBlocksSha256"),
    ):
        path = Path(str(record.get(key, "")))
        if not path.is_file() or sha256_file(path) != record.get(hash_key):
            return False
    source = record.get("sourcePage")
    if not isinstance(source, dict):
        return False
    path = Path(str(source.get("path", "")))
    return path.is_file() and sha256_file(path) == source.get("sha256")


def _process_document(
    pipeline: object,
    job: dict[str, object],
    state: dict[str, object],
    kind: str,
    work_root: Path,
    dpi: int,
    page_budget: list[int] | None,
) -> bool:
    document = job["documents"][kind]
    _verify_source(document)
    document_state = state["documents"][kind]
    document_state["status"] = "running"
    state["updatedAt"] = utc_now()
    atomic_write_json(_work_path(work_root, str(job["statePath"])), state)

    for page_number in range(1, int(document["pageCount"]) + 1):
        key = str(page_number)
        existing = document_state["pages"].get(key)
        if _page_record_is_valid(existing):
            continue
        if page_budget is not None and page_budget[0] <= 0:
            document_state["status"] = "partial"
            return False

        page_dir = _work_path(work_root, str(job["ocrOutputRoot"])) / kind / "pages" / f"{page_number:04d}"
        source_image_path = page_dir / "source-page.png"
        source_page = _render_page(Path(str(document["path"])), page_number, source_image_path, dpi)
        source_page["page"] = page_number
        results = list(pipeline.predict(
            str(source_image_path),
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_chart_recognition=False,
            use_ocr_for_image_block=False,
        ))
        if len(results) != 1:
            raise RuntimeError(f"Expected one PaddleOCR result for page {page_number}, got {len(results)}")
        record = _save_result_bundle(results[0], page_dir, source_page)
        record["status"] = "completed"
        record["completedAt"] = utc_now()
        document_state["pages"][key] = record
        document_state["completedPages"] = sorted(
            int(number)
            for number, value in document_state["pages"].items()
            if _page_record_is_valid(value)
        )
        state["updatedAt"] = utc_now()
        atomic_write_json(_work_path(work_root, str(job["statePath"])), state)
        append_event(
            work_root,
            "page_completed",
            jobId=job["jobId"],
            paperId=job["paperId"],
            document=kind,
            page=page_number,
            pageCount=document["pageCount"],
        )
        if page_budget is not None:
            page_budget[0] -= 1

    document_state["status"] = "completed"
    document_state["completedAt"] = utc_now()
    return True


def _upsert_review_queue(work_root: Path, row: dict[str, object]) -> None:
    path = work_root / "queue" / "structure-review.jsonl"
    rows = _load_jsonl(path) if path.exists() else []
    by_id = {str(existing["reviewId"]): existing for existing in rows}
    by_id[str(row["reviewId"])] = row
    atomic_write_jsonl(path, [by_id[key] for key in sorted(by_id)])


def build_review_queue_row(job: dict[str, object]) -> dict[str, object]:
    return {
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


def run_jobs(
    work_root: Path,
    *,
    job_selector: str | None,
    max_jobs: int | None,
    max_pages: int | None,
    device: str,
    pipeline_version: str,
    dpi: int,
    retry_quarantined: bool,
    fail_fast: bool,
) -> dict[str, object]:
    queue_path = work_root / "queue" / "ocr-jobs.jsonl"
    if not queue_path.is_file():
        raise FileNotFoundError(f"OCR queue is missing; run manifest first: {queue_path}")
    jobs = _load_jsonl(queue_path)
    if job_selector:
        jobs = [
            job for job in jobs
            if job_selector in (job["jobId"], job["jobKey"], job["paperId"])
        ]
        if not jobs:
            raise KeyError(f"No queue job matches: {job_selector}")
    if max_jobs is not None:
        jobs = jobs[:max_jobs]

    pipeline = None
    completed = 0
    partial = 0
    skipped = 0
    quarantined = 0
    page_budget = [max_pages] if max_pages is not None else None
    append_event(
        work_root,
        "worker_started",
        pid=os.getpid(),
        selectedJobs=len(jobs),
        maxPages=max_pages,
        device=device,
        pipelineVersion=pipeline_version,
    )

    for job in jobs:
        state_path = _work_path(work_root, str(job["statePath"]))
        state = _load_json(state_path) if state_path.exists() else initial_job_state(job)
        if state.get("status") == "completed":
            skipped += 1
            continue
        if state.get("status") == "quarantined" and not retry_quarantined:
            skipped += 1
            continue
        if page_budget is not None and page_budget[0] <= 0:
            break
        state["status"] = "running"
        state["attempts"] = int(state.get("attempts", 0)) + 1
        state["updatedAt"] = utc_now()
        atomic_write_json(state_path, state)
        append_event(work_root, "job_started", jobId=job["jobId"], paperId=job["paperId"], attempt=state["attempts"])
        if pipeline is None:
            pipeline = create_pipeline(device, pipeline_version)

        failed_kind = "unknown"
        try:
            all_completed = True
            for kind in pending_document_kinds(job, state):
                failed_kind = kind
                if not _process_document(pipeline, job, state, kind, work_root, dpi, page_budget):
                    all_completed = False
                    break
            state["status"] = "completed" if all_completed else "partial"
            state["updatedAt"] = utc_now()
            atomic_write_json(state_path, state)
            artifact = build_staging_artifact(job, state)
            atomic_write_json(_work_path(work_root, str(job["stagingArtifactPath"])), artifact)
            if all_completed:
                _upsert_review_queue(work_root, build_review_queue_row(job))
                completed += 1
                append_event(work_root, "job_completed", jobId=job["jobId"], paperId=job["paperId"])
            else:
                partial += 1
                append_event(work_root, "job_partial", jobId=job["jobId"], paperId=job["paperId"])
        except Exception as error:
            state["status"] = "quarantined"
            state["updatedAt"] = utc_now()
            state["failure"] = {
                "document": failed_kind,
                "reasonCode": failure_reason_code(error),
                "errorType": type(error).__name__,
                "error": safe_error_message(error),
            }
            if failed_kind in state.get("documents", {}):
                state["documents"][failed_kind]["status"] = "quarantined"
            atomic_write_json(state_path, state)
            atomic_write_json(
                _work_path(work_root, str(job["quarantinePath"])),
                build_failure_artifact(job, failed_kind, error),
            )
            atomic_write_json(
                _work_path(work_root, str(job["stagingArtifactPath"])),
                build_staging_artifact(job, state),
            )
            quarantined += 1
            append_event(
                work_root,
                "job_quarantined",
                jobId=job["jobId"],
                paperId=job["paperId"],
                document=failed_kind,
                reasonCode=failure_reason_code(error),
                errorType=type(error).__name__,
                error=safe_error_message(error),
            )
            print(
                json.dumps({
                    "event": "job_quarantined",
                    "paperId": job["paperId"],
                    "document": failed_kind,
                    "reasonCode": failure_reason_code(error),
                    "errorType": type(error).__name__,
                    "error": safe_error_message(error),
                }, ensure_ascii=False),
                file=sys.stderr,
                flush=True,
            )
            if fail_fast:
                raise

    summary = {
        "selectedJobs": len(jobs),
        "completed": completed,
        "partial": partial,
        "skipped": skipped,
        "quarantined": quarantined,
        "remainingPageBudget": page_budget[0] if page_budget is not None else None,
    }
    append_event(work_root, "worker_finished", pid=os.getpid(), **summary)
    return summary


def status_summary(work_root: Path) -> dict[str, object]:
    queue_path = work_root / "queue" / "ocr-jobs.jsonl"
    jobs = _load_jsonl(queue_path) if queue_path.exists() else []
    counts: dict[str, int] = {}
    completed_pages = 0
    total_pages = sum(
        int(job["documents"][kind]["pageCount"])
        for job in jobs
        for kind in ("qp", "ms")
    )
    failures: list[dict[str, object]] = []
    for job in jobs:
        state_path = _work_path(work_root, str(job["statePath"]))
        status = "missing-state"
        if state_path.exists():
            state = _load_json(state_path)
            status = str(state.get("status", "unknown"))
            for document in state.get("documents", {}).values():
                completed_pages += len(document.get("completedPages", []))
            if state.get("failure"):
                failures.append({"paperId": job["paperId"], **state["failure"]})
        counts[status] = counts.get(status, 0) + 1
    review_path = work_root / "queue" / "structure-review.jsonl"
    review_rows = _load_jsonl(review_path) if review_path.exists() else []
    return {
        "workRoot": str(work_root.resolve()),
        "jobs": len(jobs),
        "jobStatus": dict(sorted(counts.items())),
        "pages": {
            "completed": completed_pages,
            "total": total_pages,
            "remaining": max(0, total_pages - completed_pages),
        },
        "pendingStructureReviews": sum(row.get("status") == "pending_provider_review" for row in review_rows),
        "studentStudyEligible": 0,
        "failures": failures,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Resumable local PaddleOCR-VL 1.6 queue for STEM QP/MS paper pairs"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command, help_text in (
        ("manifest", "Enumerate exact QP/MS pairs and initialize queue/state"),
        ("dry-run", "Generate the manifest and queue without OCR execution"),
    ):
        manifest = subparsers.add_parser(command, help=help_text)
        manifest.add_argument("--pdf-root", type=Path, default=DEFAULT_PDF_ROOT)
        manifest.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)

    run = subparsers.add_parser("run", help="Run or resume local PaddleOCR-VL jobs")
    run.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)
    run.add_argument("--job", dest="job_selector")
    run.add_argument("--max-jobs", type=int)
    run.add_argument("--max-pages", type=int)
    run.add_argument("--device", default="gpu:0")
    run.add_argument("--pipeline-version", default=PIPELINE_VERSION)
    run.add_argument("--dpi", type=int, default=DEFAULT_DPI)
    run.add_argument("--retry-quarantined", action="store_true")
    run.add_argument("--fail-fast", action="store_true")

    status = subparsers.add_parser("status", help="Summarize resumable queue state")
    status.add_argument("--work-root", type=Path, default=DEFAULT_WORK_ROOT)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command in ("manifest", "dry-run"):
            manifest = build_manifest(args.pdf_root, args.work_root)
            output = {
                "status": "dry_run_ready" if args.command == "dry-run" else "manifest_ready",
                "manifest": str((args.work_root / "manifest" / "manifest.json").resolve()),
                "queue": str((args.work_root / "queue" / "ocr-jobs.jsonl").resolve()),
                "stats": manifest["stats"],
                "exclusions": manifest["exclusions"],
                "studentStudyEligible": False,
            }
        elif args.command == "run":
            if args.max_jobs is not None and args.max_jobs <= 0:
                raise ValueError("--max-jobs must be positive")
            if args.max_pages is not None and args.max_pages <= 0:
                raise ValueError("--max-pages must be positive")
            if args.dpi <= 0 or args.dpi > 300:
                raise ValueError("--dpi must be between 1 and 300")
            with WorkerLock(args.work_root / "locks" / "worker.lock"):
                output = {
                    "status": "run_finished",
                    **run_jobs(
                        args.work_root,
                        job_selector=args.job_selector,
                        max_jobs=args.max_jobs,
                        max_pages=args.max_pages,
                        device=args.device,
                        pipeline_version=args.pipeline_version,
                        dpi=args.dpi,
                        retry_quarantined=args.retry_quarantined,
                        fail_fast=args.fail_fast,
                    ),
                }
        else:
            output = status_summary(args.work_root)
        print(json.dumps(output, ensure_ascii=False, indent=2), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({
            "status": "failed",
            "errorType": type(error).__name__,
            "error": safe_error_message(error),
        }, ensure_ascii=False), file=sys.stderr, flush=True)
        if os.environ.get("STEM_PADDLE_OCR_DEBUG") == "1":
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
