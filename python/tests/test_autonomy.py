"""Golden-fixture tests for the autonomy pure functions, using the stdlib
unittest runner (zero extra deps). Reads test/fixtures/autonomy-golden.json --
the SAME file the TS suite reads -- so /goal, /loop, and Auto Mode stay in sync
across the two language mirrors. autonomy.py imports only stdlib, so this runs on
a plain python3 without the anthropic/openai deps.

Run with `python3 python/tests/test_autonomy.py` (or `npm run test:py`)."""
import json
import sys
import unittest
from pathlib import Path

# repo layout: python/tests/test_autonomy.py -> python/ (add to path) -> repo/
_HERE = Path(__file__).resolve()
_PYTHON_DIR = _HERE.parent.parent
_REPO = _PYTHON_DIR.parent
sys.path.insert(0, str(_PYTHON_DIR))

from mini_claude import autonomy as a  # noqa: E402

GOLDEN = json.loads((_REPO / "test" / "fixtures" / "autonomy-golden.json").read_text(encoding="utf-8"))


class TestAutonomyGolden(unittest.TestCase):
    def test_parse_duration_to_seconds(self):
        for c in GOLDEN["parseDurationToSeconds"]:
            self.assertEqual(a.parse_duration_to_seconds(c["token"]), c["expected"], msg=f"token={c['token']}")

    def test_clamp_wakeup_delay(self):
        for c in GOLDEN["clampWakeupDelay"]:
            self.assertEqual(a.clamp_wakeup_delay(c["seconds"]), c["expected"], msg=f"seconds={c['seconds']}")

    def test_is_daily_wording(self):
        for c in GOLDEN["isDailyWording"]:
            self.assertEqual(a.is_daily_wording(c["raw"]), c["expected"], msg=f"raw={c['raw']}")

    def test_project_action_for_classifier(self):
        for c in GOLDEN["projectActionForClassifier"]:
            self.assertEqual(a.project_action_for_classifier(c["tool"], c["input"]), c["expected"], msg=f"tool={c['tool']}")

    def test_parse_goal_verdict(self):
        for c in GOLDEN["parseGoalVerdict"]:
            self.assertEqual(a.parse_goal_verdict(c["raw"]), c["expected"], msg=f"raw={c['raw']}")

    def test_parse_block_verdict(self):
        for c in GOLDEN["parseBlockVerdict"]:
            self.assertEqual(a.parse_block_verdict(c["raw"]), c["expected"], msg=f"raw={c['raw']}")

    def test_parse_loop_input(self):
        for c in GOLDEN["parseLoopInput"]:
            r = a.parse_loop_input(c["raw"])
            e = c["expected"]
            if "error" in e:
                self.assertEqual(r.get("error"), e["error"], msg=f"raw={c['raw']}")
                continue
            self.assertEqual(r["mode"], e["mode"], msg=f"raw={c['raw']} mode")
            self.assertEqual(r["prompt"], e["prompt"], msg=f"raw={c['raw']} prompt")
            if e["mode"] == "interval":
                self.assertEqual(r["interval_seconds"], e["seconds"], msg=f"raw={c['raw']} seconds")
                self.assertEqual(r["interval_label"], e["label"], msg=f"raw={c['raw']} label")

    def test_build_classifier_transcript(self):
        for c in GOLDEN["buildClassifierTranscript"]:
            out = a.build_classifier_transcript(c["history"], {"tool_name": c["pending"]["tool"], "input": c["pending"]["input"]})
            self.assertEqual(out, c["expected"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
