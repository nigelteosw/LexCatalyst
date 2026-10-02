import unittest
from unittest.mock import MagicMock, patch

from app.services import openrouter_models as om


class ParseTests(unittest.TestCase):
    def test_filters_batch_and_non_text_and_sorts(self) -> None:
        payload = {
            "data": [
                {"id": "b/model", "name": "Zeta", "architecture": {"output_modalities": ["text"]}, "pricing": {"prompt": "0.000002"}, "context_length": 1000},
                {"id": "a/model:batch", "name": "Alpha batch", "architecture": {"output_modalities": ["text"]}},
                {"id": "c/image", "name": "Image", "architecture": {"output_modalities": ["image"]}},
                {"id": "a/model", "name": "Alpha", "architecture": {"output_modalities": ["text"]}},
            ]
        }
        models = om._parse(payload)
        self.assertEqual([m["id"] for m in models], ["a/model", "b/model"])
        self.assertEqual(models[1]["prompt_price_per_million"], 2.0)


class CacheTests(unittest.TestCase):
    def setUp(self) -> None:
        om._cache = None

    def test_falls_back_when_unreachable(self) -> None:
        with patch.object(om.requests, "get", side_effect=OSError("offline")):
            self.assertEqual(om.list_openrouter_models(), om.FALLBACK_MODELS)

    def test_caches_successful_fetch(self) -> None:
        response = MagicMock()
        response.json.return_value = {"data": [{"id": "a/b", "name": "A", "architecture": {"output_modalities": ["text"]}}]}
        with patch.object(om.requests, "get", return_value=response) as get:
            first = om.list_openrouter_models()
            second = om.list_openrouter_models()
        self.assertEqual(first, second)
        get.assert_called_once()

    def test_serves_stale_cache_when_refresh_fails(self) -> None:
        om._cache = (-1e9, [{"id": "stale/x", "name": "Stale"}])
        with patch.object(om.requests, "get", side_effect=OSError("offline")):
            self.assertEqual(om.list_openrouter_models()[0]["id"], "stale/x")


if __name__ == "__main__":
    unittest.main()
