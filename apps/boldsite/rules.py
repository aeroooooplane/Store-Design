import json
from pathlib import Path
from threading import BoundedSemaphore

from contract import ApiError


class Rules:
    def __init__(self, bundle: Path, assets):
        from py_mini_racer import JSTimeoutException, MiniRacer

        self.context_type = MiniRacer
        self.timeout_type = JSTimeoutException
        self.source = bundle.read_text(encoding="utf-8")
        self.assets = json.dumps({"items": assets, "total": len(assets)}, ensure_ascii=False)
        self.capacity = BoundedSemaphore(2)

    def run(self, command, payload):
        if not self.capacity.acquire(timeout=2):
            raise ApiError(503, "INTERNAL", "排布规则繁忙，请稍后重试")
        try:
            # Requests supply JSON arguments only. The context loads the fixed release bundle.
            with self.context_type() as context:
                context.set_hard_memory_limit(128 * 1024 * 1024)
                context.eval(self.source, timeout_sec=3)
                result = json.loads(context.call(
                    "workbenchRules", command, json.dumps(payload, ensure_ascii=False),
                    self.assets, timeout_sec=10,
                ))
        except self.timeout_type:
            raise ApiError(503, "INTERNAL", "工作台规则处理超时，请重试") from None
        finally:
            self.capacity.release()
        if "error" in result:
            error = result["error"]
            raise ApiError(error["status"], "VALIDATION_FAILED", error["message"], error["details"])
        return result

