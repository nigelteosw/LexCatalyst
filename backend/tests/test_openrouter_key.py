import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

from app.models import UserSetting
from app.providers import openrouter as orp
from app.services import secret_store as ss
from app.services import user_settings_service as svc
from app.services.openrouter_models import _parse


def _response(status: int, body: dict | None = None):
    response = MagicMock(status_code=status)
    response.json.return_value = body or {}
    return response


class CheckKeyTests(unittest.TestCase):
    def test_valid_key_returns_label(self) -> None:
        with patch.object(orp.requests, "get", return_value=_response(200, {"data": {"label": "sk-or-v1-…abcd"}})):
            self.assertEqual(orp.check_key("sk-or-v1-abcd").label, "sk-or-v1-…abcd")

    def test_rejected_key(self) -> None:
        with patch.object(orp.requests, "get", return_value=_response(401)):
            with self.assertRaises(orp.OpenRouterKeyRejected):
                orp.check_key("sk-or-v1-abcd")

    def test_network_failure_is_unverified_not_rejected(self) -> None:
        with patch.object(orp.requests, "get", side_effect=requests.ConnectionError("down")):
            with self.assertRaises(orp.OpenRouterKeyUnverified):
                orp.check_key("sk-or-v1-abcd")


class SettingsWriteTests(unittest.TestCase):
    def setUp(self) -> None:
        ss.clear_caches()
        self.addCleanup(ss.clear_caches)
        patcher = patch.object(
            ss,
            "get_settings",
            lambda: SimpleNamespace(
                jwt_secret_key="j" * 32,
                openrouter_key_encryption_key="s" * 32,
                openrouter_key_encryption_keys_old=[],
            ),
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _setting_with_key(self, key: str) -> UserSetting:
        setting = UserSetting(user_id="user-1", feature_tiers={}, favourite_models=[])
        setting.set_openrouter_key(key)
        setting.openrouter_key_status = "valid"
        return setting

    def test_rejected_replacement_keeps_working_key(self) -> None:
        setting = self._setting_with_key("sk-or-v1-original-1234")
        db = MagicMock()
        db.get.return_value = setting
        with patch.object(svc, "check_key", side_effect=orp.OpenRouterKeyRejected("nope")):
            with self.assertRaises(svc.InvalidOpenRouterKey):
                svc.update_llm_settings(
                    db, user_id="user-1", api_key="sk-or-v1-replacement-9999", fields_set={"openrouter_api_key"},
                    model_high=None, model_mid=None, feature_tiers=None,
                )
        self.assertEqual(setting.openrouter_api_key, "sk-or-v1-original-1234")
        self.assertEqual(setting.openrouter_key_last4, "1234")
        db.commit.assert_not_called()

    def test_unreachable_openrouter_stores_key_as_unchecked(self) -> None:
        setting = UserSetting(user_id="user-1", feature_tiers={}, favourite_models=[])
        db = MagicMock()
        db.get.return_value = setting
        with patch.object(svc, "check_key", side_effect=orp.OpenRouterKeyUnverified("offline")):
            svc.update_llm_settings(
                db, user_id="user-1", api_key="sk-or-v1-new-5678", fields_set=set(),
                model_high=None, model_mid=None, feature_tiers=None,
            )
        self.assertEqual(setting.openrouter_api_key, "sk-or-v1-new-5678")
        self.assertEqual(setting.openrouter_key_status, "unchecked")

    def test_favourites_are_deduplicated_and_capped(self) -> None:
        setting = UserSetting(user_id="user-1", feature_tiers={}, favourite_models=[])
        db = MagicMock()
        db.get.return_value = setting
        ids = [f"a/m{i}" for i in range(20)] + ["a/m0"]
        svc.update_llm_settings(
            db, user_id="user-1", api_key=None, fields_set=set(), model_high=None, model_mid=None,
            feature_tiers=None, favourite_models=ids,
        )
        self.assertEqual(len(setting.favourite_models), svc.MAX_FAVOURITES)
        self.assertEqual(len(set(setting.favourite_models)), svc.MAX_FAVOURITES)

    def test_malformed_key_is_refused_before_any_call(self) -> None:
        db = MagicMock()
        db.get.return_value = UserSetting(user_id="user-1", feature_tiers={}, favourite_models=[])
        with patch.object(svc, "check_key") as check:
            with self.assertRaises(svc.InvalidOpenRouterKey):
                svc.update_llm_settings(
                    db, user_id="user-1", api_key="not-a-key-at-all", fields_set=set(),
                    model_high=None, model_mid=None, feature_tiers=None,
                )
            check.assert_not_called()


class ModelParseTests(unittest.TestCase):
    def test_exposes_provider_completion_price_and_tools(self) -> None:
        models = _parse({"data": [{
            "id": "acme/tool-model", "name": "Acme Tool", "architecture": {"output_modalities": ["text"]},
            "pricing": {"prompt": "0.000001", "completion": "0.000004"},
            "supported_parameters": ["tools", "temperature"],
        }]})
        self.assertEqual(models[0]["provider"], "acme")
        self.assertEqual(models[0]["completion_price_per_million"], 4.0)
        self.assertTrue(models[0]["supports_tools"])


if __name__ == "__main__":
    unittest.main()
