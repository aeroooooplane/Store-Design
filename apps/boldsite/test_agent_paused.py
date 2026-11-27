import os
import unittest
from unittest.mock import patch

from agent_paused import ai_budget, overview, update_settings
from contract import ApiError


class PausedAgentTests(unittest.TestCase):
    def test_configured_environment_cannot_enable_deferred_models(self):
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "fictional-test-only"}):
            result = overview()
        self.assertEqual(result["models"], [])
        self.assertIsNone(result["settings"]["agentModel"])
        self.assertFalse(result["settings"]["recognitionCloud"])
        self.assertEqual(ai_budget()["limitCny"], 0)

    def test_settings_cannot_enable_model_calls(self):
        with self.assertRaises(ApiError) as error:
            update_settings()
        self.assertEqual(error.exception.status, 400)
        self.assertIn("暂未接入", error.exception.message)
