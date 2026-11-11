import unittest
from unittest.mock import Mock

from channel_inventory import (
    Video,
    crawl_kryon,
    iso_date,
    parse_sam_index,
    session_number,
    summarize,
    video_id,
)


class ChannelInventoryTests(unittest.TestCase):
    def test_video_id_variants(self):
        self.assertEqual(video_id("https://youtu.be/abc123"), "abc123")
        self.assertEqual(video_id("https://www.youtube.com/watch?v=xyz789"), "xyz789")
        self.assertEqual(session_number("https://example.com/session-257"), 257)

    def test_kryon_adapter_extracts_real_row_shape(self):
        html = '''<table><tr><td>2020-001 Boulder, Colorado – JAN. 4, 2020
          <a href="https://youtu.be/jEAYqAFkyDU">"Duality – Part 1"</a></td></tr></table>'''
        session = Mock()
        session.get.return_value = Mock(status_code=200, text=html, content=html.encode(), apparent_encoding="utf-8")
        channel = {"name": "Kryon Lee Carroll", "inventorySources": ["http://kryon.com/u-tube/index-eng20.html"]}
        records = crawl_kryon(channel, session, 0)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].external_id, "jEAYqAFkyDU")
        self.assertEqual(records[0].upload_date, "2020-01-04")
        self.assertEqual(records[0].scope, "creator_index_2020")

    def test_sam_index_deduplicates_title_and_number_links(self):
        html = '''<a href="https://samtheillusionist.com/session-257">A real title</a>
          <a href="https://samtheillusionist.com/session-257">257</a>
          <a href="https://samtheillusionist.com/session-256">256</a>'''
        entries = parse_sam_index({"inventorySources": ["https://samtheillusionist.com/"]}, html)
        self.assertEqual(sorted(entries), [256, 257])
        self.assertEqual(entries[257]["title"], "A real title")

    def test_summary_does_not_overclaim_creator_index(self):
        channel = {"name": "Creator", "url": "https://example.com", "status": "verified"}
        records = [Video(channel="Creator", scope="creator_index_2020", external_id="a", title="A", webpage_url="https://example.com/a", source_url="https://example.com", upload_date="2020-01-01")]
        summary = summarize(channel, records, 1, [])
        self.assertEqual(summary["totalVideos"], 1)
        self.assertEqual(summary["earliestVideo"], "2020-01-01")
        self.assertFalse(summary["channelWideVerified"])

    def test_iso_date(self):
        self.assertEqual(iso_date("JAN", "4", "2020"), "2020-01-04")
        self.assertEqual(iso_date("JUNE", "8", "2019"), "2019-06-08")
        self.assertEqual(iso_date("SEPT", "13", "2019"), "2019-09-13")


if __name__ == "__main__":
    unittest.main()
