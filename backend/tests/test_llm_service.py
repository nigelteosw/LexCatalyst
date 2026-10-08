import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.providers.openrouter import (
    DEFAULT_OPENROUTER_MODEL,
    OpenRouterKeyMissing,
    OpenRouterProvider,
)
from app.services import llm_service
from app.services.user_settings_service import llm_settings_payload


def _setting(**kw):
    key = kw.pop("openrouter_api_key", "sk-or-test-1234")
    base = dict(
        openrouter_api_key=key,
        openrouter_key_ciphertext="v2:stub" if key else None,
        openrouter_key_last4=key[-4:] if key else None,
        openrouter_key_label=None,
        openrouter_key_status="valid" if key else None,
        openrouter_key_verified_at=None,
        model_high=None,
        model_mid=None,
        feature_tiers={},
        favourite_models=[],
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _settings(demo=False, demo_key=None):
    return SimpleNamespace(
        demo_mode=demo,
        demo_openrouter_key=demo_key,
        openrouter_default_high=None,
        openrouter_default_mid=None,
    )


def _patch(setting, settings=None):
    return (
        patch("app.services.llm_service.get_user_setting", return_value=setting),
        patch("app.services.llm_service.get_settings", return_value=settings or _settings()),
    )


def _resolve(setting, **kw):
    p1, p2 = _patch(setting)
    with p1, p2:
        return llm_service.resolve_model(MagicMock(), "u", **kw)


class ResolveModelTests(unittest.TestCase):
    def test_explicit_model_wins(self) -> None:
        setting = _setting(feature_tiers={"lexchat": "high"}, model_high="a/high")
        self.assertEqual(_resolve(setting, feature="lexchat", tier="mid", model="x/y"), "x/y")

    def test_explicit_tier_beats_feature_tier(self) -> None:
        setting = _setting(feature_tiers={"lexchat": "high"}, model_high="a/high", model_mid="a/mid")
        self.assertEqual(_resolve(setting, feature="lexchat", tier="mid"), "a/mid")

    def test_user_feature_tier(self) -> None:
        setting = _setting(feature_tiers={"memory": "high"}, model_high="a/high", model_mid="a/mid")
        self.assertEqual(_resolve(setting, feature="memory"), "a/high")

    def test_feature_default_tier_and_env_defaults(self) -> None:
        self.assertEqual(_resolve(_setting(), feature="dream"), llm_service.DEFAULT_HIGH_MODEL)
        self.assertEqual(_resolve(_setting(), feature="lexchat"), DEFAULT_OPENROUTER_MODEL)
        self.assertEqual(_resolve(None, feature="lexchat"), DEFAULT_OPENROUTER_MODEL)

    def test_unknown_stored_tier_falls_back_to_default(self) -> None:
        setting = _setting(feature_tiers={"dream": "bogus"})
        self.assertEqual(_resolve(setting, feature="dream"), llm_service.DEFAULT_HIGH_MODEL)


class GetLlmTests(unittest.TestCase):
    def test_user_key_binds_resolved_model(self) -> None:
        p1, p2 = _patch(_setting(model_mid="x/y"))
        with p1, p2:
            provider = llm_service.get_llm(MagicMock(), "u", feature="birdie")
        self.assertIsInstance(provider, OpenRouterProvider)
        self.assertEqual(provider.model, "x/y")

    def test_no_key_raises(self) -> None:
        p1, p2 = _patch(None)
        with p1, p2, self.assertRaises(OpenRouterKeyMissing):
            llm_service.get_llm(MagicMock(), "u", feature="birdie")

    def test_demo_key_only_in_demo_mode(self) -> None:
        p1, p2 = _patch(None, _settings(demo=True, demo_key="sk-or-demo-9999"))
        with p1, p2:
            provider = llm_service.get_llm(MagicMock(), "u", feature="birdie")
        self.assertIsInstance(provider, OpenRouterProvider)
        p1, p2 = _patch(None, _settings(demo=False, demo_key="sk-or-demo-9999"))
        with p1, p2, self.assertRaises(OpenRouterKeyMissing):
            llm_service.get_llm(MagicMock(), "u", feature="birdie")

    def test_user_key_beats_demo_key(self) -> None:
        p1, p2 = _patch(_setting(), _settings(demo=True, demo_key="sk-or-demo-9999"))
        with p1, p2:
            _key, source = llm_service.key_for(_setting())
        self.assertEqual(source, "user")


class SettingsPayloadTests(unittest.TestCase):
    def test_never_exposes_the_key(self) -> None:
        with patch("app.services.llm_service.get_settings", return_value=_settings()):
            payload = llm_settings_payload(_setting(openrouter_api_key="sk-or-secret-abcd"))
        self.assertEqual(payload["key_last4"], "abcd")
        self.assertEqual(payload["key_source"], "user")
        self.assertNotIn("sk-or-secret", str(payload))

    def test_no_row(self) -> None:
        with patch("app.services.llm_service.get_settings", return_value=_settings()):
            payload = llm_settings_payload(None)
        self.assertFalse(payload["has_key"])
        self.assertIsNone(payload["key_source"])
        self.assertEqual(payload["feature_tiers"]["dream"], "high")
        self.assertEqual(len(payload["features"]), len(llm_service.FEATURES))


if __name__ == "__main__":
    unittest.main()
