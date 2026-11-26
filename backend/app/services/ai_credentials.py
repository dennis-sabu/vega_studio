"""VEGA Studio Backend – Secure OS credential storage & secret redaction for Phase 15 AI."""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wintypes
import importlib
import os
import re
import shutil
import subprocess
import sys
import threading
from abc import ABC, abstractmethod
from typing import Dict, Iterable, Optional

from app.models.ai import AICredentialStatus, AIProviderId, AISecureStorageInfo

_SERVICE_NAME = "vega-studio-ai"

_SECRET_PATTERNS = (
    # OpenAI / Groq / generic sk-/gsk_/rk- keys
    (re.compile(r"\b(?:sk|gsk|rk|pk|ghp|gho|github_pat)[_-][A-Za-z0-9._-]{10,}"), "[REDACTED_KEY]"),
    # Bearer tokens
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._+/=-]{8,}", re.IGNORECASE), r"\1[REDACTED]"),
    # x-api-key / Authorization header strings
    (
        re.compile(r"((?:x-api-key|api[-_ ]?key|authorization)\s*[:=]\s*['\"]?)[A-Za-z0-9._+:/-]{8,}", re.IGNORECASE),
        r"\1[REDACTED]",
    ),
    # Embedded credentials in URLs
    (re.compile(r"(https?://)([^:\s/@]+):([^@\s/]+)@", re.IGNORECASE), r"\1[REDACTED]:[REDACTED]@"),
    # PEM private keys
    (
        re.compile(
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----"
        ),
        "[REDACTED_PRIVATE_KEY]",
    ),
)


