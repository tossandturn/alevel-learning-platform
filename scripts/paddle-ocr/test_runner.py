from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


RUNNER_PATH = Path(__file__).with_name("runner.py")
WORKER_PATH = Path(__file__).with_name("worker.py")
SCHEMA_PATH = Path(__file__).with_name("schemas") / "paddle-ocr.schema.json"


def load_runner():
    if not RUNNER_PATH.is_file():
        raise AssertionError(f"runner is missing: {RUNNER_PATH}")
    import importlib.util

    spec = importlib.util.spec_from_file_location("stem_paddle_ocr_runner", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("could not load runner module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PaperSelectionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = load_runner()

    def test_component_and_year_policy_is_exact(self) -> None:
        eligible = self.runner.is_eligible_paper
        self.assertTrue(eligible("9702", 2021, 4))
        self.assertFalse(eligible("9702", 2021, 3))
        self.assertFalse(eligible("9702", 2021, 5))
        self.assertTrue(eligible("9709", 2025, 6))
        self.assertFalse(eligible("9709", 2025, 7))
        self.assertTrue(eligible("0580", 2023, 1))
        self.assertTrue(eligible("0580", 2023, 4))
        self.assertTrue(eligible("0625", 2024, 2))
        self.assertFalse(eligible("0625", 2024, 4))
        self.assertFalse(eligible("9702", 2020, 4))
        self.assertFalse(eligible("9702", 2026, 4))

    def test_9709_shared_components_keep_multiple_route_bindings(self) -> None:
        bindings = self.runner.route_bindings("9709", 4)
        self.assertEqual(
            [binding["qualificationStage"] for binding in bindings],
            ["AS", "A2"],
        )
        self.assertTrue(all(binding["reviewStatus"] == "pending_official_review" for binding in bindings))

    def test_structure_review_queue_requests_codex_not_qwen(self) -> None:
        row = self.runner.build_review_queue_row({
            "jobId": "sha256:" + "a" * 64,
            "paperId": "cie-0580-0580_s24_qp_12",
            "stagingArtifactPath": "artifacts/staging/paper/artifact.json",
        })

        self.assertEqual(row["providers"], ["codex"])
        self.assertNotIn("qwen", json.dumps(row).lower())

    def test_9709_route_bindings_use_registered_candidate_routes_not_generic_subject_routes(self) -> None:
        generic_routes = {"cie-9709-as-mathematics", "cie-9709-a2-mathematics"}

        p1_candidate_ids = [binding["routeCandidateId"] for binding in self.runner.route_bindings("9709", 1)]
        p3_candidate_ids = [binding["routeCandidateId"] for binding in self.runner.route_bindings("9709", 3)]
        all_candidate_ids = [
            binding["routeCandidateId"]
            for component in range(1, 7)
            for binding in self.runner.route_bindings("9709", component)
        ]

        self.assertEqual(
            p1_candidate_ids,
            ["cie-9709-as-p1-p2", "cie-9709-as-p1-p4", "cie-9709-as-p1-p5"],
        )
        self.assertEqual(
            p3_candidate_ids,
            [
                "cie-9709-a2-after-p1-p5-p3-p4",
                "cie-9709-a2-after-p1-p5-p3-p6",
                "cie-9709-a2-after-p1-p4-p3-p5",
            ],
        )
        self.assertTrue(generic_routes.isdisjoint(all_candidate_ids))
        self.assertTrue(all(
            binding["routeResolutionStatus"] == "candidate_requires_adapter_validation"
            for component in range(1, 7)
            for binding in self.runner.route_bindings("9709", component)
        ))

    def test_enumeration_requires_exact_qp_ms_filename_pair(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-selection-") as temporary:
            root = Path(temporary)
            for subject in ("9702", "9709", "0580", "0625"):
                (root / subject).mkdir(parents=True)

            names = (
                "9702/9702_m21_qp_42.pdf",
                "9702/9702_m21_ms_42.pdf",
                "9702/9702_s22_qp_52.pdf",
                "9702/9702_s22_ms_52.pdf",
                "9709/9709_w25_qp_41.pdf",
                "9709/9709_w25_ms_41.pdf",
                "0580/0580_s23_qp_12.pdf",
                "0580/0580_s23_ms_22.pdf",
                "0625/0625_s24_qp_21.pdf",
                "0625/0625_s24_ms_21.pdf",
            )
            for relative in names:
                path = root / relative
                path.write_bytes(relative.encode("ascii"))

            def inspect_pdf(path: Path) -> dict[str, object]:
                return {
                    "sha256": (path.name.encode("ascii").hex() + "0" * 64)[:64],
                    "pageCount": 3 if "_qp_" in path.name else 2,
                    "bytes": path.stat().st_size,
                }

            result = self.runner.enumerate_paper_pairs(root, inspect_pdf=inspect_pdf)
            self.assertEqual(
                [job["paperId"] for job in result["jobs"]],
                [
                    "cie-0625-0625_s24_qp_21",
                    "cie-9702-9702_m21_qp_42",
                    "cie-9709-9709_w25_qp_41",
                ],
            )
            self.assertEqual(result["stats"]["pairedJobs"], 3)
            self.assertEqual(result["stats"]["totalPages"], 15)
            self.assertEqual(result["exclusions"]["ineligibleComponent"], 1)
            self.assertEqual(result["exclusions"]["missingExactMarkScheme"], 1)


class ManifestAndRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = load_runner()

    def write_hash_file(self, path: Path, data: bytes) -> str:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return self.runner.sha256_file(path)

    def sample_job(self) -> dict[str, object]:
        return {
            "jobId": "sha256:" + "a" * 64,
            "jobKey": "a" * 64,
            "paperId": "cie-9702-9702_m21_qp_42",
            "subject": "9702",
            "year": 2021,
            "session": "m",
            "component": 4,
            "variant": 2,
            "routeBindings": self.runner.route_bindings("9702", 4),
            "documents": {
                "qp": {"path": "qp.pdf", "sha256": "b" * 64, "pageCount": 2, "bytes": 10},
                "ms": {"path": "ms.pdf", "sha256": "c" * 64, "pageCount": 1, "bytes": 9},
            },
            "statePath": "state/jobs/" + "a" * 64 + ".json",
            "ocrOutputRoot": "ocr/" + "a" * 64,
            "stagingArtifactPath": "artifacts/staging/cie-9702-9702_m21_qp_42/" + "a" * 64 + "/artifact.json",
            "quarantinePath": "artifacts/quarantine/cie-9702-9702_m21_qp_42/" + "a" * 64 + "/failure.json",
            "reviewStatus": "pending_ai_structure_review",
            "syllabusBindingStatus": "pending_official_review",
            "studentStudyEligible": False,
            "formalProgressEligible": False,
        }

    def test_stable_job_id_depends_on_paper_and_both_hashes_not_paths(self) -> None:
        first = self.runner.stable_job_identity("paper", "b" * 64, "c" * 64)
        second = self.runner.stable_job_identity("paper", "b" * 64, "c" * 64)
        changed = self.runner.stable_job_identity("paper", "b" * 64, "d" * 64)
        self.assertEqual(first, second)
        self.assertNotEqual(first, changed)
        self.assertRegex(first["jobId"], r"^sha256:[0-9a-f]{64}$")

    def test_initial_state_and_staging_artifact_can_never_be_ready(self) -> None:
        job = self.sample_job()
        state = self.runner.initial_job_state(job)
        artifact = self.runner.build_staging_artifact(job, state)
        self.assertEqual(state["status"], "pending")
        self.assertEqual(artifact["status"], "ocr-pending")
        self.assertEqual(artifact["reviewStatus"], "pending_ai_structure_review")
        self.assertEqual(artifact["syllabusBinding"]["status"], "pending_official_review")
        self.assertFalse(artifact["studentStudyEligible"])
        self.assertEqual(artifact["questionGroups"], [])

    def test_completed_document_is_skipped_when_resuming(self) -> None:
        job = self.sample_job()
        state = self.runner.initial_job_state(job)
        state["documents"]["qp"]["status"] = "completed"
        self.assertEqual(self.runner.pending_document_kinds(job, state), ["ms"])

    def test_atomic_json_and_jsonl_are_utf8_and_replace_existing_content(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-atomic-") as temporary:
            root = Path(temporary)
            json_path = root / "state.json"
            jsonl_path = root / "queue.jsonl"
            self.runner.atomic_write_json(json_path, {"value": "first"})
            self.runner.atomic_write_json(json_path, {"value": "复核"})
            self.runner.atomic_write_jsonl(jsonl_path, [{"id": 1}, {"id": 2}])
            self.assertEqual(json.loads(json_path.read_text(encoding="utf-8")), {"value": "复核"})
            self.assertEqual(len(jsonl_path.read_text(encoding="utf-8").splitlines()), 2)
            self.assertFalse(any(root.glob("*.tmp")))

    def test_failure_artifact_is_quarantined_and_not_student_eligible(self) -> None:
        job = self.sample_job()
        failure = self.runner.build_failure_artifact(job, "qp", RuntimeError("model failed"))
        self.assertEqual(failure["status"], "ocr-quarantined")
        self.assertEqual(failure["failedDocument"], "qp")
        self.assertFalse(failure["studentStudyEligible"])
        self.assertNotIn("traceback", failure)

    def test_worker_lock_prevents_two_queue_writers_and_releases_cleanly(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-lock-") as temporary:
            lock_path = Path(temporary) / "worker.lock"
            with self.runner.WorkerLock(lock_path):
                with self.assertRaisesRegex(RuntimeError, "already locked"):
                    with self.runner.WorkerLock(lock_path):
                        pass
            with self.runner.WorkerLock(lock_path):
                self.assertTrue(lock_path.is_file())

    def test_worker_lock_prevents_cross_process_queue_writer(self) -> None:
        script = """
import importlib.util
import pathlib
import sys

runner_path = pathlib.Path(sys.argv[1])
lock_path = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("stem_paddle_ocr_runner_child", runner_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
    with module.WorkerLock(lock_path):
        print("acquired")
        raise SystemExit(0)
except RuntimeError as error:
    print(str(error))
    raise SystemExit(17)
"""
        with tempfile.TemporaryDirectory(prefix="stem-paddle-lock-process-") as temporary:
            lock_path = Path(temporary) / "worker.lock"
            with self.runner.WorkerLock(lock_path):
                blocked = subprocess.run(
                    [sys.executable, "-c", script, str(RUNNER_PATH), str(lock_path)],
                    cwd=RUNNER_PATH.parent,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=15,
                    check=False,
                )
            released = subprocess.run(
                [sys.executable, "-c", script, str(RUNNER_PATH), str(lock_path)],
                cwd=RUNNER_PATH.parent,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=15,
                check=False,
            )
            self.assertEqual(blocked.returncode, 17, blocked.stdout + blocked.stderr)
            self.assertIn("already locked", blocked.stdout + blocked.stderr)
            self.assertEqual(released.returncode, 0, released.stdout + released.stderr)
            self.assertIn("acquired", released.stdout)

    def test_completed_page_record_requires_layout_blocks_path_and_hash(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-layout-integrity-") as temporary:
            root = Path(temporary)
            source_sha = self.write_hash_file(root / "source-page.png", b"source")
            raw_sha = self.write_hash_file(root / "paddle-result.json", b'{"ok":true}\n')
            markdown_sha = self.write_hash_file(root / "page.md", b"markdown\n")
            layout_sha = self.write_hash_file(root / "layout-blocks.json", b'{"blocks":[]}\n')
            record = {
                "status": "completed",
                "sourcePage": {"path": str(root / "source-page.png"), "sha256": source_sha},
                "rawResultPath": str(root / "paddle-result.json"),
                "rawResultSha256": raw_sha,
                "markdownPath": str(root / "page.md"),
                "markdownSha256": markdown_sha,
                "layoutBlocksPath": str(root / "layout-blocks.json"),
                "layoutBlocksSha256": "0" * 64,
            }
            self.assertFalse(self.runner._page_record_is_valid(record))
            record["layoutBlocksSha256"] = layout_sha
            self.assertTrue(self.runner._page_record_is_valid(record))
            (root / "layout-blocks.json").write_bytes(b'{"blocks":[{"bboxPx":[0,0,1,1]}]}\n')
            self.assertFalse(self.runner._page_record_is_valid(record))

    def test_source_pdf_hash_change_quarantines_job_and_logs_event(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-source-hash-") as temporary:
            root = Path(temporary)
            work_root = root / "work"
            job = self.sample_job()
            qp_path = root / "qp.pdf"
            ms_path = root / "ms.pdf"
            job["documents"]["qp"].update({"path": str(qp_path), "sha256": self.write_hash_file(qp_path, b"qp original"), "pageCount": 1})
            job["documents"]["ms"].update({"path": str(ms_path), "sha256": self.write_hash_file(ms_path, b"ms original"), "pageCount": 1})
            self.runner.atomic_write_jsonl(work_root / "queue" / "ocr-jobs.jsonl", [job])
            qp_path.write_bytes(b"qp changed")

            original_create_pipeline = self.runner.create_pipeline
            self.runner.create_pipeline = lambda device, pipeline_version: object()
            try:
                stderr = io.StringIO()
                with contextlib.redirect_stderr(stderr):
                    summary = self.runner.run_jobs(
                        work_root,
                        job_selector=None,
                        max_jobs=1,
                        max_pages=None,
                        device="gpu:0",
                        pipeline_version=self.runner.PIPELINE_VERSION,
                        dpi=self.runner.DEFAULT_DPI,
                        retry_quarantined=False,
                        fail_fast=False,
                    )
            finally:
                self.runner.create_pipeline = original_create_pipeline

            self.assertEqual(summary["quarantined"], 1)
            self.assertIn("SOURCE_PDF_HASH_CHANGED", stderr.getvalue())
            state = json.loads((work_root / job["statePath"]).read_text(encoding="utf-8"))
            failure = json.loads((work_root / job["quarantinePath"]).read_text(encoding="utf-8"))
            events = [
                json.loads(line)
                for line in (work_root / "logs" / "events.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(state["status"], "quarantined")
            self.assertEqual(state["failure"]["document"], "qp")
            self.assertEqual(failure["reasonCode"], "SOURCE_PDF_HASH_CHANGED")
            self.assertEqual(events[-2]["event"], "job_quarantined")
            self.assertEqual(events[-1]["event"], "worker_finished")

    def test_resume_reruns_damaged_page_bundle(self) -> None:
        class FakeResult:
            def json(self) -> dict[str, object]:
                return {
                    "res": {
                        "parsing_res_list": [
                            {"block_label": "text", "block_bbox": [0, 0, 50, 60]},
                        ],
                    },
                }

            def markdown(self) -> dict[str, object]:
                return {"text": "rerun markdown", "images": {}}

            def img(self) -> dict[str, object]:
                return {}

        class FakePipeline:
            def __init__(self) -> None:
                self.calls: list[str] = []

            def predict(self, image_path: str, **kwargs: object) -> list[FakeResult]:
                self.calls.append(image_path)
                return [FakeResult()]

        with tempfile.TemporaryDirectory(prefix="stem-paddle-resume-page-") as temporary:
            root = Path(temporary)
            work_root = root / "work"
            job = self.sample_job()
            qp_path = root / "qp.pdf"
            ms_path = root / "ms.pdf"
            job["documents"]["qp"].update({"path": str(qp_path), "sha256": self.write_hash_file(qp_path, b"qp pdf"), "pageCount": 1})
            job["documents"]["ms"].update({"path": str(ms_path), "sha256": self.write_hash_file(ms_path, b"ms pdf"), "pageCount": 1})
            state = self.runner.initial_job_state(job)
            state["status"] = "partial"
            state["documents"]["qp"]["status"] = "partial"
            page_dir = work_root / job["ocrOutputRoot"] / "qp" / "pages" / "0001"
            source_sha = self.write_hash_file(page_dir / "source-page.png", b"old source")
            raw_sha = self.write_hash_file(page_dir / "paddle-result.json", b'{"old":true}\n')
            markdown_sha = self.write_hash_file(page_dir / "page.md", b"old markdown\n")
            self.write_hash_file(page_dir / "layout-blocks.json", b'{"old":true}\n')
            state["documents"]["qp"]["pages"]["1"] = {
                "status": "completed",
                "sourcePage": {"path": str(page_dir / "source-page.png"), "sha256": source_sha},
                "rawResultPath": str(page_dir / "paddle-result.json"),
                "rawResultSha256": raw_sha,
                "markdownPath": str(page_dir / "page.md"),
                "markdownSha256": markdown_sha,
                "layoutBlocksPath": str(page_dir / "layout-blocks.json"),
                "layoutBlocksSha256": "0" * 64,
            }
            state["documents"]["qp"]["completedPages"] = [1]

            rendered_pages: list[int] = []

            def fake_render(pdf_path: Path, page_number: int, output_path: Path, dpi: int) -> dict[str, object]:
                rendered_pages.append(page_number)
                source_sha256 = self.write_hash_file(output_path, f"new source {page_number}".encode("ascii"))
                return {
                    "path": str(output_path),
                    "sha256": source_sha256,
                    "width": 100,
                    "height": 120,
                    "dpi": dpi,
                }

            original_render = self.runner._render_page
            self.runner._render_page = fake_render
            pipeline = FakePipeline()
            try:
                completed = self.runner._process_document(
                    pipeline,
                    job,
                    state,
                    "qp",
                    work_root,
                    self.runner.DEFAULT_DPI,
                    None,
                )
            finally:
                self.runner._render_page = original_render

            self.assertTrue(completed)
            self.assertEqual(rendered_pages, [1])
            self.assertEqual(len(pipeline.calls), 1)
            new_record = state["documents"]["qp"]["pages"]["1"]
            self.assertTrue(self.runner._page_record_is_valid(new_record))
            self.assertEqual((page_dir / "page.md").read_text(encoding="utf-8"), "rerun markdown")

    def test_run_jobs_writes_worker_job_page_and_review_events(self) -> None:
        class FakeResult:
            def json(self) -> dict[str, object]:
                return {"res": {"parsing_res_list": [{"block_label": "text", "block_bbox": [0, 0, 10, 10]}]}}

            def markdown(self) -> dict[str, object]:
                return {"text": "ok", "images": {}}

            def img(self) -> dict[str, object]:
                return {}

        class FakePipeline:
            def predict(self, image_path: str, **kwargs: object) -> list[FakeResult]:
                return [FakeResult()]

        with tempfile.TemporaryDirectory(prefix="stem-paddle-events-run-") as temporary:
            root = Path(temporary)
            work_root = root / "work"
            job = self.sample_job()
            qp_path = root / "qp.pdf"
            ms_path = root / "ms.pdf"
            job["documents"]["qp"].update({"path": str(qp_path), "sha256": self.write_hash_file(qp_path, b"qp pdf"), "pageCount": 1})
            job["documents"]["ms"].update({"path": str(ms_path), "sha256": self.write_hash_file(ms_path, b"ms pdf"), "pageCount": 1})
            self.runner.atomic_write_jsonl(work_root / "queue" / "ocr-jobs.jsonl", [job])

            def fake_render(pdf_path: Path, page_number: int, output_path: Path, dpi: int) -> dict[str, object]:
                source_sha256 = self.write_hash_file(output_path, f"{pdf_path.name} {page_number}".encode("ascii"))
                return {
                    "path": str(output_path),
                    "sha256": source_sha256,
                    "width": 80,
                    "height": 100,
                    "dpi": dpi,
                }

            original_create_pipeline = self.runner.create_pipeline
            original_render = self.runner._render_page
            self.runner.create_pipeline = lambda device, pipeline_version: FakePipeline()
            self.runner._render_page = fake_render
            try:
                summary = self.runner.run_jobs(
                    work_root,
                    job_selector=None,
                    max_jobs=1,
                    max_pages=None,
                    device="gpu:0",
                    pipeline_version=self.runner.PIPELINE_VERSION,
                    dpi=self.runner.DEFAULT_DPI,
                    retry_quarantined=False,
                    fail_fast=False,
                )
            finally:
                self.runner.create_pipeline = original_create_pipeline
                self.runner._render_page = original_render

            events = [
                json.loads(line)
                for line in (work_root / "logs" / "events.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(summary["completed"], 1)
            self.assertEqual(
                [event["event"] for event in events],
                [
                    "worker_started",
                    "job_started",
                    "page_completed",
                    "page_completed",
                    "job_completed",
                    "worker_finished",
                ],
            )
            artifact = json.loads((work_root / job["stagingArtifactPath"]).read_text(encoding="utf-8"))
            review_rows = [
                json.loads(line)
                for line in (work_root / "queue" / "structure-review.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(artifact["status"], "ocr-complete-pending-review")
            self.assertFalse(artifact["studentStudyEligible"])
            self.assertEqual(len(review_rows), 1)

    def test_machine_readable_contract_and_worker_entrypoint_exist(self) -> None:
        self.assertTrue(WORKER_PATH.is_file())
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(
            sorted(schema["$defs"]),
            ["document", "job", "jobState", "routeBinding", "stagingArtifact"],
        )
        self.assertIn("routeCandidateId", schema["$defs"]["routeBinding"]["required"])
        self.assertIn("studentStudyEligible", schema["$defs"]["stagingArtifact"]["required"])

    def test_structured_event_log_is_durable_jsonl(self) -> None:
        with tempfile.TemporaryDirectory(prefix="stem-paddle-events-") as temporary:
            work_root = Path(temporary)
            self.runner.append_event(work_root, "page_completed", paperId="paper", page=1)
            self.runner.append_event(work_root, "job_partial", paperId="paper")
            path = work_root / "logs" / "events.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual([row["event"] for row in rows], ["page_completed", "job_partial"])
            self.assertTrue(all(row["timestamp"].endswith("Z") for row in rows))


if __name__ == "__main__":
    unittest.main()
