import json
from pathlib import Path
import tempfile
import unittest

from archiveshelf import (
    Segment,
    classify_error,
    manifest_complete,
    safe_name,
    timestamp,
    write_transcripts,
)


class ArchiveShelfTests(unittest.TestCase):
    def test_safe_name_removes_filesystem_hazards(self):
        self.assertEqual(safe_name('  A/B: C?*"<>|  '), "A B C")
        self.assertEqual(safe_name("..."), "Untitled")
        self.assertLessEqual(len(safe_name("x" * 500)), 110)

    def test_timestamp_rounding_and_srt_separator(self):
        self.assertEqual(timestamp(3661.2345), "01:01:01.234")
        self.assertEqual(timestamp(3661.2345, srt=True), "01:01:01,234")
        self.assertEqual(timestamp(-2), "00:00:00.000")

    def test_transcript_serializers(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            artifacts = write_transcripts(
                folder,
                [Segment(0, 1.25, "First line"), Segment(1.25, 2.5, "Second line")],
                {"title": "Fixture", "webpage_url": "https://example.com", "channel": "Tests"},
                "fixture",
            )
            self.assertEqual(
                set(artifacts),
                {"transcriptTxt", "transcriptMd", "transcriptJson", "transcriptSrt", "transcriptVtt"},
            )
            self.assertIn("First line Second line", (folder / "transcript.txt").read_text())
            self.assertIn("00:00:01,250 --> 00:00:02,500", (folder / "transcript.srt").read_text())
            payload = json.loads((folder / "transcript.json").read_text())
            self.assertEqual(payload["segments"][1]["text"], "Second line")
            self.assertFalse(manifest_complete(folder))

    def test_error_classification_does_not_suggest_bypass(self):
        self.assertEqual(classify_error("HTTP 429 Too Many Requests"), "rate_limited")
        self.assertEqual(classify_error("Private video. Sign in required"), "restricted")
        self.assertEqual(classify_error("Video unavailable"), "unavailable")


if __name__ == "__main__":
    unittest.main()