class CredentialStorageUnavailableError(Exception):
    """Raised when persistent OS credential storage is unavailable and session-only was not chosen."""

    def __init__(self, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def scrub_ai_secrets(text: str, extra_secrets: Iterable[str] = ()) -> str:
    """Scrub known secrets and secret-shaped tokens from logs, errors, and UI payloads."""
    if not text:
        return text
    cleaned = text
    for secret in extra_secrets:
        if secret and len(secret) >= 6 and secret in cleaned:
            cleaned = cleaned.replace(secret, "[REDACTED]")
    for pattern, repl in _SECRET_PATTERNS:
        cleaned = pattern.sub(repl, cleaned)
    return cleaned


def mask_key_hint(secret: Optional[str]) -> Optional[str]:
    """Return a non-recoverable visual mask showing at most the trailing 4 characters."""
    if not secret:
        return None
    if len(secret) >= 12:
        return f"••••{secret[-4:]}"
    return "Configured"


class OSCredentialBackend(ABC):
    """Abstract OS credential storage adapter."""

    @property
    @abstractmethod
    def backend_name(self) -> str:
        ...

    @abstractmethod
    def is_available(self) -> tuple[bool, str]:
        ...

    @abstractmethod
    def get_secret(self, provider_id: AIProviderId) -> Optional[str]:
        ...

    @abstractmethod
    def set_secret(self, provider_id: AIProviderId, secret: str) -> None:
        ...

    @abstractmethod
    def delete_secret(self, provider_id: AIProviderId) -> None:
        ...


# ── Windows Credential Manager via advapi32.dll ctypes ────────────────────────

if sys.platform == "win32":
    _CRED_TYPE_GENERIC = 1
    _CRED_PERSIST_LOCAL_MACHINE = 2
    _ERROR_NOT_FOUND = 1168

    class _FILETIME(ctypes.Structure):
        _fields_ = [
            ("dwLowDateTime", wintypes.DWORD),
            ("dwHighDateTime", wintypes.DWORD),
        ]

    class _CREDENTIALW(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", _FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    _PCREDENTIALW = ctypes.POINTER(_CREDENTIALW)


class WindowsCredentialManagerBackend(OSCredentialBackend):
    """Uses native Windows Credential Manager (DPAPI-backed generic credentials)."""

    def __init__(self, target_prefix: str = "VEGA_STUDIO_AI:") -> None:
        self._prefix = target_prefix
        self._advapi32 = None
        if sys.platform == "win32":
            try:
                adv = ctypes.WinDLL("advapi32", use_last_error=True)
                adv.CredWriteW.argtypes = [ctypes.POINTER(_CREDENTIALW), wintypes.DWORD]
                adv.CredWriteW.restype = wintypes.BOOL
                adv.CredReadW.argtypes = [
                    wintypes.LPCWSTR,
                    wintypes.DWORD,
                    wintypes.DWORD,
                    ctypes.POINTER(_PCREDENTIALW),
                ]
                adv.CredReadW.restype = wintypes.BOOL
                adv.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
                adv.CredDeleteW.restype = wintypes.BOOL
                adv.CredFree.argtypes = [ctypes.c_void_p]
                adv.CredFree.restype = None
                self._advapi32 = adv
            except OSError:
                self._advapi32 = None

    @property
    def backend_name(self) -> str:
        return "Windows Credential Manager"

    def _target(self, provider_id: AIProviderId) -> str:
        return f"{self._prefix}{provider_id}"

    def is_available(self) -> tuple[bool, str]:
        if sys.platform != "win32" or self._advapi32 is None:
            return False, "Windows Credential Manager API unavailable."
        return True, "Encrypted via Windows Credential Manager (DPAPI)."

    def get_secret(self, provider_id: AIProviderId) -> Optional[str]:
        ok, _ = self.is_available()
        if not ok or self._advapi32 is None:
            return None
        pcred = _PCREDENTIALW()
        success = self._advapi32.CredReadW(
            self._target(provider_id),
            _CRED_TYPE_GENERIC,
            0,
            ctypes.byref(pcred),
        )
        if not success:
            err = ctypes.get_last_error()
            if err == _ERROR_NOT_FOUND:
                return None
            raise CredentialStorageUnavailableError(
                f"Failed to read credential from Windows Credential Manager (WinError {err}).",
                status_code=503,
            )
        try:
            cred = pcred.contents
            size = int(cred.CredentialBlobSize)
            if size <= 0 or not cred.CredentialBlob:
                return None
            raw_bytes = ctypes.string_at(cred.CredentialBlob, size)
            return raw_bytes.decode("utf-8", errors="strict")
        finally:
            self._advapi32.CredFree(pcred)

    def set_secret(self, provider_id: AIProviderId, secret: str) -> None:
        ok, msg = self.is_available()
        if not ok or self._advapi32 is None:
            raise CredentialStorageUnavailableError(msg, status_code=503)
        blob = secret.encode("utf-8")
        buf = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
        cred = _CREDENTIALW(
            Flags=0,
            Type=_CRED_TYPE_GENERIC,
            TargetName=self._target(provider_id),
            Comment="VEGA Studio Native AI API key",
            LastWritten=_FILETIME(0, 0),
            CredentialBlobSize=len(blob),
            CredentialBlob=ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)),
            Persist=_CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount=0,
            Attributes=None,
            TargetAlias=None,
            UserName=f"provider:{provider_id}",
        )
        if not self._advapi32.CredWriteW(ctypes.byref(cred), 0):
            err = ctypes.get_last_error()
            raise CredentialStorageUnavailableError(
                f"Failed to store credential in Windows Credential Manager (WinError {err}).",
                status_code=503,
            )

    def delete_secret(self, provider_id: AIProviderId) -> None:
        ok, _ = self.is_available()
        if not ok or self._advapi32 is None:
            return
        success = self._advapi32.CredDeleteW(self._target(provider_id), _CRED_TYPE_GENERIC, 0)
        if not success:
            err = ctypes.get_last_error()
            if err != _ERROR_NOT_FOUND:
                raise CredentialStorageUnavailableError(
                    f"Failed to delete credential from Windows Credential Manager (WinError {err}).",
                    status_code=503,
                )


class KeyringLibraryBackend(OSCredentialBackend):
    """Adapter around python `keyring` package when a secure non-plaintext backend is active."""

    def __init__(self, service_name: str = _SERVICE_NAME) -> None:
        self._service = service_name
        self._keyring = None
        self._kr_backend_name = "unavailable"
        self._reason = "Python keyring package is not installed."
        try:
            kr = importlib.import_module("keyring")
            backend = kr.get_keyring()
            cls_name = type(backend).__name__
            if any(bad in cls_name.lower() for bad in ("fail", "null", "plaintext")):
                self._reason = f"Keyring backend '{cls_name}' is not a secure OS keyring."
            else:
                self._keyring = kr
                self._kr_backend_name = f"OS Keyring ({cls_name})"
                self._reason = f"Secured via {cls_name}."
        except Exception as exc:
            self._reason = f"Keyring unavailable: {exc}"

    @property
    def backend_name(self) -> str:
        return self._kr_backend_name

    def is_available(self) -> tuple[bool, str]:
        return self._keyring is not None, self._reason

    def get_secret(self, provider_id: AIProviderId) -> Optional[str]:
        if self._keyring is None:
            return None
        try:
            val = self._keyring.get_password(self._service, provider_id)
            return str(val) if val else None
        except Exception as exc:
            raise CredentialStorageUnavailableError(
                f"OS keyring read unavailable: {exc}", status_code=503
            ) from exc

    def set_secret(self, provider_id: AIProviderId, secret: str) -> None:
        if self._keyring is None:
            raise CredentialStorageUnavailableError(self._reason, status_code=503)
        try:
            self._keyring.set_password(self._service, provider_id, secret)
        except Exception as exc:
            raise CredentialStorageUnavailableError(
                f"OS keyring write failed (ensure keyring is unlocked): {exc}",
                status_code=503,
            ) from exc

    def delete_secret(self, provider_id: AIProviderId) -> None:
        if self._keyring is None:
            return
        try:
            self._keyring.delete_password(self._service, provider_id)
        except Exception:
            pass


class LinuxSecretToolBackend(OSCredentialBackend):
    """Adapter around GNOME/KDE `secret-tool` (libsecret Secret Service API) passing secret via stdin."""

    def __init__(self, service_name: str = _SERVICE_NAME) -> None:
        self._service = service_name
        self._exe = shutil.which("secret-tool")

    @property
    def backend_name(self) -> str:
        return "Linux Secret Service (secret-tool)"

    def is_available(self) -> tuple[bool, str]:
        if not self._exe:
            return False, "`secret-tool` (libsecret) is not installed on this Linux host."
        if not os.environ.get("DBUS_SESSION_BUS_ADDRESS"):
            return False, "No active D-Bus session bus detected for Secret Service."
        return True, "Encrypted via Linux Secret Service (`secret-tool`)."

    def get_secret(self, provider_id: AIProviderId) -> Optional[str]:
        ok, _ = self.is_available()
        if not ok or not self._exe:
            return None
        try:
            res = subprocess.run(
                [self._exe, "lookup", "service", self._service, "provider", provider_id],
                capture_output=True,
                text=True,
                timeout=5.0,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            raise CredentialStorageUnavailableError(
                f"Linux Secret Service timed out or is inaccessible: {exc}",
                status_code=503,
            ) from exc
        if res.returncode != 0:
            return None
        val = res.stdout.strip()
        return val or None

    def set_secret(self, provider_id: AIProviderId, secret: str) -> None:
        ok, msg = self.is_available()
        if not ok or not self._exe:
            raise CredentialStorageUnavailableError(msg, status_code=503)
        try:
            res = subprocess.run(
                [
                    self._exe,
                    "store",
                    "--label",
                    f"VEGA Studio AI ({provider_id})",
                    "service",
                    self._service,
                    "provider",
                    provider_id,
                ],
                input=secret,
                capture_output=True,
                text=True,
                timeout=5.0,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            raise CredentialStorageUnavailableError(
                f"Linux Secret Service write failed or timed out (ensure keyring is unlocked): {exc}",
                status_code=503,
            ) from exc
        if res.returncode != 0:
            raise CredentialStorageUnavailableError(
                "Linux Secret Service rejected credential store write. Ensure your keyring is unlocked.",
                status_code=503,
            )

    def delete_secret(self, provider_id: AIProviderId) -> None:
        ok, _ = self.is_available()
        if not ok or not self._exe:
            return
        try:
            subprocess.run(
                [self._exe, "clear", "service", self._service, "provider", provider_id],
                capture_output=True,
                text=True,
                timeout=5.0,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass


class UnavailableOSCredentialBackend(OSCredentialBackend):
    """Explicit unavailable backend — never silently falls back to plaintext storage."""

    def __init__(self, reason: str) -> None:
        self._reason = reason

    @property
    def backend_name(self) -> str:
        return "unavailable"

    def is_available(self) -> tuple[bool, str]:
        return False, self._reason

    def get_secret(self, provider_id: AIProviderId) -> Optional[str]:
        return None

    def set_secret(self, provider_id: AIProviderId, secret: str) -> None:
        raise CredentialStorageUnavailableError(self._reason, status_code=503)

    def delete_secret(self, provider_id: AIProviderId) -> None:
        return None


def detect_default_os_credential_backend() -> OSCredentialBackend:
    """Detect the host's secure OS credential store without ever falling back to plaintext."""
    if sys.platform == "win32":
        win_backend = WindowsCredentialManagerBackend()
        if win_backend.is_available()[0]:
            return win_backend
    kr_backend = KeyringLibraryBackend()
    if kr_backend.is_available()[0]:
        return kr_backend
    if sys.platform.startswith("linux"):
        st_backend = LinuxSecretToolBackend()
        if st_backend.is_available()[0]:
            return st_backend
    return UnavailableOSCredentialBackend(
        "No secure OS credential store available (Windows Credential Manager, Python keyring, or Linux libsecret secret-tool required). Persistent API key storage is disabled; you may use Session-Only (in-memory) mode instead."
    )


class AICredentialManager:
    """Coordinates OS secure storage and optional explicit in-memory session keys."""

    def __init__(self, backend: Optional[OSCredentialBackend] = None) -> None:
        self._backend = backend if backend is not None else detect_default_os_credential_backend()
        self._lock = threading.RLock()
        self._session_keys: Dict[AIProviderId, str] = {}

    def get_storage_info(self) -> AISecureStorageInfo:
        available, detail = self._backend.is_available()
        return AISecureStorageInfo(
            os_storage_available=available,
            backend_name=self._backend.backend_name,
            detail=detail,
        )

    def get_secret(self, provider_id: AIProviderId) -> Optional[str]:
        with self._lock:
            if provider_id in self._session_keys:
                return self._session_keys[provider_id]
        try:
            return self._backend.get_secret(provider_id)
        except CredentialStorageUnavailableError:
            return None

    def get_session_secrets(self) -> list[str]:
        with self._lock:
            return list(self._session_keys.values())

    def get_all_known_secrets(self) -> list[str]:
        secrets: list[str] = []
        with self._lock:
            secrets.extend(self._session_keys.values())
        for pid in ("openai", "groq", "openai_compatible"):
            try:
                val = self.get_secret(pid)  # type: ignore[arg-type]
                if val and val not in secrets:
                    secrets.append(val)
            except CredentialStorageUnavailableError:
                continue
        return secrets

    def set_secret(
        self,
        provider_id: AIProviderId,
        secret: str,
        *,
        session_only: bool = False,
    ) -> AICredentialStatus:
        cleaned = secret.strip()
        if not cleaned:
            raise ValueError("API key cannot be empty.")

        if session_only:
            with self._lock:
                self._session_keys[provider_id] = cleaned
            return AICredentialStatus(
                provider_id=provider_id,
                has_api_key=True,
                key_hint=mask_key_hint(cleaned),
                persistence_mode="session_memory",
            )

        # Explicitly verify persistent OS store; never silently fall back to plaintext
        available, detail = self._backend.is_available()
        if not available:
            raise CredentialStorageUnavailableError(detail, status_code=503)

        self._backend.set_secret(provider_id, cleaned)
        with self._lock:
            self._session_keys.pop(provider_id, None)
        return AICredentialStatus(
            provider_id=provider_id,
            has_api_key=True,
            key_hint=mask_key_hint(cleaned),
            persistence_mode="os_keyring",
        )

    def delete_secret(self, provider_id: AIProviderId) -> AICredentialStatus:
        with self._lock:
            self._session_keys.pop(provider_id, None)
        self._backend.delete_secret(provider_id)
        return AICredentialStatus(
            provider_id=provider_id,
            has_api_key=False,
            key_hint=None,
            persistence_mode="none",
        )

    def get_status(self, provider_id: AIProviderId) -> AICredentialStatus:
        with self._lock:
            if provider_id in self._session_keys:
                sec = self._session_keys[provider_id]
                return AICredentialStatus(
                    provider_id=provider_id,
                    has_api_key=True,
                    key_hint=mask_key_hint(sec),
                    persistence_mode="session_memory",
                )
        try:
            sec = self._backend.get_secret(provider_id)
        except CredentialStorageUnavailableError:
            sec = None
        if sec:
            return AICredentialStatus(
                provider_id=provider_id,
                has_api_key=True,
                key_hint=mask_key_hint(sec),
                persistence_mode="os_keyring",
            )
        return AICredentialStatus(
            provider_id=provider_id,
            has_api_key=False,
            key_hint=None,
            persistence_mode="none",
        )
